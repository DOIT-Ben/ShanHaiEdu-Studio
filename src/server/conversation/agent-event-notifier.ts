type WaitResult = "event" | "fallback" | "aborted";

type EventWaiter = {
  afterSequence: number;
  resolve: (result: WaitResult) => void;
};

type NotifierState = {
  latestSequenceByProject: Map<string, number>;
  waitersByProject: Map<string, Set<EventWaiter>>;
};

const globalHost = globalThis as typeof globalThis & { __shanhaiAgentEventNotifier?: NotifierState };
const state = globalHost.__shanhaiAgentEventNotifier ??= {
  latestSequenceByProject: new Map(),
  waitersByProject: new Map(),
};

export function notifyProjectAgentEvent(projectId: string, sequence: number) {
  if (!projectId.trim() || !Number.isInteger(sequence) || sequence < 1) return;
  state.latestSequenceByProject.set(projectId, Math.max(sequence, state.latestSequenceByProject.get(projectId) ?? 0));
  for (const waiter of state.waitersByProject.get(projectId) ?? []) {
    if (sequence > waiter.afterSequence) waiter.resolve("event");
  }
}

export function waitForProjectAgentEvent(input: {
  projectId: string;
  afterSequence: number;
  signal?: AbortSignal;
  fallbackMs?: number;
}): Promise<WaitResult> {
  if (input.signal?.aborted) return Promise.resolve("aborted");
  if ((state.latestSequenceByProject.get(input.projectId) ?? 0) > input.afterSequence) {
    return Promise.resolve("event");
  }

  return new Promise((resolve) => {
    const waiters = state.waitersByProject.get(input.projectId) ?? new Set<EventWaiter>();
    let settled = false;
    const waiter: EventWaiter = {
      afterSequence: input.afterSequence,
      resolve: finish,
    };
    waiters.add(waiter);
    state.waitersByProject.set(input.projectId, waiters);
    const timer = setTimeout(() => finish("fallback"), Math.max(100, input.fallbackMs ?? 2_000));
    input.signal?.addEventListener("abort", onAbort, { once: true });

    function onAbort() {
      finish("aborted");
    }

    function finish(result: WaitResult) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      waiters.delete(waiter);
      if (waiters.size === 0) state.waitersByProject.delete(input.projectId);
      resolve(result);
    }
  });
}
