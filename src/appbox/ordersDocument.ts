import {
  applySharedCatalog, parseSharedCatalog,
  type SharedSupplierCatalog,
} from '../domain/sharedSupplierCatalog';
import type { InvoiceHistoryRecord } from '../domain/invoiceHistory';
import type { SupplierCatalog } from '../domain/supplierCatalog';
import type {
  StoredWorkspace, WorkspaceFile, WorkspaceView,
} from '../domain/workspace';
import { applyWorkspaceView, workspaceView } from '../domain/workspace';
import { createInitialState } from '../app/initialState';
import {
  payloadHeaderId, readPayload, readSourcePayload, savePayload, seedPayload,
  type WorkingDocumentBridge,
} from './documentValue';

type EncodedFile = Omit<WorkspaceFile, 'bytes'> & { base64: string };
interface WorkspacePayload {
  workspace: StoredWorkspace;
  files: EncodedFile[];
  catalog: SupplierCatalog | null;
  catalogSource: string | null;
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

export class OrdersDocument {
  private view: WorkspaceView | undefined;
  private savedHeader: number | null = null;
  private source: { id: string; revision: number } | null = null;
  private ownedCatalog = false;
  private revokedSource = false;
  catalog: SupplierCatalog | null = null;

  constructor(private readonly api: WorkingDocumentBridge) {}

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

  async loadSession() {
    const snapshot = await this.load();
    const catalog = await this.loadCatalog(snapshot);
    this.catalog = catalog;
    this.savedHeader = snapshot.records.find(({ id }) => id === payloadHeaderId)?.fieldRevisions.payload ?? null;
    const { workspace } = snapshot;
    if (!catalog && (this.revokedSource || snapshot.document.workspace) && workspace) {
      delete workspace.data.supplierAssignments;
    }
    return {
      document: snapshot.document,
      workspace,
      catalog,
      catalogReadOnly: this.ownedCatalog || this.source !== null,
      sourceConnected: this.source !== null,
      sourceUnavailable: this.revokedSource,
    };
  }

  private async loadCatalog(snapshot: Awaited<ReturnType<OrdersDocument['load']>>): Promise<SupplierCatalog | null> {
    const sku = snapshot.workspace?.data.minMax?.skus ?? [];
    const linked = await this.readSource();
    this.revokedSource = !linked && Boolean(this.source || snapshot.value?.catalogSource);
    this.source = linked && { id: linked.id, revision: linked.revision };
    this.ownedCatalog = false;
    if (linked) return applySharedCatalog(null, parseSharedCatalog(linked.value), sku);
    if (this.revokedSource || snapshot.document.workspace) return null;
    const { value } = await readPayload<SharedSupplierCatalog>(this.api, 'catalog');
    this.ownedCatalog = value !== null;
    return value ? applySharedCatalog(null, parseSharedCatalog(value), sku) : snapshot.value?.catalog ?? null;
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

  async saveCatalog(value: SharedSupplierCatalog) {
    const previous = await readPayload<SharedSupplierCatalog>(this.api, 'catalog');
    if (previous.document.workspace)
      throw new Error('Редактируйте справочник в исходном документе AppBox.');
    await savePayload(this.api, 'catalog', previous, parseSharedCatalog(value));
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

  async hasUpdate(): Promise<boolean> {
    const head = await this.api.read({ collection: 'work', limit: 1 });
    const revision = head.records.find(({ id }) => id === payloadHeaderId)?.fieldRevisions.payload ?? null;
    return revision !== this.savedHeader || await this.catalogChanged();
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
      throw new Error('Сеанс изменился в другой вкладке. Загрузите актуальную версию и повторите действие.');
    await this.checkCatalog();
    if (catalog && this.source)
      throw new Error('Редактируйте подключённый справочник в его исходном документе AppBox.');

    const retainedIds = new Set(Object.values(workspace.data.rawImports).map((file) => file?.fileId));
    const outgoing = new Map(snapshot.value?.files.filter(({ fileId }) => retainedIds.has(fileId))
      .map((file) => [file.fileId, file]) ?? []);
    for (const file of files) outgoing.set(file.fileId, encodeFile(file));
    this.savedHeader = await savePayload(this.api, 'work', snapshot, {
      workspace: localViewFree(workspace),
      files: [...outgoing.values()],
      catalog: this.ownedCatalog ? null : catalog ?? snapshot.value?.catalog ?? null,
      catalogSource: this.source?.id ?? null,
    } satisfies WorkspacePayload);
    this.view = workspaceView(workspace.data);
    if (catalog) this.catalog = catalog;
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

  async changeInvoiceHistory<T>(change: (records: InvoiceHistoryRecord[]) => {
    records: InvoiceHistoryRecord[]; result: T;
  }): Promise<T> {
    const snapshot = await readPayload<InvoiceHistoryRecord[]>(this.api, 'invoices');
    const previous = snapshot.value ?? [];
    const { records, result } = change(previous);
    if (records !== previous) await savePayload(this.api, 'invoices', snapshot, records);
    return result;
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
