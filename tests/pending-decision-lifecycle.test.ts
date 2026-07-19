import { describe, expect, it, vi } from "vitest";

import { projectConversationMessageParts } from "@/lib/conversation-message-contract";
import {
  appendPendingDecisionPrompt,
  isPendingDecisionCancellation,
  isPendingDecisionConfirmation,
  persistPendingDecisionStatus,
  resolveCurrentPendingDecision,
} from "@/server/conversation/pending-decision-lifecycle";
import { createTaskBrief, type PendingDecision } from "@/server/conversation/task-contract";
import type { ConversationMessageRecord } from "@/server/workbench/types";

const decision: PendingDecision = {
  schemaVersion: "pending-decision.v1",
  decisionId: "decision:action-1",
  status: "pending",
  kind: "budget_disclosure",
  reasonCode: "budget_not_disclosed",
  question: "是否确认费用范围？",
  impactSummary: "确认前不会发起付费生成。",
  options: [
    { id: "confirm", label: "确认继续", recommended: true },
    { id: "cancel", label: "暂不继续", recommended: false },
  ],
  actorUserId: "teacher-1",
  projectId: "project-1",
  taskId: "task-1",
  intentEpoch: 2,
  planId: "plan-1",
  actionId: "action-1",
  budgetPolicyVersion: "budget.v1",
  maxCostCredits: null,
  maxExternalProviderCalls: 2,
  expiresAt: null,
};

describe("PendingDecision lifecycle", () => {
  it("accepts only the pending decision bound to the paused task, plan, actor and epoch", () => {
    const base = {
      value: decision,
      aggregateStatus: "paused_recovery",
      planId: "plan-1",
      projectId: "project-1",
      intentEpoch: 2,
      taskId: "task-1",
      actorUserId: "teacher-1",
    };
    expect(resolveCurrentPendingDecision(base)).toEqual(decision);
    expect(resolveCurrentPendingDecision({ ...base, actorUserId: "teacher-2" })).toBeUndefined();
    expect(resolveCurrentPendingDecision({ ...base, planId: "plan-2" })).toBeUndefined();
    expect(resolveCurrentPendingDecision({ ...base, aggregateStatus: "active" })).toBeUndefined();
    expect(resolveCurrentPendingDecision({ ...base, value: { ...decision, status: "confirmed" } })).toBeUndefined();
  });

  it("distinguishes an explicit confirmation, cancellation and edited reply", () => {
    expect(isPendingDecisionConfirmation("确认继续")).toBe(true);
    expect(isPendingDecisionConfirmation("同意执行预算升级")).toBe(true);
    expect(isPendingDecisionCancellation("暂不继续")).toBe(true);
    expect(isPendingDecisionConfirmation("我想先改成视频")).toBe(false);
    expect(isPendingDecisionCancellation("我想先改成视频")).toBe(false);
  });

  it("shows the prompt only while the decision remains pending", () => {
    expect(appendPendingDecisionPrompt("我已准备好继续。", decision)).toContain(decision.question);
    expect(appendPendingDecisionPrompt("我已准备好继续。", { ...decision, status: "confirmed" }))
      .toBe("我已准备好继续。");
    expect(projectConversationMessageParts({
      role: "assistant",
      content: "已处理。",
      metadata: { pendingDecision: { ...decision, status: "confirmed" } },
    }).some((part) => part.type === "human-input" || part.type === "next-actions")).toBe(false);
  });

  it("delegates the resolved decision, event and snapshot to one atomic commit", async () => {
    const taskBrief = createTaskBrief({
      taskId: "task-1",
      projectId: "project-1",
      intentEpoch: 2,
      goal: "只做需求规格",
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: ["lesson_plan", "ppt", "video", "package"],
      generationIntensity: "standard",
      sourceMessageId: "teacher-origin",
    });
    const triggerMessage = message("teacher-confirm", "teacher", { confirmedActionId: decision.actionId });
    const aggregate = {
      taskBrief,
      intentGrant: {},
      plan: { planId: "plan-1", revision: 3, status: "active" },
      status: "active",
      checkpoint: null,
    } as never;
    const commitPendingDecisionStatus = vi.fn(async (input: { event: Record<string, unknown> }) => ({
      aggregate,
      event: { ...input.event, sequence: 7 },
    }));

    const committed = await persistPendingDecisionStatus({
      service: {} as never,
      controlPlaneStore: { commitPendingDecisionStatus } as never,
      projectId: "project-1",
      triggerMessage,
      taskBrief,
      aggregate,
      decision,
      status: "confirmed",
    });

    expect(committed).toEqual({ sequence: 7, aggregate });
    expect(commitPendingDecisionStatus).toHaveBeenCalledWith(expect.objectContaining({
      triggerMessageId: triggerMessage.id,
      status: "confirmed",
      event: expect.objectContaining({
        kind: "task_updated",
        payload: expect.objectContaining({ decisionId: decision.decisionId, decisionStatus: "confirmed" }),
      }),
      semanticSnapshot: expect.objectContaining({
        pendingDecision: expect.objectContaining({ status: "confirmed" }),
      }),
    }));
  });
});

function message(
  id: string,
  role: ConversationMessageRecord["role"],
  metadata: Record<string, unknown>,
): ConversationMessageRecord {
  return {
    id,
    projectId: "project-1",
    role,
    content: id,
    parts: [],
    artifactRefs: [],
    metadata,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}
