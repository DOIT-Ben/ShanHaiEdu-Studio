type CursorStorage = Pick<Storage, "getItem" | "setItem">;

const cursorKeyPrefix = "shanhai.agent-events.cursor";
const defaultReplayWindow = 64;

export function readProjectAgentEventCursor(storage: CursorStorage, projectId: string) {
  const value = Number(storage.getItem(cursorKey(projectId)));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function writeProjectAgentEventCursor(storage: CursorStorage, projectId: string, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("Project agent event sequence must be a non-negative integer.");
  }
  const current = readProjectAgentEventCursor(storage, projectId);
  if (sequence > current) storage.setItem(cursorKey(projectId), String(sequence));
}

export function resolveProjectAgentEventReplayCursor(durableCursor: number, replayWindow = defaultReplayWindow) {
  if (!Number.isInteger(durableCursor) || durableCursor < 0 || !Number.isInteger(replayWindow) || replayWindow < 0) {
    throw new Error("Project agent event replay cursor is invalid.");
  }
  return Math.max(0, durableCursor - replayWindow);
}

export async function confirmProjectAgentEventCursor(input: {
  storage: CursorStorage;
  projectId: string;
  eventSequence: number;
  confirmSnapshot: () => Promise<number | null>;
}) {
  const confirmedSequence = await input.confirmSnapshot();
  if (!Number.isInteger(confirmedSequence) || confirmedSequence! < input.eventSequence) return false;
  writeProjectAgentEventCursor(input.storage, input.projectId, input.eventSequence);
  return true;
}

export function buildProjectAgentEventStreamUrl(projectId: string, afterSequence: number) {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new Error("Project agent event sequence must be a non-negative integer.");
  }
  return `/api/workbench/projects/${encodeURIComponent(requireProjectId(projectId))}/events?afterSequence=${afterSequence}`;
}

function cursorKey(projectId: string) {
  return `${cursorKeyPrefix}:${requireProjectId(projectId)}`;
}

function requireProjectId(projectId: string) {
  const normalized = projectId.trim();
  if (!normalized) throw new Error("Project agent event projectId is required.");
  return normalized;
}
