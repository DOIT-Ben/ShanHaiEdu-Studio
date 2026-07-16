import { describe, expect, it } from "vitest";

import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import {
  SHANHAI_RUNTIME_EVENT_VERSION,
  persistSkillRuntimeEvent,
  toAgentEventInput,
  type SkillRuntimeEvent,
} from "@/server/skills/skill-runtime-event-adapter";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Skill RuntimeEvent adapter", () => {
  it("transports Skill facts without promoting artifacts or creating a HumanGate", () => {
    const artifactEvent = toAgentEventInput(runtimeEvent({
      eventId: "skill-event-artifact",
      type: "artifact_emitted",
      artifactId: "skill-artifact-1",
    }), context());
    const needsInputEvent = toAgentEventInput(runtimeEvent({
      eventId: "skill-event-input",
      type: "needs_input",
      reasonCode: "missing_business_input",
    }), context());

    expect(artifactEvent).toMatchObject({
      kind: "tool_observed",
      visibility: "internal",
      payload: {
        source: "shanhai_skill_runtime",
        transportOnly: true,
        orchestrationAuthority: "main_agent",
        runtimeEventType: "artifact_emitted",
        artifactId: "skill-artifact-1",
      },
    });
    expect(needsInputEvent).toMatchObject({
      kind: "tool_observed",
      visibility: "internal",
      payload: {
        runtimeEventType: "needs_input",
        reasonCode: "missing_business_input",
      },
    });
    expect(artifactEvent.kind).not.toBe("artifact_committed");
    expect(needsInputEvent.kind).not.toBe("decision_pending");
  });

  it("persists through the product event store and assigns product-monotonic sequences", async () => {
    const project = await createWorkbenchService().createProject({ title: "Skill事件运输" });
    const store = createControlPlaneStore();
    const eventContext = context({ projectId: project.id, taskId: `task-${project.id}` });

    const first = await persistSkillRuntimeEvent(store, runtimeEvent({
      eventId: `${project.id}-skill-event-1`,
      sequence: 0,
      type: "stage_started",
    }), eventContext);
    const second = await persistSkillRuntimeEvent(store, runtimeEvent({
      eventId: `${project.id}-skill-event-2`,
      sequence: 9,
      type: "completed",
    }), eventContext);

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(first).toMatchObject({ kind: "tool_started", payload: { runtimeEventSequence: 0 } });
    expect(second).toMatchObject({ kind: "tool_observed", payload: { runtimeEventSequence: 9 } });
    expect(await store.listEvents(project.id)).toEqual([
      expect.objectContaining({ eventId: first.eventId, sequence: 1 }),
      expect.objectContaining({ eventId: second.eventId, sequence: 2 }),
    ]);
  });

  it("fails closed before persistence when the RuntimeEvent contract is invalid", async () => {
    const project = await createWorkbenchService().createProject({ title: "Skill非法事件" });
    const store = createControlPlaneStore();
    const invalid = {
      ...runtimeEvent({ eventId: `${project.id}-invalid-event` }),
      type: "invoke_next_skill",
    } as unknown as SkillRuntimeEvent;

    await expect(persistSkillRuntimeEvent(store, invalid, context({
      projectId: project.id,
      taskId: `task-${project.id}`,
    }))).rejects.toThrow(/RuntimeEvent type/i);
    expect(await store.listEvents(project.id)).toEqual([]);
  });
});

function context(overrides: Partial<{
  projectId: string;
  taskId: string;
  intentEpoch: number;
}> = {}) {
  return {
    projectId: "project-a",
    taskId: "task-a",
    intentEpoch: 2,
    ...overrides,
  };
}

function runtimeEvent(overrides: Partial<SkillRuntimeEvent> = {}): SkillRuntimeEvent {
  return {
    schemaVersion: SHANHAI_RUNTIME_EVENT_VERSION,
    eventId: "skill-event-1",
    runId: "run-a",
    invocationId: "invocation-a",
    sequence: 0,
    occurredAt: "2026-07-15T00:00:00.000Z",
    type: "stage_started",
    skill: { name: "shanhai-delivery", version: "1.2" },
    artifactId: null,
    capability: null,
    reasonCode: null,
    message: "Skill阶段已开始。",
    ...overrides,
  };
}
