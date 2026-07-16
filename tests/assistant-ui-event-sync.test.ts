import { describe, expect, it, vi } from "vitest";

import {
  createBoundedStreamCorrection,
  createProjectSnapshotCommitWatermark,
  createProjectSnapshotRefreshCoordinator,
} from "@/lib/project-agent-event-sync";

describe("assistant-ui event snapshot synchronization", () => {
  it("merges rapid refreshes and never applies a lower event watermark", async () => {
    const loads: Array<(snapshot: { agentEventSequence: number; value: string }) => void> = [];
    const loadSnapshot = vi.fn(() => new Promise<{ agentEventSequence: number; value: string }>((resolve) => loads.push(resolve)));
    const applied: string[] = [];
    const coordinator = createProjectSnapshotRefreshCoordinator({
      loadSnapshot,
      applySnapshot: (snapshot) => applied.push(snapshot.value),
      isCurrentProject: () => true,
    });

    const first = coordinator.request({ projectId: "project-a", requiredSequence: 1 });
    await Promise.resolve();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);

    const second = coordinator.request({ projectId: "project-a", requiredSequence: 2 });
    const third = coordinator.request({ projectId: "project-a", requiredSequence: 3 });
    loads.shift()!({ agentEventSequence: 1, value: "snapshot-1" });
    await expect(first).resolves.toBe(1);
    await Promise.resolve();
    expect(loadSnapshot).toHaveBeenCalledTimes(2);

    loads.shift()!({ agentEventSequence: 3, value: "snapshot-3" });
    await expect(Promise.all([second, third])).resolves.toEqual([3, 3]);
    expect(applied).toEqual(["snapshot-1", "snapshot-3"]);

    const stale = coordinator.request({ projectId: "project-a", requiredSequence: 2 });
    await Promise.resolve();
    loads.shift()!({ agentEventSequence: 2, value: "stale-snapshot" });
    await expect(stale).resolves.toBe(2);
    expect(applied).toEqual(["snapshot-1", "snapshot-3"]);
  });

  it("coalesces duplicate SSE errors and caps correction attempts per connection cycle", async () => {
    const correct = vi.fn(async () => undefined);
    const correction = createBoundedStreamCorrection({ maxAttempts: 2, correct });

    await Promise.all([correction.onError(), correction.onError(), correction.onError()]);
    expect(correct).toHaveBeenCalledTimes(1);
    await correction.onError();
    await correction.onError();
    expect(correct).toHaveBeenCalledTimes(2);

    correction.onOpen();
    await correction.onError();
    expect(correct).toHaveBeenCalledTimes(3);
  });

  it("uses one project watermark for ordinary commits and delayed event snapshots", async () => {
    type Snapshot = { project: { id: string }; agentEventSequence: number; value: string };
    const applied: string[] = [];
    const watermark = createProjectSnapshotCommitWatermark({
      applySnapshot: (snapshot: Snapshot) => applied.push(snapshot.value),
    });
    const eventLoads: Array<(snapshot: Snapshot) => void> = [];
    const eventRefresh = createProjectSnapshotRefreshCoordinator({
      loadSnapshot: () => new Promise<Snapshot>((resolve) => eventLoads.push(resolve)),
      beginSnapshotRequest: watermark.begin,
      applySnapshot: (snapshot, token) => watermark.commit(snapshot, token!),
      isCurrentProject: () => true,
    });

    const delayedEvent = eventRefresh.request({ projectId: "project-a", requiredSequence: 11 });
    await Promise.resolve();
    const submitted = watermark.begin("project-a");

    expect(watermark.commit({ project: { id: "project-a" }, agentEventSequence: 12, value: "submitted" }, submitted)).toBe(true);
    eventLoads.shift()!({ project: { id: "project-a" }, agentEventSequence: 11, value: "stale-event" });
    await expect(delayedEvent).resolves.toBe(11);
    expect(applied).toEqual(["submitted"]);
  });
});
