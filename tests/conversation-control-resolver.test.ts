import { describe, expect, it } from "vitest";
import { resolveConversationControl } from "@/server/conversation/conversation-control-resolver";
import type { MainAgentTurn } from "@/server/capabilities/types";
import type { IntentGrant, PendingDecision } from "@/server/conversation/task-contract";
import { v19rRealFailureDialogue } from "./fixtures/v1-9r-real-failure-dialogue.fixture";

const baseTurn: MainAgentTurn = {
  assistantMessage: { body: "好的" },
  state: "chatting",
  quickReplies: [],
  recommendedOptions: [],
  shouldRunToolNow: false,
  runtimeKind: "deterministic",
};

describe("ConversationControlResolver", () => {
  it("keeps a complete task active when the teacher says continue or confirm", () => {
    const pendingPlan = {
      ...pendingRequirementPlan(),
      intentGrant: {
        schemaVersion: "intent-grant.v1",
        taskId: "task-1",
        projectId: "project-1",
        intentEpoch: 0,
        standardWorkAuthorized: true,
        intensity: "standard",
        budgetPolicyVersion: "v1-standard",
        maxCostCredits: null,
        maxExternalProviderCalls: 3,
        requiredCheckpoints: [],
        expiresAt: null,
      } satisfies IntentGrant,
      toolPlan: {
        ...pendingRequirementPlan().toolPlan,
        inputDraft: { teacherGoal: v19rRealFailureDialogue.expectedRecovery.preserveTaskGoal },
      },
    };

    for (const userMessage of v19rRealFailureDialogue.messages.slice(1, 3)) {
      const result = resolveConversationControl({
        userMessage,
        pendingPlan,
        agentTurn: { ...baseTurn, toolPlan: pendingPlan.toolPlan },
        capabilityAvailability: [],
      });

      expect(result.turn).toMatchObject({
        state: "running_tool",
        shouldRunToolNow: true,
        toolPlan: {
          capabilityId: "requirement_spec",
          inputDraft: { teacherGoal: v19rRealFailureDialogue.expectedRecovery.preserveTaskGoal },
        },
      });
    }
  });

  it("does not synthesize a Tool when the Main Agent failed on a direct local request", () => {
    const failedTurn: MainAgentTurn = {
      ...baseTurn,
      assistantMessage: { body: "智能生成服务暂时不可用。" },
      state: "failed_retryable",
      runtimeKind: "openai",
    };
    const result = resolveConversationControl({
      userMessage: "只做视频脚本",
      pendingPlan: null,
      agentTurn: failedTurn,
      capabilityAvailability: [{
        capabilityId: "video_script_generate",
        status: "needs_approved_inputs",
        requiresConfirmation: true,
        missingApprovedInputs: ["creative_theme_generate"],
        reasonForModel: "missing trusted creative theme",
        reasonForUser: "还缺少可信的导入创意主题。",
      }],
    });
    expect(result.decision).toMatchObject({ kind: "ordinary_message", reasonCode: "no_control_override" });
    expect(result.turn).toMatchObject({
      assistantMessage: { body: "智能生成服务暂时不可用。" },
      state: "failed_retryable",
      shouldRunToolNow: false,
    });
    expect(result.turn.toolPlan).toBeUndefined();
  });

  it("turns an unbound provider execution request into a real confirmation plan", () => {
    const result = resolveConversationControl({
      userMessage: "生成真实 PPTX",
      pendingPlan: null,
      capabilityAvailability: [],
      agentTurn: {
        ...baseTurn,
        state: "running_tool",
        shouldRunToolNow: true,
        toolPlan: {
          planId: "coze:test",
          capabilityId: "coze_ppt",
          reasonForUser: "生成 PPTX",
          internalReason: "model",
          inputDraft: {},
          missingInputs: [],
          upstreamPlan: [],
          nextSuggestedCapabilities: [],
          requiresConfirmation: false,
          expectedArtifactKind: "pptx_artifact",
        },
      },
    });
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false, toolPlan: { requiresConfirmation: true } });
  });

  it("supersedes the old action when the teacher changes capability", () => {
    const mainAgentPrerequisiteTurn: MainAgentTurn = {
      ...baseTurn,
      assistantMessage: { body: "我会先补齐视频脚本所需的可信前置。" },
      state: "running_tool",
      shouldRunToolNow: true,
      toolPlan: {
        planId: "requirement:new-video-script-task",
        capabilityId: "requirement_spec",
        reasonForUser: "先整理当前局部任务的完整语义。",
        internalReason: "main_agent_selected_prerequisite",
        inputDraft: { teacherGoal: "只做视频脚本" },
        missingInputs: [],
        upstreamPlan: [],
        nextSuggestedCapabilities: [],
        requiresConfirmation: false,
        expectedArtifactKind: "requirement_spec",
      },
    };
    const result = resolveConversationControl({
      userMessage: "先不要做 PPT，改做视频脚本",
      pendingPlan: pendingPptOutlinePlan(),
      agentTurn: mainAgentPrerequisiteTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "switch_to_capability", targetCapabilityId: "video_script_generate", supersedePendingAction: true });
    expect(result.turn.toolPlan?.capabilityId).toBe("requirement_spec");
    expect(result.turn.toolPlan?.internalReason).toBe("main_agent_selected_prerequisite");
  });

  it("does not turn natural language into provider HumanGate confirmation", () => {
    const pendingPlan = pendingProviderPlan();
    const result = resolveConversationControl({
      userMessage: "确认生成 PPTX",
      pendingPlan,
      agentTurn: { ...baseTurn, state: "running_tool", shouldRunToolNow: true, toolPlan: pendingPlan.toolPlan },
      capabilityAvailability: [],
    });
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false });
    expect(result.decision.usePendingActionId).toBe(false);
  });

  it("never replaces a supplied wrong actionId with the pending actionId", () => {
    const pendingPlan = pendingRequirementPlan();
    const result = resolveConversationControl({
      userMessage: "确认开始",
      pendingPlan,
      receivedConfirmedActionId: "human:wrong:requirement_spec:m2",
      agentTurn: { ...baseTurn, state: "running_tool", shouldRunToolNow: true, toolPlan: pendingPlan.toolPlan },
      capabilityAvailability: [],
    });
    expect(result.decision.reasonCode).toBe("mismatched_confirmed_action_id");
    expect(result.decision.usePendingActionId).toBeUndefined();
    expect(result.turn.shouldRunToolNow).toBe(false);
  });

  it("does not let another project member replay an actor-bound pending action", () => {
    const pendingPlan = {
      ...pendingProviderPlan(),
      pendingDecision: pendingDecision("teacher-a", "human:p:coze_ppt:m1"),
    };
    const result = resolveConversationControl({
      userMessage: "确认生成 PPTX",
      pendingPlan,
      receivedConfirmedActionId: pendingPlan.actionId,
      receivedActorUserId: "teacher-b",
      agentTurn: { ...baseTurn, state: "running_tool", shouldRunToolNow: true, toolPlan: pendingPlan.toolPlan },
      capabilityAvailability: [],
    });

    expect(result.decision.reasonCode).toBe("pending_action_actor_mismatch");
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false });
  });

  it("supersedes the active offer when the teacher revises its content", () => {
    const result = resolveConversationControl({
      userMessage: "把叙事大纲改成先冲突后揭秘，不要按刚才那版执行",
      pendingPlan: pendingPptOutlinePlan(),
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "revise_active_offer", supersedePendingAction: true });
    expect(result.turn.shouldRunToolNow).toBe(false);
  });

  it("supersedes the active offer when the teacher cancels it", () => {
    const result = resolveConversationControl({
      userMessage: "先取消这一步，暂时不要做了",
      pendingPlan: pendingPptOutlinePlan(),
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "cancel_active_offer", supersedePendingAction: true });
    expect(result.turn).toMatchObject({ state: "chatting", shouldRunToolNow: false });
  });

  it("treats edited quick-reply text as a revision instead of authorizing the old action", () => {
    const result = resolveConversationControl({
      userMessage: "把叙事改成先冲突后揭秘，不要按刚才那版执行",
      pendingPlan: pendingPptOutlinePlan(),
      receivedConfirmedActionId: "human:p:ppt_outline:m1",
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "revise_active_offer", pendingPlanStatus: "superseded", advanceIntentEpoch: true });
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false });
  });

  it("pauses an active offer without advancing the intent epoch", () => {
    const result = resolveConversationControl({
      userMessage: "先暂停这个任务，稍后再继续",
      pendingPlan: pendingPptOutlinePlan(),
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "pause_active_offer", pendingPlanStatus: "paused", createPauseCheckpoint: true });
    expect(result.decision.advanceIntentEpoch).toBeUndefined();
    expect(result.turn).toMatchObject({ state: "chatting", shouldRunToolNow: false, toolPlan: undefined });
  });

  it("resumes a paused offer by requiring a newly issued action", () => {
    const result = resolveConversationControl({
      userMessage: "恢复刚才的任务",
      pendingPlan: { ...pendingPptOutlinePlan(), status: "paused" },
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "resume_paused_offer", pendingPlanStatus: "superseded" });
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false, toolPlan: { requiresConfirmation: true } });
  });

  it("cancels an active offer and advances the intent epoch", () => {
    const result = resolveConversationControl({
      userMessage: "取消当前任务",
      pendingPlan: pendingPptOutlinePlan(),
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.decision).toMatchObject({ kind: "cancel_active_offer", pendingPlanStatus: "canceled", advanceIntentEpoch: true });
    expect(result.turn.shouldRunToolNow).toBe(false);
  });

  it("does not let an ambiguous continuation authorize a provider action", () => {
    const result = resolveConversationControl({
      userMessage: "继续",
      pendingPlan: pendingProviderPlan(),
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });
    expect(result.turn).toMatchObject({ state: "awaiting_confirmation", shouldRunToolNow: false });
  });
});

function pendingPptOutlinePlan() {
  return {
    status: "pending" as const,
    actionId: "human:p:ppt_outline:m1",
    teacherRequest: "做 PPT 大纲",
    toolPlan: {
      planId: "ppt:test",
      capabilityId: "ppt_outline" as const,
      reasonForUser: "做 PPT 大纲",
      internalReason: "test",
      inputDraft: {},
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: false,
      expectedArtifactKind: "ppt_draft",
    },
  };
}

function pendingProviderPlan() {
  return {
    status: "pending" as const,
    actionId: "human:p:coze_ppt:m1",
    teacherRequest: "生成真实 PPTX",
    toolPlan: {
      planId: "coze:test",
      capabilityId: "coze_ppt" as const,
      reasonForUser: "生成 PPTX",
      internalReason: "test",
      inputDraft: {},
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: true,
      expectedArtifactKind: "pptx_artifact",
    },
  };
}

function pendingRequirementPlan() {
  return {
    status: "pending" as const,
    actionId: "human:p:requirement_spec:m1",
    teacherRequest: "整理需求",
    toolPlan: {
      planId: "requirement:test",
      capabilityId: "requirement_spec" as const,
      reasonForUser: "整理需求",
      internalReason: "test",
      inputDraft: {},
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: false,
      expectedArtifactKind: "requirement_spec",
    },
  };
}

function pendingDecision(actorUserId: string, actionId: string): PendingDecision {
  return {
    schemaVersion: "pending-decision.v1",
    decisionId: `decision:${actionId}`,
    status: "pending",
    kind: "publish",
    reasonCode: "publish",
    question: "是否确认发布？",
    impactSummary: "确认后内容可能被外部访问。",
    options: [
      { id: "confirm", label: "确认继续", recommended: true },
      { id: "cancel", label: "暂不继续", recommended: false },
    ],
    actorUserId,
    projectId: "p",
    taskId: "task-1",
    intentEpoch: 0,
    planId: "coze:test",
    actionId,
    budgetPolicyVersion: "v1-standard",
    maxCostCredits: null,
    maxExternalProviderCalls: 3,
    expiresAt: null,
  };
}
