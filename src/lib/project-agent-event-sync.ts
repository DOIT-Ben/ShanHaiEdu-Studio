type AgentEventSnapshot = {
  agentEventSequence: number;
};

type ProjectSnapshot = AgentEventSnapshot & {
  project: { id: string };
};

export type ProjectSnapshotCommitToken = Readonly<{
  projectId: string;
  requestId: number;
}>;

export function createProjectSnapshotCommitWatermark<TSnapshot extends ProjectSnapshot>(input: {
  applySnapshot: (snapshot: TSnapshot) => void;
}) {
  let nextRequestId = 0;
  const latestStartedRequest = new Map<string, number>();
  const lastApplied = new Map<string, { requestId: number; sequence: number }>();

  function begin(projectId: string): ProjectSnapshotCommitToken {
    const normalizedProjectId = requireProjectId(projectId);
    const requestId = ++nextRequestId;
    latestStartedRequest.set(normalizedProjectId, requestId);
    return { projectId: normalizedProjectId, requestId };
  }

  function commit(snapshot: TSnapshot, token: ProjectSnapshotCommitToken) {
    const projectId = requireProjectId(snapshot.project.id);
    if (token.projectId !== projectId || !Number.isInteger(token.requestId) || token.requestId < 1) {
      throw new Error("Project snapshot commit token does not match the snapshot.");
    }
    const sequence = snapshot.agentEventSequence;
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new Error("Project snapshot agentEventSequence is invalid.");
    }
    if (token.requestId < (latestStartedRequest.get(projectId) ?? token.requestId)) return false;
    const previous = lastApplied.get(projectId);
    if (previous && (sequence < previous.sequence || (sequence === previous.sequence && token.requestId < previous.requestId))) {
      return false;
    }
    input.applySnapshot(snapshot);
    lastApplied.set(projectId, { requestId: token.requestId, sequence });
    return true;
  }

  return { begin, commit };
}

type RefreshRequest = {
  projectId: string;
  requiredSequence: number;
};

type RefreshWaiter = {
  requiredSequence: number;
  resolve: (confirmedSequence: number | null) => void;
};

type RefreshBatch = RefreshRequest & {
  waiters: RefreshWaiter[];
};

export function createProjectSnapshotRefreshCoordinator<TSnapshot extends AgentEventSnapshot, TRequestToken = undefined>(input: {
  loadSnapshot: (projectId: string) => Promise<TSnapshot>;
  beginSnapshotRequest?: (projectId: string) => TRequestToken;
  applySnapshot: (snapshot: TSnapshot, requestToken: TRequestToken | undefined) => void;
  isCurrentProject: (projectId: string) => boolean;
  onError?: () => void;
}) {
  const pending: RefreshBatch[] = [];
  const lastAppliedSequence = new Map<string, number>();
  let running = false;
  let scheduled = false;

  function request(requested: RefreshRequest) {
    assertRefreshRequest(requested);
    return new Promise<number | null>((resolve) => {
      const latest = pending.at(-1);
      if (latest?.projectId === requested.projectId) {
        latest.requiredSequence = Math.max(latest.requiredSequence, requested.requiredSequence);
        latest.waiters.push({ requiredSequence: requested.requiredSequence, resolve });
      } else {
        pending.push({
          ...requested,
          waiters: [{ requiredSequence: requested.requiredSequence, resolve }],
        });
      }
      scheduleDrain();
    });
  }

  function scheduleDrain() {
    if (running || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void drain();
    });
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.length > 0) {
        const batch = pending.shift()!;
        try {
          const requestToken = input.beginSnapshotRequest?.(batch.projectId);
          const snapshot = await input.loadSnapshot(batch.projectId);
          const confirmedSequence = snapshot.agentEventSequence;
          if (!Number.isInteger(confirmedSequence) || confirmedSequence < 0) {
            throw new Error("Project snapshot agentEventSequence is invalid.");
          }
          const previousSequence = lastAppliedSequence.get(batch.projectId) ?? 0;
          if (input.isCurrentProject(batch.projectId) && confirmedSequence >= previousSequence) {
            input.applySnapshot(snapshot, requestToken);
            lastAppliedSequence.set(batch.projectId, confirmedSequence);
          }
          for (const waiter of batch.waiters) {
            waiter.resolve(confirmedSequence >= waiter.requiredSequence && input.isCurrentProject(batch.projectId)
              ? confirmedSequence
              : null);
          }
        } catch {
          input.onError?.();
          for (const waiter of batch.waiters) waiter.resolve(null);
        }
      }
    } finally {
      running = false;
      if (pending.length > 0) scheduleDrain();
    }
  }

  return { request };
}

export function createBoundedStreamCorrection(input: {
  maxAttempts: number;
  correct: () => void | Promise<void>;
}) {
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new Error("Event stream correction maxAttempts must be a positive integer.");
  }
  let attempts = 0;
  let inFlight: Promise<void> | null = null;

  function onOpen() {
    attempts = 0;
  }

  function onError() {
    if (inFlight) return inFlight;
    if (attempts >= input.maxAttempts) return Promise.resolve();
    attempts += 1;
    inFlight = Promise.resolve(input.correct()).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { onError, onOpen };
}

function assertRefreshRequest(input: RefreshRequest) {
  if (!input.projectId.trim()) throw new Error("Project snapshot refresh projectId is required.");
  if (!Number.isInteger(input.requiredSequence) || input.requiredSequence < 0) {
    throw new Error("Project snapshot refresh requiredSequence is invalid.");
  }
}

function requireProjectId(projectId: string) {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project snapshot projectId is required.");
  return normalized;
}
