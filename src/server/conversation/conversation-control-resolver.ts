import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinition } from "@/server/capabilities/capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";

export type ConversationControlDecisionKind =
  | "confirm_active_offer"
  | "switch_to_capability"
  | "clarify_offer"
  | "cancel_active_offer"
  | "revise_active_offer"
  | "ordinary_message";

export type ConversationControlDecision = {
  kind: ConversationControlDecisionKind;
  reasonCode: string;
  targetCapabilityId?: CapabilityId;
  usePendingActionId?: boolean;
  supersedePendingAction?: boolean;
};

export type ConversationControlPendingPlan = {
  actionId?: string;
  teacherRequest: string;
  toolPlan: CapabilityToolPlan;
  deliveryPlan?: DeliveryPlan;
};

export function resolveConversationControl(input: {
  userMessage: string;
  pendingPlan: ConversationControlPendingPlan | null;
  receivedConfirmedActionId?: string;
  agentTurn: MainAgentTurn;
  capabilityAvailability: CapabilityAvailabilityEntry[];
}): { decision: ConversationControlDecision; turn: MainAgentTurn } {
  const targetCapabilityId = resolveRequestedCapability(input.userMessage);
  const pendingCapabilityId = input.pendingPlan?.toolPlan.capabilityId;

  if (input.pendingPlan && input.receivedConfirmedActionId && input.receivedConfirmedActionId !== input.pendingPlan.actionId) {
    return {
      decision: { kind: "ordinary_message", reasonCode: "mismatched_confirmed_action_id", targetCapabilityId: pendingCapabilityId },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: "当前确认与待执行内容不匹配，请使用当前有效选项重新确认。" },
        state: toolRequiresHumanGate(pendingCapabilityId!) ? "awaiting_confirmation" : "collecting_inputs",
        shouldRunToolNow: false,
      },
    };
  }

  if (input.pendingPlan && input.receivedConfirmedActionId === input.pendingPlan.actionId) {
    return {
      decision: {
        kind: "confirm_active_offer",
        reasonCode: "bound_action_id_confirmation",
        targetCapabilityId: pendingCapabilityId,
      },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: input.pendingPlan.toolPlan.reasonForUser },
        state: "running_tool",
        toolPlan: input.pendingPlan.toolPlan,
        deliveryPlan: input.pendingPlan.deliveryPlan,
        shouldRunToolNow: true,
      },
    };
  }

  if (input.pendingPlan && targetCapabilityId && targetCapabilityId !== pendingCapabilityId) {
    return {
      decision: {
        kind: "switch_to_capability",
        reasonCode: "explicit_capability_switch",
        targetCapabilityId,
        supersedePendingAction: true,
      },
      turn: buildCapabilityTurn(targetCapabilityId, input.userMessage, input.capabilityAvailability, input.agentTurn.runtimeKind),
    };
  }

  if (input.pendingPlan && isExplicitConfirmation(input.userMessage, pendingCapabilityId)) {
    const requiresHumanGate = toolRequiresHumanGate(pendingCapabilityId!);
    return {
      decision: {
        kind: "confirm_active_offer",
        reasonCode: "explicit_confirmation_of_unique_pending_action",
        targetCapabilityId: pendingCapabilityId,
        usePendingActionId: !requiresHumanGate && Boolean(input.pendingPlan.actionId),
      },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: input.pendingPlan.toolPlan.reasonForUser },
        state: requiresHumanGate && !input.receivedConfirmedActionId ? "awaiting_confirmation" : "running_tool",
        toolPlan: input.pendingPlan.toolPlan,
        deliveryPlan: input.pendingPlan.deliveryPlan,
        shouldRunToolNow: !requiresHumanGate || Boolean(input.receivedConfirmedActionId),
      },
    };
  }

  if (targetCapabilityId && (!input.agentTurn.toolPlan || input.agentTurn.toolPlan.capabilityId !== targetCapabilityId)) {
    return {
      decision: { kind: "switch_to_capability", reasonCode: "direct_capability_request", targetCapabilityId },
      turn: buildCapabilityTurn(targetCapabilityId, input.userMessage, input.capabilityAvailability, input.agentTurn.runtimeKind),
    };
  }

  const turn = normalizeExecutionPolicy(input.agentTurn);
  return {
    decision: {
      kind: "ordinary_message",
      reasonCode: turn !== input.agentTurn ? "tool_execution_policy_normalized" : "no_control_override",
      targetCapabilityId: turn.toolPlan?.capabilityId,
    },
    turn,
  };
}

export function toolRequiresHumanGate(capabilityId: CapabilityId): boolean {
  const tool = getToolDefinitionByCapabilityId(capabilityId);
  return tool.requiresHumanGate || tool.adapterKind === "provider" || tool.adapterKind === "package" || tool.sideEffectLevel === "external_call" || tool.sideEffectLevel === "package_write";
}

function normalizeExecutionPolicy(turn: MainAgentTurn): MainAgentTurn {
  if (!turn.toolPlan || turn.toolPlan.missingInputs.length > 0) return turn;
  const requiresHumanGate = toolRequiresHumanGate(turn.toolPlan.capabilityId);
  const toolPlan = { ...turn.toolPlan, requiresConfirmation: requiresHumanGate };

  if (requiresHumanGate && turn.shouldRunToolNow) {
    return { ...turn, state: "awaiting_confirmation", toolPlan, shouldRunToolNow: false };
  }
  return turn;
}

function buildCapabilityTurn(
  capabilityId: CapabilityId,
  teacherRequest: string,
  availabilityEntries: CapabilityAvailabilityEntry[],
  runtimeKind: MainAgentTurn["runtimeKind"],
): MainAgentTurn {
  const capability = getCapabilityDefinition(capabilityId);
  const availability = availabilityEntries.find((entry) => entry.capabilityId === capabilityId);
  const available = !availability || availability.status === "available";
  const requiresHumanGate = toolRequiresHumanGate(capabilityId);
  const toolPlan: CapabilityToolPlan = {
    planId: `${capabilityId}:conversation-control`,
    capabilityId,
    reasonForUser: available ? `我可以为你${capability.userLabel}。` : availability.reasonForUser,
    internalReason: "conversation_control_direct_capability_request",
    inputDraft: { teacherGoal: teacherRequest },
    missingInputs: availability?.missingApprovedInputs ?? [],
    upstreamPlan: [],
    nextSuggestedCapabilities: [],
    requiresConfirmation: available && requiresHumanGate,
    expectedArtifactKind: capability.artifactKind,
  };

  if (!available) {
    return {
      assistantMessage: { body: availability.reasonForUser },
      state: availability.status === "provider_unavailable" || availability.status === "blocked" ? "failed_blocked" : "collecting_inputs",
      quickReplies: [],
      recommendedOptions: [],
      toolPlan,
      shouldRunToolNow: false,
      runtimeKind,
    };
  }

  return {
    assistantMessage: {
      body: requiresHumanGate
        ? `${toolPlan.reasonForUser}这一步会生成真实文件或调用外部生成能力，需要你明确确认后开始。`
        : toolPlan.reasonForUser,
    },
    state: requiresHumanGate ? "awaiting_confirmation" : "running_tool",
    quickReplies: requiresHumanGate ? [{ label: "确认开始", prompt: `确认${capability.userLabel}。`, recommended: true }] : [],
    recommendedOptions: [],
    toolPlan,
    shouldRunToolNow: !requiresHumanGate,
    runtimeKind,
  };
}

function resolveRequestedCapability(text: string): CapabilityId | undefined {
  const normalized = text.trim();
  if (/完整|材料包|交付包|全套|一套|包括.*(?:教案|PPT|图片|视频)/i.test(normalized)) return undefined;
  const matchers: Array<[CapabilityId, RegExp]> = [
    ["video_segment_generate", /生成(?:最终)?视频|视频片段/],
    ["storyboard_generate", /分镜/],
    ["video_script_generate", /视频脚本|导入脚本/],
    ["coze_ppt", /(?:真实|可下载|文件).*PPT|PPTX/i],
    ["ppt_design", /PPT\s*设计稿|课件设计稿/i],
    ["ppt_outline", /PPT\s*大纲|课件大纲/i],
    ["lesson_plan", /教案|教学设计/],
    ["requirement_spec", /需求规格|整理(?:备课)?需求/],
  ];
  return matchers.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function isExplicitConfirmation(text: string, capabilityId?: CapabilityId): boolean {
  const normalized = text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
  if (/^(确认开始|确认执行|就按这个做|按这个做|开始生成|确认生成|确认并开始)$/.test(normalized)) return true;
  if (!capabilityId || !/确认|开始|生成|执行/.test(normalized)) return false;
  const capabilityTerms: Partial<Record<CapabilityId, RegExp>> = {
    requirement_spec: /需求/,
    lesson_plan: /教案|教学设计/,
    ppt_outline: /PPT|课件|大纲/i,
    ppt_design: /PPT|课件|设计稿/i,
    coze_ppt: /PPT|PPTX|课件/i,
    video_script_generate: /视频脚本|导入脚本/,
    storyboard_generate: /分镜/,
    video_segment_generate: /视频|片段/,
  };
  return capabilityTerms[capabilityId]?.test(normalized) ?? false;
}
