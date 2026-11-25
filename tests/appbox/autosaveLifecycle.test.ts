import { expect, it, vi } from 'vitest';
import { createAutosaveLifecycle, type HostLifecycle } from '../../src/appbox/autosaveLifecycle';

function waitFor<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function connected() {
  const saves = createAutosaveLifecycle();
  let handlers!: Parameters<HostLifecycle['register']>[0];
  const record = vi.fn();
  const draft = vi.fn();
  saves.connect({
    register(value) { handlers = value; value.onHostControls(); return vi.fn(); },
    setUiState: record,
  }, draft);
  saves.setReady(true);
  return { saves, handlers, record, draft };
}

it('tells AppBox a write is pending before it receives a reply and confirms only after it completes', async () => {
  const { saves, handlers, record } = connected();
  const write = waitFor<void>();
  const operation = saves.run(async () => {
    await write.promise;
    saves.acknowledge();
  });
  expect(handlers.inspect()).toMatchObject({ pendingOperation: true });
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saving', autosave: true }));
  const confirmation = handlers.save();
  write.resolve();
  await operation;
  await expect(confirmation).resolves.toEqual({ status: 'confirmed' });
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saved' }));
  expect(handlers.inspect()).toEqual({ dirty: false, changedFields: 0, pendingOperation: false });
});

it('keeps a pending receipt and joins repeated checks of the same write', async () => {
  const { saves, handlers, record } = connected();
  const reply = waitFor<number>();
  const replay = vi.fn(() => reply.promise);
  const operation = saves.run(async () => {
    const revision = await saves.awaitReceipt(replay);
    saves.acknowledge();
    return revision;
  });
  expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error', canSave: true }));
  const a = handlers.save();
  const b = handlers.save();
  expect(replay).toHaveBeenCalledTimes(1);
  reply.resolve(12);
  await expect(operation).resolves.toBe(12);
  await expect(a).resolves.toEqual({ status: 'confirmed' });
  await expect(b).resolves.toEqual({ status: 'confirmed' });
});

it('keeps a failed check pending and avoids reporting a clean unsaved local draft', async () => {
  const { saves, handlers, record } = connected();
  const replay = vi.fn<() => Promise<number | undefined>>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(17);
  const operation = saves.run(async () => saves.awaitReceipt(replay));
  await expect(handlers.save()).resolves.toEqual({ status: 'unknown' });
  expect(handlers.inspect().pendingOperation).toBe(true);
  saves.setDraft('invoice', () => {});
  await expect(handlers.save()).resolves.toEqual({ status: 'confirmed' });
  await operation;
  expect(handlers.inspect()).toMatchObject({ dirty: true, pendingOperation: false });
  expect(record).not.toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'saved' }));
});

it('keeps a slow operation pending if the host cannot wait for the whole request', async () => {
  vi.useFakeTimers();
  try {
    const { saves, handlers } = connected();
    const write = waitFor<void>();
    const operation = saves.run(() => write.promise);
    const check = handlers.save();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(check).resolves.toEqual({ status: 'unknown' });
    expect(handlers.inspect().pendingOperation).toBe(true);
    await expect(handlers.discard()).rejects.toThrow(/проверьте сохранение/i);
    write.resolve();
    await operation;
    await expect(handlers.save()).resolves.toEqual({ status: 'confirmed' });
  } finally {
    vi.useRealTimers();
  }
});
