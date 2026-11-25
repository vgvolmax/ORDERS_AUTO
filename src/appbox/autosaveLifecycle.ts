type DraftState = { dirty: boolean; changedFields: number; pendingOperation: boolean };
type SaveOutcome =
  | { status: 'confirmed' }
  | { status: 'unknown' }
  | { status: 'failed'; message: string };
type UiState = {
  autosave: true;
  phase: 'loading' | 'ready' | 'saving' | 'saved' | 'error';
  message: string;
  canSave: boolean;
  canDiscard: boolean;
  canReconnect: false;
};

export interface HostLifecycle {
  register(handlers: {
    inspect: () => DraftState;
    save: () => Promise<SaveOutcome>;
    discard: () => Promise<void>;
    onHostControls: () => void;
  }): () => void;
  setUiState(state: UiState): void;
}

export function createAutosaveLifecycle() {
  let active = 0;
  let ready = false;
  let acknowledged = false;
  let failure = '';
  const receipts = new Set<() => Promise<void>>();
  const drafts = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const inspect = (): DraftState => ({
    dirty: drafts.size > 0,
    changedFields: Math.min(drafts.size, 100_000),
    pendingOperation: active > 0 || receipts.size > 0,
  });
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось сохранить изменения.';

  async function check(): Promise<SaveOutcome> {
    const unknown = { status: 'unknown' } as const;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let stopped = false;
    async function verify(): Promise<SaveOutcome> {
      await Promise.all([...receipts].map((retry) => retry()));
      if (!stopped && active && !receipts.size) {
        await new Promise<void>((resolve) => {
          wake = () => {
            if (stopped || !active || receipts.size) resolve();
          };
          listeners.add(wake);
        });
      }
      if (active || receipts.size) return unknown;
      return failure ? { status: 'failed', message: failure.slice(0, 500) } : { status: 'confirmed' };
    }
    try {
      // AppBox stops waiting after five seconds. Longer writes remain in the window.
      return await Promise.race([
        verify(),
        new Promise<SaveOutcome>((resolve) => { timer = setTimeout(() => resolve(unknown), 4000); }),
      ]);
    } finally {
      stopped = true;
      clearTimeout(timer);
      if (wake) {
        listeners.delete(wake);
        wake();
      }
    }
  }

  return {
    check,
    needsCheck: () => receipts.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    connect(host?: HostLifecycle, reportDraft?: (draft: DraftState) => void) {
      if (!host) return;
      const report = () => {
        const draft = inspect();
        const recovery = receipts.size > 0;
        const phase = recovery ? 'error' : active ? 'saving' : failure ? 'error'
          : !ready ? 'loading' : acknowledged && !draft.dirty ? 'saved' : 'ready';
        const state: UiState = {
          autosave: true, phase,
          message: recovery ? 'AppBox не подтвердил сохранение. Проверьте запись.'
            : phase === 'saving' ? 'Сохраняем изменения…'
              : phase === 'error' ? failure.slice(0, 500) : '',
          canSave: recovery,
          canDiscard: draft.dirty && !draft.pendingOperation,
          canReconnect: false,
        };
        if (phase !== 'saved') host.setUiState(state);
        reportDraft?.(draft);
        if (phase === 'saved') host.setUiState(state);
      };
      const unregister = host.register({
        inspect, save: check, onHostControls: report,
        async discard() {
          if (inspect().pendingOperation) throw new Error('Сначала проверьте сохранение.');
          for (const discard of [...drafts.values()]) discard();
          drafts.clear();
          failure = '';
          publish();
        },
      });
      listeners.add(report);
      report();
      return () => { listeners.delete(report); unregister(); };
    },
    setReady(value: boolean) {
      ready = value;
      if (!ready) acknowledged = false;
      publish();
    },
    setDraft(key: string, discard?: () => void) {
      const changed = drafts.has(key) !== Boolean(discard);
      if (discard) drafts.set(key, discard);
      else drafts.delete(key);
      if (changed) publish();
    },
    acknowledge() {
      acknowledged = true;
      publish();
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active === 0) failure = '';
      active++;
      publish();
      try {
        return await task();
      } catch (error) {
        failure = message(error);
        throw error;
      } finally {
        active--;
        publish();
      }
    },
    awaitReceipt(replay: () => Promise<number | undefined>): Promise<number> {
      return new Promise((resolve, reject) => {
        let checking: Promise<void> | undefined;
        function retry() {
          return checking ??= replay().then((revision) => {
            if (revision === undefined) return;
            receipts.delete(retry);
            resolve(revision);
          }, (error: unknown) => {
            receipts.delete(retry);
            reject(error);
          }).finally(() => {
            checking = undefined;
            publish();
          });
        }
        receipts.add(retry);
        publish();
      });
    },
  };
}

export function connectHostAutosave(saves: ReturnType<typeof createAutosaveLifecycle>) {
  const runtime = window as Window & {
    AppBoxLifecycle?: HostLifecycle;
    AppBox?: { setDraftState?(draft: DraftState): void };
  };
  return saves.connect(runtime.AppBoxLifecycle, (draft) => runtime.AppBox?.setDraftState?.(draft));
}
