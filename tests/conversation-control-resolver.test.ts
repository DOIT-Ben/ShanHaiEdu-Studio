import { describe, expect, it } from "vitest";
import { resolveConversationControl } from "@/server/conversation/conversation-control-resolver";
import type { MainAgentTurn } from "@/server/capabilities/types";

const baseTurn: MainAgentTurn = {
  assistantMessage: { body: "好的" },
  state: "chatting",
  quickReplies: [],
  recommendedOptions: [],
  shouldRunToolNow: false,
  runtimeKind: "deterministic",
};

describe("ConversationControlResolver", () => {
  it("runs a directly requested safe internal capability without forcing linear order", () => {
    const result = resolveConversationControl({
      userMessage: "只做视频脚本",
      pendingPlan: null,
      agentTurn: baseTurn,
      capabilityAvailability: [{
        capabilityId: "video_script_generate",
        status: "available",
        requiresConfirmation: true,
        missingApprovedInputs: [],
        reasonForModel: "available",
        reasonForUser: "可以继续。",
      }],
    });

    expect(result.decision).toMatchObject({ kind: "switch_to_capability", targetCapabilityId: "video_script_generate" });
    expect(result.turn).toMatchObject({ state: "running_tool", shouldRunToolNow: true, toolPlan: { requiresConfirmation: false } });
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
    const result = resolveConversationControl({
      userMessage: "先不要做 PPT，改做视频脚本",
      pendingPlan: {
        actionId: "human:p:ppt_outline:m1",
        teacherRequest: "做 PPT 大纲",
        toolPlan: {
          planId: "ppt:test",
          capabilityId: "ppt_outline",
          reasonForUser: "做 PPT 大纲",
          internalReason: "test",
          inputDraft: {},
          missingInputs: [],
          upstreamPlan: [],
          nextSuggestedCapabilities: [],
          requiresConfirmation: false,
          expectedArtifactKind: "ppt_draft",
        },
      },
      agentTurn: baseTurn,
      capabilityAvailability: [],
    });

    expect(result.decision).toMatchObject({ kind: "switch_to_capability", targetCapabilityId: "video_script_generate", supersedePendingAction: true });
    expect(result.turn.toolPlan?.capabilityId).toBe("video_script_generate");
  });

  it("does not turn natural language into provider HumanGate confirmation", () => {
    const pendingPlan = {
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
    const pendingPlan = {
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
});
