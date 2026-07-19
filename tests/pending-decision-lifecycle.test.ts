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

  it("updates every matching message and binds the resolved snapshot to a new task event", async () => {
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
    const pendingMessage = message("assistant-pending", "assistant", { pendingDecision: decision });
    const triggerMessage = message("teacher-confirm", "teacher", { confirmedActionId: decision.actionId });
    const updateMessageMetadata = vi.fn(async (_projectId: string, id: string, metadata: Record<string, unknown>) =>
      ({ ...message(id, id === triggerMessage.id ? "teacher" : "assistant", metadata) }));
    const saveSemanticSnapshot = vi.fn(async () => undefined);
    const appendEvent = vi.fn(async (event: Record<string, unknown>) => ({ ...event, sequence: 7 }));

    const sequence = await persistPendingDecisionStatus({
      service: { getMessages: vi.fn(async () => [pendingMessage, triggerMessage]), updateMessageMetadata } as never,
      controlPlaneStore: { appendEvent, saveSemanticSnapshot } as never,
      projectId: "project-1",
      triggerMessage,
      taskBrief,
      aggregate: {
        taskBrief,
        intentGrant: {},
        plan: { planId: "plan-1", revision: 3, status: "active" },
        status: "active",
        checkpoint: null,
      } as never,
      decision,
      status: "confirmed",
    });

    expect(sequence).toBe(7);
    expect(updateMessageMetadata).toHaveBeenCalledTimes(2);
    expect(updateMessageMetadata.mock.calls.map((call) => call[2].pendingDecision))
      .toEqual([expect.objectContaining({ status: "confirmed" }), expect.objectContaining({ status: "confirmed" })]);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "task_updated",
      payload: expect.objectContaining({ decisionId: decision.decisionId, decisionStatus: "confirmed" }),
    }));
    expect(saveSemanticSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ pendingDecision: expect.objectContaining({ status: "confirmed" }) }),
      7,
    );
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
