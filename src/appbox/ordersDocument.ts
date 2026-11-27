import {
  applySharedCatalog, parseSharedCatalog, sharedCatalogFromLocal,
  type SharedSupplierCatalog,
} from '../domain/sharedSupplierCatalog';
import { applyCatalogChange, type CatalogBase, type CatalogChange } from '../domain/catalogChange';
import type { InvoiceHistoryRecord } from '../domain/invoiceHistory';
import type { SupplierCatalog } from '../domain/supplierCatalog';
import type {
  StoredWorkspace, WorkspaceFile, WorkspaceView,
} from '../domain/workspace';
import { applyWorkspaceView, workspaceView, WorkspaceConflictError } from '../domain/workspace';
import { createInitialState } from '../app/initialState';
import { createAutosaveLifecycle } from './autosaveLifecycle';
import {
  payloadHeaderId, readPayload, readSourcePayload, savePayload, seedPayload,
  type PayloadSnapshot, type Collection, type WorkingDocumentBridge, type WorkingRecord, type WorkingSession,
} from './documentValue';

type EncodedFile = Omit<WorkspaceFile, 'bytes'> & { base64: string };
interface WorkspacePayload {
  workspace: StoredWorkspace;
  files: EncodedFile[];
  catalog: SupplierCatalog | null;
  catalogSource: string | null;
}

export interface InvoiceHistoryOverview {
  records: InvoiceHistoryRecord[];
  workspace?: {
    name: string;
    currentDocumentId: string;
    sessions: Map<string, string> | null;
  };
}

const catalogueAlias = 'supplier_catalog';
const defaultView = workspaceView(createInitialState());

function encodeFile({ bytes, ...file }: WorkspaceFile): EncodedFile {
  const data = new Uint8Array(bytes);
  const parts: string[] = [];
  for (let start = 0; start < data.length; start += 16384)
    parts.push(String.fromCharCode(...data.subarray(start, start + 16384)));
  return { ...file, base64: btoa(parts.join('')) };
}

function decodeFile({ base64, ...file }: EncodedFile): WorkspaceFile {
  const value = atob(base64);
  const data = Uint8Array.from(value, (char) => char.charCodeAt(0));
  return { ...file, bytes: data.buffer };
}

function localViewFree(workspace: StoredWorkspace): StoredWorkspace {
  const { previousActive: _previousActive, ...record } = workspace;
  return { ...record, data: applyWorkspaceView(record.data, defaultView) };
}

function isUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'DOCUMENT_SOURCE_UNAVAILABLE';
}

function isWriteConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === 'FIELD_REVISION_CHANGED' || error.code === 'RECORD_CHANGED' || error.code === 'RECORD_EXISTS');
}

function payloadRevision(records: readonly WorkingRecord[]): number | null {
  return records.find(({ id }) => id === payloadHeaderId)?.fieldRevisions.payload ?? null;
}

export class OrdersDocument {
  readonly saves = createAutosaveLifecycle();
  private view: WorkspaceView | undefined;
  private savedHeader: number | null = null;
  private source: { id: string; revision: number } | null = null;
  private ownedCatalog = false;
  private personalCatalog = false;
  private savedCatalogHeader: number | null = null;
  private revokedSource = false;
  catalog: SupplierCatalog | null = null;

  constructor(private readonly api: WorkingDocumentBridge) {}

  private async publishPayload<T>(collection: Collection, previous: PayloadSnapshot<unknown>, value: T) {
    const revision = await savePayload(this.api, collection, previous, value, this.saves.awaitReceipt);
    this.saves.acknowledge();
    return revision;
  }

  async load() {
    const snapshot = await readPayload<WorkspacePayload>(this.api, 'work');
    const value = snapshot.value;
    if (value && (value.workspace?.schemaVersion !== 1 ||
        !value.workspace.data || !Number.isSafeInteger(value.workspace.revision) ||
        !Array.isArray(value.files)))
      throw new Error('Не удалось прочитать сеанс закупки в AppBox.');
    const workspace = value ? {
      ...value.workspace,
      workspaceId: snapshot.document.id,
      data: this.view ? applyWorkspaceView(value.workspace.data, this.view) : value.workspace.data,
    } : null;
    return { ...snapshot, workspace };
  }

  async prepareSession() {
    const snapshot = await this.load();
    const linked = await this.readSource();
    const source = linked && { id: linked.id, revision: linked.revision };
    const sourceUnavailable = !linked && Boolean(this.source || snapshot.value?.catalogSource);
    const { workspace } = snapshot;
    const sku = workspace?.data.minMax?.skus ?? [];
    const personalCatalog = !linked && !sourceUnavailable && !snapshot.document.workspace;
    const owned = personalCatalog ? await readPayload<SharedSupplierCatalog>(this.api, 'catalog') : null;
    const catalogRevision = owned ? payloadRevision(owned.records) : null;
    const catalog = linked ? applySharedCatalog(null, parseSharedCatalog(linked.value), sku)
      : owned?.value ? applySharedCatalog(null, parseSharedCatalog(owned.value))
        : personalCatalog ? snapshot.value?.catalog ?? null : null;
    if (!catalog && (sourceUnavailable || snapshot.document.workspace) && workspace)
      delete workspace.data.supplierAssignments;
    const header = payloadRevision(snapshot.records);
    return {
      session: {
        document: snapshot.document, workspace, catalog, sourceUnavailable,
        catalogReadOnly: !personalCatalog || snapshot.document.role === 'view',
        catalogRevision,
        sourceConnected: source !== null,
      },
      activate: () => {
        this.catalog = catalog;
        this.savedHeader = header;
        this.revokedSource = sourceUnavailable;
        this.source = source;
        this.personalCatalog = personalCatalog;
        this.ownedCatalog = catalogRevision !== null;
        this.savedCatalogHeader = catalogRevision;
      },
    };
  }

  async loadSession() {
    const prepared = await this.prepareSession();
    prepared.activate();
    return prepared.session;
  }

  private async readSource() {
    try {
      const source = await readSourcePayload<SharedSupplierCatalog>(this.api, catalogueAlias);
      if (!source.value) throw new Error('Общий справочник AppBox пуст. Обратитесь к администратору.');
      return source;
    } catch (error) {
      if (isUnavailable(error)) return null;
      throw error;
    }
  }

  async changeCatalog(change: CatalogChange, base: CatalogBase) {
    const work = await this.load();
    if (work.document.workspace || this.revokedSource || work.value?.catalogSource || await this.readSource())
      throw new Error('Редактируйте справочник в исходном документе AppBox.');

    for (let attempt = 0; ; attempt++) {
      const snapshot = await readPayload<SharedSupplierCatalog>(this.api, 'catalog');
      if (snapshot.document.role === 'view') throw new Error('Справочник доступен только для просмотра.');
      const revision = payloadRevision(snapshot.records);
      const current = snapshot.value ? applySharedCatalog(null, parseSharedCatalog(snapshot.value)) : work.value?.catalog ?? null;
      const next = applyCatalogChange(change, { catalog: current, catalogRevision: revision }, base);
      try {
        const catalogRevision = next === current && revision !== null ? revision
          : await this.publishPayload('catalog', snapshot, parseSharedCatalog(sharedCatalogFromLocal(next)));
        this.savedCatalogHeader = catalogRevision;
        this.ownedCatalog = true;
        this.catalog = next;
        return { catalog: next, catalogRevision };
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        if (attempt >= 2)
          throw new WorkspaceConflictError('Справочник изменился одновременно с вашей правкой. Проверьте актуальные данные.');
      }
    }
  }

  private async catalogChanged(): Promise<boolean> {
    try {
      const page = await this.api.source(catalogueAlias);
      return page.id !== this.source?.id || page.revision !== this.source.revision;
    } catch (error) {
      if (isUnavailable(error)) return this.source !== null;
      throw error;
    }
  }

  async checkCatalog(): Promise<void> {
    if (this.revokedSource)
      throw new Error('Общий справочник недоступен. Проверьте подключение в AppBox.');
    if (await this.catalogChanged())
      throw new Error('Общий справочник изменился. Обновите данные и повторите действие.');
  }

  async hasUpdate(checkSource = true): Promise<boolean> {
    const head = await this.api.read({ collection: 'work', limit: 1 });
    if (payloadRevision(head.records) !== this.savedHeader) return true;
    if (!checkSource) return false;
    if (await this.catalogChanged()) return true;
    if (!this.personalCatalog) return false;
    const catalog = await this.api.read({ collection: 'catalog', limit: 1 });
    return payloadRevision(catalog.records) !== this.savedCatalogHeader;
  }

  setView(view: WorkspaceView) {
    this.view = view;
  }

  async loadFile(id: string): Promise<WorkspaceFile | null> {
    const { value } = await this.load();
    const file = value?.files.find(({ fileId }) => fileId === id);
    return file ? decodeFile(file) : null;
  }

  async save(
    workspace: StoredWorkspace, expected: number, files: WorkspaceFile[], catalog?: SupplierCatalog,
  ) {
    const snapshot = await this.load();
    if (workspace.workspaceId !== snapshot.document.id ||
        (snapshot.workspace?.revision ?? -1) !== expected || workspace.revision !== expected + 1)
      throw new WorkspaceConflictError();
    await this.checkCatalog();
    if (catalog && this.source)
      throw new Error('Редактируйте подключённый справочник в его исходном документе AppBox.');

    const retainedIds = new Set(Object.values(workspace.data.rawImports).map((file) => file?.fileId));
    const outgoing = new Map(snapshot.value?.files.filter(({ fileId }) => retainedIds.has(fileId))
      .map((file) => [file.fileId, file]) ?? []);
    for (const file of files) outgoing.set(file.fileId, encodeFile(file));
    try {
      this.savedHeader = await this.publishPayload('work', snapshot, {
        workspace: localViewFree(workspace),
        files: [...outgoing.values()],
        catalog: this.ownedCatalog ? null : catalog ?? snapshot.value?.catalog ?? null,
        catalogSource: this.source?.id ?? null,
      } satisfies WorkspacePayload);
    } catch (error) {
      if (isWriteConflict(error)) throw new WorkspaceConflictError();
      throw error;
    }
    this.view = workspaceView(workspace.data);
    if (!this.source && !this.ownedCatalog) this.catalog = catalog ?? snapshot.value?.catalog ?? null;
  }

  async openReport(
    workspace: StoredWorkspace, files: WorkspaceFile[], bytes: ArrayBuffer,
  ) {
    await this.checkCatalog();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const intakeKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const records = await seedPayload('work', {
      workspace: localViewFree(workspace),
      files: files.map(encodeFile),
      catalog: null,
      catalogSource: this.source?.id ?? null,
    } satisfies WorkspacePayload);
    const title = 'Закупки · ' + (workspace.data.minMaxFileName ?? 'MIN/MAX').slice(0, 110);
    return this.api.openOrCreate({
      title, commandId: crypto.randomUUID(), intakeKey, initialData: { formatVersion: 1, records },
    });
  }

  async loadInvoiceHistory() {
    return (await readPayload<InvoiceHistoryRecord[]>(this.api, 'invoices')).value ?? [];
  }

  async listSessions(signal?: AbortSignal): Promise<WorkingSession[] | null> {
    const { listSessions, openSession } = this.api;
    if (!listSessions || !openSession) return null;

    const sessions = new Map<string, WorkingSession>();
    const seenCursors = new Set<string>();
    let after: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await listSessions.call(this.api, { ...(after ? { after } : {}), limit: 50 });
      signal?.throwIfAborted();
      for (const item of page.items) {
        if (!sessions.has(item.id)) sessions.set(item.id, item);
      }
      after = page.next ?? undefined;
      if (after) {
        if (seenCursors.has(after)) throw new Error('Не удалось дочитать список сеансов AppBox.');
        seenCursors.add(after);
      }
    } while (after);
    return [...sessions.values()];
  }

  async loadInvoiceHistoryOverview(signal?: AbortSignal): Promise<InvoiceHistoryOverview> {
    const current = await readPayload<InvoiceHistoryRecord[]>({
      read: (query) => {
        signal?.throwIfAborted();
        return this.api.read(query);
      },
    }, 'invoices');
    const records = current.value ?? [];
    const workspace = current.document.workspace;
    if (!workspace) return { records };
    const context = { name: workspace.name, currentDocumentId: current.document.id };
    const { readSession } = this.api;
    const items = readSession ? await this.listSessions(signal) : null;
    if (!items || !readSession) return { records, workspace: { ...context, sessions: null } };

    const sessions = new Map(items.map(({ id, title }) => [id, title]));
    const copies = new Map<string, { record: InvoiceHistoryRecord; documentId: string }>();
    const collect = (documentId: string, invoices: InvoiceHistoryRecord[]) => {
      for (const record of invoices) {
        const existing = copies.get(record.id);
        if (!existing || documentId === record.sourceId ||
            (existing.documentId !== record.sourceId && record.revisions.length > existing.record.revisions.length))
          copies.set(record.id, { record, documentId });
      }
    };
    collect(current.document.id, records);
    for (const { id } of items) {
      signal?.throwIfAborted();
      if (id === current.document.id) continue;
      const snapshot = await readPayload<InvoiceHistoryRecord[]>({
        read: (query) => {
          signal?.throwIfAborted();
          return readSession.call(this.api, { ...query, documentId: id });
        },
      }, 'invoices');
      collect(id, snapshot.value ?? []);
    }
    return { records: [...copies.values()].map(({ record }) => record), workspace: { ...context, sessions } };
  }

  async openSession(documentId: string) {
    if (!this.api.openSession) throw new Error('Открытие сеанса доступно после обновления AppBox.');
    return this.api.openSession({ documentId });
  }

  async changeInvoiceHistory<T>(change: (records: InvoiceHistoryRecord[]) => {
    records: InvoiceHistoryRecord[]; result: T;
  }): Promise<T> {
    return this.saves.run(async () => {
      const snapshot = await readPayload<InvoiceHistoryRecord[]>(this.api, 'invoices');
      const previous = snapshot.value ?? [];
      const { records, result } = change(previous);
      if (records !== previous) await this.publishPayload('invoices', snapshot, records);
      return result;
    });
  }
}

let current: { api: WorkingDocumentBridge; document: OrdersDocument } | undefined;

export function ordersDocument(): OrdersDocument | null {
  const api = typeof window === 'undefined' ? undefined
    : (window as Window & { AppBoxWorkingDocument?: WorkingDocumentBridge }).AppBoxWorkingDocument;
  if (!api) return null;
  if (current?.api !== api) current = { api, document: new OrdersDocument(api) };
  return current.document;
}
