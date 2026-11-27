// Working Document field mutations use a revision check. A small header publishes a complete
// immutable generation in one mutation, even when the value spans many AppBox records.
export type Collection = 'work' | 'catalog' | 'invoices';

export interface DocSummary {
  id: string;
  title: string;
  role: 'owner' | 'edit' | 'view';
  revision: number;
  workspace?: { id: string; name: string };
  workspaceBase?: 'root' | 'session';
}

export interface WorkingRecord {
  id: string;
  generation: string;
  revision: number;
  values: { payload: string };
  fieldRevisions: Record<string, number>;
}

export interface SeedRecord {
  collection: Collection;
  recordId: string;
  values: { payload: string };
}

export interface PayloadSnapshot<T> {
  document: DocSummary;
  value: T | null;
  records: WorkingRecord[];
}

type RecordCommand = {
  collection: Collection;
  commandId: string;
  recordId: string;
};

type Command = RecordCommand & (
  | { kind: 'insert'; values: { payload: string } }
  | { kind: 'update'; generation: string; fields: Array<{ field: 'payload'; value: string; baseRevision: number }> }
  | { kind: 'delete'; generation: string; baseRevision: number }
);

type DocumentPageQuery = {
  collection: Collection;
  limit?: number;
  after?: string;
  revision?: number;
};
type DocumentPage = { document: DocSummary; records: WorkingRecord[]; next: string | null };

export interface WorkingSession {
  id: string;
  title: string;
  updatedAt: number;
}

export interface WorkingDocumentStore {
  read(query: DocumentPageQuery): Promise<DocumentPage>;
  command(input: Command): Promise<{ revision: number; replayed?: boolean }>;
}

export interface WorkingDocumentBridge extends WorkingDocumentStore {
  base?: WorkingDocumentStore;
  listSessions?(query?: { after?: string; limit?: number }): Promise<{
    items: WorkingSession[];
    next: string | null;
  }>;
  readSession?(query: DocumentPageQuery & { documentId: string }): Promise<DocumentPage>;
  openSession?(input: { documentId: string }): Promise<{ documentId: string }>;
  source(name: string, page?: { after?: string; sourceId?: string; revision?: number }): Promise<{
    id: string;
    revision: number;
    items: Array<{ recordId: string; values: { payload: string } }>;
    next: string | null;
  }>;
  openOrCreate(input: {
    commandId: string;
    title: string;
    intakeKey: string;
    initialData: { formatVersion: 1; records: SeedRecord[] };
  }): Promise<{ document: DocSummary; replayed: boolean }>;
}

export const payloadHeaderId = '00000000-0000-4000-8000-000000000001';
const format = 'orders-auto-gzip-blocks-1';
const blockBytes = 36 * 1024;
const maxFieldLength = 50_000;
const maxFieldBytes = 64 * 1024;
const maxDocumentBytes = 20 * 1024 * 1024;
const maxDocumentRecords = 10_000;
const attempts = 3;
const writeBatchSize = 4;
const encoder = new TextEncoder();
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
type Section = [name: string | null, ids: string[]];
type Header = { format: typeof format; sections: Section[] };
type PayloadRow = { id: string; values: { payload: string } };

class UnknownWrite extends Error {
  constructor(cause: unknown) {
    super('AppBox не подтвердил сохранение. Обновите сеанс перед повторной правкой.', { cause });
  }
}

function code(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function retryable(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  return typeof status !== 'number' || status === 0 || status === 408 || status === 429 || status >= 500;
}

async function write(api: WorkingDocumentStore, command: Command) {
  try {
    return await api.command(command);
  } catch (error) {
    if (!retryable(error)) throw error;
    // The first write may have arrived before the retry. AppBox returns the same receipt for
    // the same command id and contents instead of applying the mutation twice.
    try {
      return await api.command(command);
    } catch (outcome) {
      throw new UnknownWrite(outcome);
    }
  }
}

function corrupt(cause?: unknown): Error {
  return new Error('Данные рабочего документа AppBox повреждены или имеют неизвестный формат.', { cause });
}

function parseHeader(payload: string): Header {
  try {
    if (payload.length > maxFieldLength) throw corrupt();
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null || !('format' in parsed) || parsed.format !== format ||
        !('sections' in parsed) || !Array.isArray(parsed.sections)) throw corrupt();
    const names = new Set<string | null>();
    for (const section of parsed.sections) {
      if (!Array.isArray(section) || section.length !== 2 ||
          (section[0] !== null && typeof section[0] !== 'string') || names.has(section[0]) ||
          (section[0] === null && parsed.sections.length !== 1) ||
          !Array.isArray(section[1]) || !section[1].length ||
          !section[1].every((id) => typeof id === 'string' && uuid.test(id) && id !== payloadHeaderId))
        throw corrupt();
      names.add(section[0]);
    }
    return parsed as Header;
  } catch (error) {
    throw corrupt(error);
  }
}

function inputStream(bytes: Uint8Array<ArrayBuffer>) {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function compress(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const compressed = await new Response(inputStream(bytes).pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(compressed)));
}

async function decompress(payload: string): Promise<Uint8Array[]> {
  if (payload.length > maxFieldLength) throw corrupt();
  const encoded = Uint8Array.from(atob(payload), (symbol) => symbol.charCodeAt(0));
  const reader = inputStream(encoded).pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) return parts;
    length += next.value.byteLength;
    if (length > blockBytes) {
      await reader.cancel();
      throw corrupt();
    }
    parts.push(next.value);
  }
}

async function decode<T>(records: readonly PayloadRow[], fields?: readonly string[]): Promise<T | null> {
  const rows = new Map(records.map(({ id, values }) => [id, values.payload]));
  const payload = rows.get(payloadHeaderId);
  if (payload === undefined) return null;
  try {
    const { sections } = parseHeader(payload);
    const entries: Array<[string, unknown]> = [];
    for (const [name, ids] of sections) {
      if (fields && name !== null && !fields.includes(name)) continue;
      const reader = new TextDecoder('utf-8', { fatal: true });
      const parts: string[] = [];
      for (const id of ids) {
        const block = rows.get(id);
        if (block === undefined) throw corrupt();
        for (const part of await decompress(block)) parts.push(reader.decode(part, { stream: true }));
      }
      parts.push(reader.decode());
      const value: unknown = JSON.parse(parts.join(''));
      if (name === null) return value as T;
      entries.push([name, value]);
    }
    return Object.fromEntries(entries) as T;
  } catch (error) {
    throw corrupt(error);
  }
}

function requireSpace(size: number, rows: number): void {
  if (size > maxDocumentBytes || rows > maxDocumentRecords)
    throw new Error('Данные не помещаются в рабочий документ AppBox. Уменьшите объём отчёта.');
}

function recordBytes(payload: string): number {
  // Store accounts for values_json and field revisions. Reserve the largest safe revision.
  const valueBytes = encoder.encode(JSON.stringify(payload)).byteLength;
  if (payload.length > maxFieldLength || valueBytes > maxFieldBytes)
    throw new Error('Слишком большой блок данных рабочего документа AppBox.');
  return valueBytes + '{"payload":}'.length + '{"payload":9007199254740991}'.length;
}

function serializedSections(value: unknown): Array<[string | null, string]> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Рабочее значение AppBox должно поддерживать JSON.');
  // Split the serialized representation so other large top-level fields stay reusable
  // when the value of a small field changes. JSON itself applies the normal DTO rules.
  if (!json.startsWith('{')) return [[null, json]];
  return Object.entries(JSON.parse(json) as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, section]) => [name, JSON.stringify(section)]);
}

async function prepare(
  collection: Collection, value: unknown, current: readonly WorkingRecord[] = [],
) {
  const byPayload = new Map(current.map(({ id, values }) => [values.payload, id]));
  const staged: SeedRecord[] = [];
  const sections: Section[] = [];
  for (const [name, json] of serializedSections(value)) {
    const bytes = encoder.encode(json);
    const ids: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += blockBytes) {
      const payload = await compress(bytes.slice(offset, offset + blockBytes));
      let id = byPayload.get(payload);
      if (!id) {
        id = crypto.randomUUID();
        byPayload.set(payload, id);
        staged.push({ collection, recordId: id, values: { payload } });
      }
      ids.push(id);
    }
    sections.push([name, ids]);
  }
  const header = { format, sections } satisfies Header;
  const payload = JSON.stringify(header);
  const stagedBytes = staged.reduce((sum, row) => sum + recordBytes(row.values.payload), 0);
  const headerBytes = recordBytes(payload);
  return { header, payload, staged, stagedBytes, headerBytes };
}

async function pinned<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (code(error) !== 'DOCUMENT_CHANGED' || attempt === attempts) throw error;
    }
  }
}

function demandProgress(seen: Set<string>, cursor: string): void {
  if (seen.has(cursor)) throw corrupt();
  seen.add(cursor);
}

function readRecords(api: Pick<WorkingDocumentBridge, 'read'>, collection: Collection) {
  return pinned(async () => {
    const first = await api.read({ collection, limit: 50 });
    const records = [...first.records];
    const seen = new Set<string>();
    let next = first.next;
    while (next) {
      demandProgress(seen, next);
      const page = await api.read({ collection, limit: 50, after: next, revision: first.document.revision });
      records.push(...page.records);
      next = page.next;
    }
    return { document: first.document, records };
  });
}

export async function readPayload<T>(
  api: Pick<WorkingDocumentBridge, 'read'>, collection: Collection, fields?: readonly string[],
): Promise<PayloadSnapshot<T>> {
  const snapshot = await readRecords(api, collection);
  return { ...snapshot, value: await decode<T>(snapshot.records, fields) };
}

export async function readSourcePayload<T>(api: WorkingDocumentBridge, name: string): Promise<{
  value: T | null;
  revision: number;
  id: string;
}> {
  const { id, revision, records } = await pinned(async () => {
    const first = await api.source(name);
    const items = [...first.items];
    const seen = new Set<string>();
    let next = first.next;
    while (next) {
      demandProgress(seen, next);
      const page = await api.source(name, { after: next, revision: first.revision, sourceId: first.id });
      items.push(...page.items);
      next = page.next;
    }
    return {
      id: first.id, revision: first.revision,
      records: items.map(({ recordId: id, values }) => ({ id, values })),
    };
  });
  return { id, revision, value: await decode<T>(records) };
}

export async function seedPayload<T>(collection: Collection, value: T): Promise<SeedRecord[]> {
  const { payload, staged, stagedBytes, headerBytes } = await prepare(collection, value);
  requireSpace(stagedBytes + headerBytes, staged.length + 1);
  return [{ collection, recordId: payloadHeaderId, values: { payload } }, ...staged];
}

function chunkIds(header: Header): Set<string> {
  return new Set(header.sections.flatMap(([, ids]) => ids));
}

async function reclaim(api: WorkingDocumentStore, collection: Collection, obsolete: readonly WorkingRecord[]) {
  for (let index = 0; index < obsolete.length; index += writeBatchSize) {
    // A cleanup failure cannot roll back a generation already known to be committed.
    await Promise.allSettled(obsolete.slice(index, index + writeBatchSize).map((record) => write(api, {
      kind: 'delete', commandId: crypto.randomUUID(), collection, recordId: record.id,
      generation: record.generation, baseRevision: record.revision,
    })));
  }
}

async function reclaimStaged(
  api: WorkingDocumentStore, collection: Collection, staged: ReadonlyMap<string, string>,
): Promise<void> {
  if (!staged.size) return;
  try {
    const { records } = await readRecords(api, collection);
    await reclaim(api, collection, records.filter(({ id, values }) => staged.get(id) === values.payload));
  } catch {
    // Unreferenced chunks are never loaded by a reader, including if cleanup is offline.
  }
}

export async function savePayload<T>(
  api: WorkingDocumentStore, collection: Collection, previous: PayloadSnapshot<unknown>, value: T,
  awaitReceipt?: (replay: () => Promise<number | undefined>) => Promise<number>,
): Promise<number> {
  if (previous.document.role === 'view') throw new Error('Рабочий документ доступен только для просмотра.');
  const priorHeader = previous.records.find(({ id }) => id === payloadHeaderId);
  const activeIds = priorHeader ? chunkIds(parseHeader(priorHeader.values.payload)) : new Set<string>();
  const active = previous.records.filter(({ id }) => activeIds.has(id));
  const next = await prepare(collection, value, active);
  if (priorHeader?.values.payload === next.payload) return priorHeader.fieldRevisions.payload ?? priorHeader.revision;

  const priorBytes = previous.records.reduce((total, row) => total + recordBytes(row.values.payload), 0);
  requireSpace(
    priorBytes + next.stagedBytes + Math.max(0, next.headerBytes - (priorHeader ? recordBytes(priorHeader.values.payload) : 0)),
    previous.records.length + next.staged.length + (priorHeader ? 0 : 1),
  );
  const attempted = new Map<string, string>();
  try {
    for (let index = 0; index < next.staged.length; index += writeBatchSize) {
      const group = next.staged.slice(index, index + writeBatchSize);
      for (const { recordId, values } of group) attempted.set(recordId, values.payload);
      const result = await Promise.allSettled(group.map(({ recordId, values }) => write(api, {
        kind: 'insert', commandId: crypto.randomUUID(), collection, recordId, values,
      })));
      const failed = result.find((outcome) => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
  } catch (error) {
    await reclaimStaged(api, collection, attempted);
    throw error;
  }

  const headerRecord = { commandId: crypto.randomUUID(), collection, recordId: payloadHeaderId };
  const command: Command = priorHeader ? {
    ...headerRecord, kind: 'update', generation: priorHeader.generation, fields: [
      { field: 'payload', value: next.payload, baseRevision: priorHeader.fieldRevisions.payload ?? 0 },
    ],
  } : { ...headerRecord, kind: 'insert', values: { payload: next.payload } };
  let revision: number;
  try {
    const result = await write(api, command);
    revision = result.revision;
  } catch (error) {
    if (!(error instanceof UnknownWrite)) {
      await reclaimStaged(api, collection, attempted);
      throw error;
    }
    // A timeout may hide a successful header swap. Verify its exact contents before cleanup.
    const snapshot = await readRecords(api, collection).catch(() => null);
    const saved = snapshot?.records.find(({ id }) => id === payloadHeaderId);
    if (saved?.values.payload === next.payload) revision = saved.fieldRevisions.payload ?? saved.revision;
    else {
      if (!awaitReceipt) throw error;
      // A newer generation can hide a successfully committed earlier command in a read.
      // Ask AppBox for the receipt using the original immutable command.
      try {
        revision = await awaitReceipt(async () => {
          try {
            return (await api.command(command)).revision;
          } catch (reason) {
            if (['FIELD_REVISION_CHANGED', 'RECORD_CHANGED', 'RECORD_EXISTS'].includes(String(code(reason))))
              throw reason;
            return undefined;
          }
        });
      } catch (rejection) {
        await reclaimStaged(api, collection, attempted);
        throw rejection;
      }
    }
  }
  const nextIds = chunkIds(next.header);
  await reclaim(api, collection, active.filter(({ id }) => !nextIds.has(id)));
  return revision;
}
