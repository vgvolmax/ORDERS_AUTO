/* @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  payloadHeaderId, readPayload, readSourcePayload, savePayload, seedPayload,
  type Collection, type SeedRecord, type WorkingDocumentBridge,
} from '../../src/appbox/documentValue';

type Command = Parameters<WorkingDocumentBridge['command']>[0];
type RecordValue = Awaited<ReturnType<WorkingDocumentBridge['read']>>['records'][number];

function problem(status: number, code: string) {
  return Object.assign(new Error(code), { status, code });
}

function memoryDocument() {
  const rows = new Map<Collection, Map<string, RecordValue>>();
  const receipts = new Map<string, { revision: number }>();
  let revision = 0;
  const commands: Command[] = [];
  const state = {
    fail: undefined as ((input: Command, phase: 'before' | 'after') => void | Promise<void>) | undefined,
    turnPage: undefined as (() => void) | undefined,
    role: 'owner' as 'owner' | 'edit' | 'view',
  };
  const collectionRows = (collection: Collection) => {
    if (!rows.has(collection)) rows.set(collection, new Map());
    return rows.get(collection)!;
  };
  const page = (collection: Collection, after = '') => {
    const sorted = [...collectionRows(collection).values()]
      .filter((record) => record.id > after)
      .sort((left, right) => left.id.localeCompare(right.id));
    return { items: structuredClone(sorted.slice(0, 2)), next: sorted.length > 2 ? sorted[1]!.id : null };
  };
  const control: WorkingDocumentBridge = {
    async read(query) {
      if (query.revision !== undefined && query.revision !== revision)
        throw problem(409, 'DOCUMENT_CHANGED');
      const result = page(query.collection, query.after);
      const document = { id: 'doc', title: 'Закупка', role: state.role, revision };
      if (result.next) state.turnPage?.();
      return { document, records: result.items, next: result.next };
    },
    async command(input) {
      commands.push(input);
      const receipt = receipts.get(input.commandId);
      if (receipt) return { ...receipt, replayed: true };
      await state.fail?.(input, 'before');
      const records = collectionRows(input.collection);
      const saved = records.get(input.recordId);
      if (input.kind === 'insert') {
        if (saved) throw problem(409, 'RECORD_EXISTS');
        revision++;
        records.set(input.recordId, {
          id: input.recordId, generation: crypto.randomUUID(), revision,
          values: input.values, fieldRevisions: { payload: revision },
        });
      } else {
        if (!saved || saved.generation !== input.generation)
          throw problem(409, 'RECORD_CHANGED');
        if (input.kind === 'delete') {
          if (saved.revision !== input.baseRevision) throw problem(409, 'RECORD_CHANGED');
          revision++;
          records.delete(input.recordId);
        } else {
          const field = input.fields[0]!;
          if (saved.fieldRevisions.payload !== field.baseRevision)
            throw problem(409, 'FIELD_REVISION_CHANGED');
          revision++;
          records.set(input.recordId, {
            ...saved, revision, values: { payload: field.value }, fieldRevisions: { payload: revision },
          });
        }
      }
      const outcome = { revision };
      receipts.set(input.commandId, outcome);
      await state.fail?.(input, 'after');
      return outcome;
    },
    async source(_name, input = {}) {
      if (input.after && (input.revision !== revision || input.sourceId !== 'supplier-source'))
        throw problem(409, 'DOCUMENT_CHANGED');
      const result = page('catalog', input.after);
      const atRevision = revision;
      if (result.next) state.turnPage?.();
      return {
        id: 'supplier-source', revision: atRevision, next: result.next,
        items: result.items.map(({ id, values }) => ({ recordId: id, values })),
      };
    },
    async openOrCreate() { throw Error('Not used for storage'); },
  };
  function seed(records: SeedRecord[]) {
    if (!records.length) return;
    revision++;
    for (const { collection, recordId, values } of records)
      collectionRows(collection).set(recordId, {
        id: recordId, generation: crypto.randomUUID(), revision, values,
        fieldRevisions: { payload: revision },
      });
  }
  return { api: control, commands, state, seed, collectionRows, change: () => { revision++; } };
}

const report = {
  fileName: 'Волмакс · остатки 🧮.xlsx',
  rows: Array.from({ length: 7000 }, (_, i) => ({ sku: 'Ё-' + i, available: i + 1 })),
  enabled: true,
};

describe('Orders Auto working document payloads', () => {
  it('seeds and reads oversized Cyrillic reports through coherent pages', async () => {
    const doc = memoryDocument();
    const initial = await seedPayload('work', report);
    expect(initial.length).toBeGreaterThan(2);
    expect(initial.every((record) => record.values.payload.length <= 50000)).toBe(true);
    doc.seed(initial);
    doc.state.turnPage = () => {
      doc.state.turnPage = undefined;
      doc.change();
    };
    const read = await readPayload(doc.api, 'work');
    expect(read.value).toEqual(report);
    expect(read.document.revision).toBe(2);
  });

  it('reads the attached catalog at a single source revision', async () => {
    const doc = memoryDocument();
    doc.seed(await seedPayload('catalog', report));
    doc.state.turnPage = () => {
      doc.state.turnPage = undefined;
      doc.change();
    };
    await expect(readSourcePayload(doc.api, 'supplier_catalog')).resolves.toEqual({
      id: 'supplier-source', revision: 2, value: report,
    });
  });

  it('stages only changes, ignores a partial generation, and reclaims superseded chunks', async () => {
    const doc = memoryDocument();
    doc.seed(await seedPayload('work', report));
    const previous = await readPayload(doc.api, 'work');
    let currentAtPublish: unknown;
    doc.state.fail = async (command, phase) => {
      if (command.kind === 'update' && command.recordId === payloadHeaderId && phase === 'before')
        currentAtPublish = await readPayload(doc.api, 'work');
    };
    const committedRevision = await savePayload(doc.api, 'work', previous, { ...report, enabled: false });
    expect(currentAtPublish).toMatchObject({ value: report });
    expect(doc.commands.map((command) => command.kind)).toEqual(['insert', 'update', 'delete']);
    const current = await readPayload(doc.api, 'work');
    expect(current.value).toEqual({ ...report, enabled: false });
    expect(current.records.find(({ id }) => id === payloadHeaderId)?.fieldRevisions.payload).toBe(committedRevision);
    expect(current.document.revision).toBeGreaterThan(committedRevision);
    expect(doc.collectionRows('work').size).toBe(previous.records.length);
  });

  it('safely rejects competing updates without damaging the winning generation', async () => {
    const doc = memoryDocument();
    doc.seed(await seedPayload('work', report));
    const previous = await readPayload(doc.api, 'work');
    const winner = { ...report, fileName: 'Принятый отчёт.xlsx' };
    await savePayload(doc.api, 'work', previous, winner);

    await expect(savePayload(doc.api, 'work', previous, { ...report, enabled: false }))
      .rejects.toMatchObject({ code: 'FIELD_REVISION_CHANGED' });

    expect(await readPayload(doc.api, 'work')).toMatchObject({ value: winner });
    expect(doc.collectionRows('work').size).toBe(previous.records.length);
  });

  it('retries a lost write receipt with its original id and content', async () => {
    const doc = memoryDocument();
    const first = await readPayload(doc.api, 'invoices');
    doc.state.fail = (_command, phase) => {
      if (phase === 'after') throw new Error('Тайм-аут записи');
    };
    await savePayload(doc.api, 'invoices', first, ['Счёт № 2']);
    expect(doc.commands).toHaveLength(4);
    expect(doc.commands[1]).toEqual(doc.commands[0]);
    expect(doc.commands[3]).toEqual(doc.commands[2]);
    expect(await readPayload(doc.api, 'invoices')).toMatchObject({ value: ['Счёт № 2'] });
  });

  it('does not publish a half-written report when AppBox rejects one staged block', async () => {
    const doc = memoryDocument();
    const previous = await readPayload(doc.api, 'work');
    let blocks = 0;
    doc.state.fail = (command, phase) => {
      if (command.kind === 'insert' && phase === 'before' && ++blocks === 2)
        throw problem(413, 'PAYLOAD_TOO_LARGE');
    };
    await expect(savePayload(doc.api, 'work', previous, report)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(doc.collectionRows('work').size).toBe(0);
    expect(await readPayload(doc.api, 'work')).toMatchObject({ value: null });
  });

  it('rejects a corrupt generation rather than returning empty business data', async () => {
    const doc = memoryDocument();
    const records = await seedPayload('catalog', report);
    doc.seed(records.filter(({ recordId }, index) => index !== 1 || recordId === payloadHeaderId));
    await expect(readSourcePayload(doc.api, 'supplier_catalog')).rejects.toThrow(/повреждены/i);
  });

  it('does not send any operation for a read-only document', async () => {
    const doc = memoryDocument();
    doc.state.role = 'view';
    const previous = await readPayload(doc.api, 'work');
    await expect(savePayload(doc.api, 'work', previous, report)).rejects.toThrow(/просмотр/i);
    expect(doc.commands).toEqual([]);
  });
});
