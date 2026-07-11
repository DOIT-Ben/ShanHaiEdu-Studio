import { describe, expect, it } from "vitest";
import {
  buildAgentHarnessBudgetEvent,
  evaluateAgentHarnessBudget,
  readAgentHarnessBudgetEventsFromMessages,
} from "@/server/conversation/agent-harness-budget";

describe("AgentHarnessBudget", () => {
  it("allows requests without historical budget events", () => {
    const decision = evaluateAgentHarnessBudget({
      capabilityId: "lesson_plan",
      actionKey: "lesson_plan:draft",
      events: [],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("does not count policy blocks as failed tool attempts", () => {
    const events = [
      buildAgentHarnessBudgetEvent({ capabilityId: "lesson_plan", actionKey: "lesson_plan:draft", status: "failed", kind: "tool_failed" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "lesson_plan", actionKey: "lesson_plan:draft", status: "blocked", kind: "blocked_by_policy" }),
    ];

    const decision = evaluateAgentHarnessBudget({
      capabilityId: "lesson_plan",
      actionKey: "lesson_plan:draft",
      events,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("blocks when recent failures are consecutive beyond the policy threshold", () => {
    const events = [
      buildAgentHarnessBudgetEvent({ capabilityId: "lesson_plan", actionKey: "lesson_plan:first", status: "succeeded", kind: "tool_failed", createdAt: "2026-07-09T00:00:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "lesson_plan", actionKey: "lesson_plan:a", status: "failed", kind: "tool_failed", createdAt: "2026-07-09T00:01:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:b", status: "failed", kind: "tool_failed", createdAt: "2026-07-09T00:02:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "video", actionKey: "video:c", status: "retryable_failed", kind: "provider_unavailable", createdAt: "2026-07-09T00:03:00.000Z" }),
    ];

    const decision = evaluateAgentHarnessBudget({
      capabilityId: "final_package",
      actionKey: "final_package:zip",
      events,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("consecutive_failures_exhausted");
  });

  it("blocks when one capability exhausts its retry budget", () => {
    const events = [
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx-1", status: "failed", kind: "tool_failed" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx-2", status: "retryable_failed", kind: "provider_unavailable" }),
    ];

    const decision = evaluateAgentHarnessBudget({
      capabilityId: "coze_ppt",
      actionKey: "coze_ppt:pptx-3",
      events,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("capability_retry_exhausted");
  });

  it("does not count failures that happened before the latest success for the same action", () => {
    const events = [
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx", status: "failed", kind: "tool_failed", createdAt: "2026-07-09T00:00:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx", status: "retryable_failed", kind: "provider_unavailable", createdAt: "2026-07-09T00:01:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx", status: "succeeded", kind: "tool_failed", createdAt: "2026-07-09T00:02:00.000Z" }),
    ];

    const decision = evaluateAgentHarnessBudget({
      capabilityId: "coze_ppt",
      actionKey: "coze_ppt:pptx",
      events,
    });

    expect(decision.allowed).toBe(true);
  });

  it("does not let a different action success reset same-action failure history", () => {
    const events = [
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx-a", status: "failed", kind: "tool_failed", createdAt: "2026-07-09T00:00:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx-a", status: "retryable_failed", kind: "tool_failed", createdAt: "2026-07-09T00:01:00.000Z" }),
      buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx-b", status: "succeeded", kind: "tool_succeeded", createdAt: "2026-07-09T00:02:00.000Z" }),
    ];

    const decision = evaluateAgentHarnessBudget({
      capabilityId: "coze_ppt",
      actionKey: "coze_ppt:pptx-a",
      events,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("same_action_repeat_exhausted");
  });

  it("blocks when the context estimate exceeds the policy budget", () => {
    const decision = evaluateAgentHarnessBudget({
      capabilityId: "lesson_plan",
      actionKey: "lesson_plan:draft",
      contextTokenEstimate: 12_001,
      events: [],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("context_budget_exhausted");
  });

  it("blocks side-effectful actions that have not passed HumanGate", () => {
    const decision = evaluateAgentHarnessBudget({
      capabilityId: "coze_ppt",
      actionKey: "coze_ppt:pptx",
      isSideEffectful: true,
      hasConfirmedHumanGate: false,
      events: [],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("human_gate_required");
  });

  it("returns a teacher-safe summary without engineering or sensitive words", () => {
    const decision = evaluateAgentHarnessBudget({
      capabilityId: "coze_ppt",
      actionKey: "coze_ppt:pptx",
      events: [
        buildAgentHarnessBudgetEvent({
          capabilityId: "coze_ppt",
          actionKey: "coze_ppt:pptx",
          status: "failed",
          kind: "provider_unavailable",
        }),
        buildAgentHarnessBudgetEvent({
          capabilityId: "coze_ppt",
          actionKey: "coze_ppt:pptx",
          status: "retryable_failed",
          kind: "tool_failed",
        }),
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.teacherSafeSummary).toBeTruthy();
    expect(decision.teacherSafeSummary).not.toMatch(
      /provider|schema|node_id|storage|debug|local path|capabilityId|runtimeKind|token|[A-Za-z]:[\\/]|\/(Users|home|tmp|var|private|mnt)\//i,
    );
    expect(decision.teacherSafeSummary).toContain("这一步");
  });

  it("builds budget events with default createdAt and actionKey", () => {
    const event = buildAgentHarnessBudgetEvent({
      capabilityId: "lesson_plan",
      expectedArtifactKind: "draft",
      status: "failed",
      kind: "quality_gate_failed",
    });

    expect(event.actionKey).toBe("lesson_plan:draft");
    expect(new Date(event.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("reads budget events from single and array metadata while ignoring bad metadata", () => {
    const single = buildAgentHarnessBudgetEvent({ capabilityId: "lesson_plan", actionKey: "lesson_plan:draft", status: "failed", kind: "tool_failed" });
    const firstArrayItem = buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx", status: "retryable_failed", kind: "provider_unavailable" });
    const secondArrayItem = buildAgentHarnessBudgetEvent({ capabilityId: "final_package", actionKey: "final_package:zip", status: "blocked", kind: "blocked_by_policy" });

    const events = readAgentHarnessBudgetEventsFromMessages([
      { metadata: { agentHarnessBudgetEvent: single } },
      { metadata: { agentHarnessBudgetEvents: [firstArrayItem, { bad: true }, secondArrayItem] } },
      { metadata: null },
      { metadata: "bad" },
      { metadata: { agentHarnessBudgetEvent: { status: "failed" } } },
    ]);

    expect(events).toEqual([single, firstArrayItem, secondArrayItem]);
  });
});
