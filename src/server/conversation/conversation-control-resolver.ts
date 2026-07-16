import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";
import { actionRiskForTool, evaluateActionPolicy } from "@/server/guards/action-policy";
import type { IntentGrant, PendingDecision } from "./task-contract";

export type ConversationControlDecisionKind =
  | "confirm_active_offer"
  | "switch_to_capability"
  | "clarify_offer"
  | "pause_active_offer"
  | "resume_paused_offer"
  | "cancel_active_offer"
  | "revise_active_offer"
  | "ordinary_message";

export type ConversationControlDecision = {
  kind: ConversationControlDecisionKind;
  reasonCode: string;
  targetCapabilityId?: CapabilityId;
  usePendingActionId?: boolean;
  supersedePendingAction?: boolean;
  pendingPlanStatus?: "paused" | "canceled" | "superseded";
  advanceIntentEpoch?: boolean;
  createPauseCheckpoint?: boolean;
};

export type ConversationControlPendingPlan = {
  status?: "pending" | "paused" | "confirmed" | "canceled" | "superseded";
  actionId?: string;
  teacherRequest: string;
  toolPlan: CapabilityToolPlan;
  deliveryPlan?: DeliveryPlan;
  intentGrant?: IntentGrant;
  pendingDecision?: PendingDecision;
};

export function resolveConversationControl(input: {
  userMessage: string;
  pendingPlan: ConversationControlPendingPlan | null;
  receivedConfirmedActionId?: string;
  receivedActorUserId?: string;
  agentTurn: MainAgentTurn;
  capabilityAvailability: CapabilityAvailabilityEntry[];
  intentGrant?: IntentGrant;
  externalProviderCallsUsed?: number;
}): { decision: ConversationControlDecision; turn: MainAgentTurn } {
  const targetCapabilityId = input.agentTurn.toolPlan?.capabilityId;
  const pendingCapabilityId = input.pendingPlan?.toolPlan.capabilityId;

  if (input.pendingPlan && isExplicitPause(input.userMessage)) {
    return {
      decision: {
        kind: "pause_active_offer",
        reasonCode: "teacher_paused_active_offer",
        targetCapabilityId: pendingCapabilityId,
        supersedePendingAction: true,
        pendingPlanStatus: "paused",
        createPauseCheckpoint: true,
      },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: "已暂停刚才的任务，当前内容会保留。需要继续时直接告诉我恢复刚才的任务。" },
        state: "chatting",
        toolPlan: undefined,
        deliveryPlan: undefined,
        shouldRunToolNow: false,
        artifactRefs: [],
      },
    };
  }

  if (input.pendingPlan && isExplicitCancellation(input.userMessage)) {
    return {
      decision: {
        kind: "cancel_active_offer",
        reasonCode: "teacher_cancelled_active_offer",
        targetCapabilityId: pendingCapabilityId,
        supersedePendingAction: true,
        pendingPlanStatus: "canceled",
        advanceIntentEpoch: true,
      },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: "已取消刚才待执行的内容。你可以直接告诉我接下来要调整什么。" },
        state: "chatting",
        toolPlan: undefined,
        deliveryPlan: undefined,
        shouldRunToolNow: false,
        artifactRefs: [],
      },
    };
  }

  if (input.pendingPlan?.status === "paused" && isExplicitResume(input.userMessage)) {
    const requiresHumanGate = requiresHumanGateForPendingPlan(
      input.pendingPlan,
      pendingCapabilityId!,
      input.externalProviderCallsUsed,
    );
    return {
      decision: {
        kind: "resume_paused_offer",
        reasonCode: "teacher_resumed_paused_offer",
        targetCapabilityId: pendingCapabilityId,
        supersedePendingAction: true,
        pendingPlanStatus: "superseded",
      },
      turn: {
        ...input.agentTurn,
        assistantMessage: {
          body: requiresHumanGate
            ? "已恢复刚才的任务。这一步需要先完成对应授权或预算决定。"
            : input.pendingPlan.toolPlan.reasonForUser,
        },
        state: requiresHumanGate ? "awaiting_confirmation" : "running_tool",
        toolPlan: { ...input.pendingPlan.toolPlan, requiresConfirmation: requiresHumanGate },
        deliveryPlan: input.pendingPlan.deliveryPlan,
        shouldRunToolNow: !requiresHumanGate,
        artifactRefs: [],
      },
    };
  }

  if (input.pendingPlan && hasMainAgentSelectedReplacement(input.pendingPlan, input.agentTurn)) {
    const changesCapability = targetCapabilityId !== pendingCapabilityId;
    return {
      decision: {
        kind: changesCapability ? "switch_to_capability" : "revise_active_offer",
        reasonCode: changesCapability ? "main_agent_selected_capability_switch" : "main_agent_selected_plan_revision",
        targetCapabilityId,
        supersedePendingAction: true,
        pendingPlanStatus: "superseded",
        advanceIntentEpoch: true,
      },
      turn: normalizeExecutionPolicy(
        input.agentTurn,
        input.intentGrant ?? input.pendingPlan.intentGrant,
        input.externalProviderCallsUsed,
      ),
    };
  }

  if (input.pendingPlan?.status === "paused") {
    return {
      decision: { kind: "clarify_offer", reasonCode: "paused_offer_requires_resume", targetCapabilityId: pendingCapabilityId },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: "刚才的任务仍处于暂停状态。你可以说“恢复刚才的任务”，或者告诉我新的方向。" },
        state: "chatting",
        toolPlan: undefined,
        deliveryPlan: undefined,
        shouldRunToolNow: false,
        artifactRefs: [],
      },
    };
  }

  if (input.pendingPlan?.pendingDecision && input.receivedActorUserId &&
      input.pendingPlan.pendingDecision.actorUserId !== input.receivedActorUserId) {
    return {
      decision: { kind: "ordinary_message", reasonCode: "pending_action_actor_mismatch", targetCapabilityId: pendingCapabilityId },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: "当前确认属于另一位成员发起的任务，请由原发起人确认或重新发起。" },
        state: "awaiting_confirmation",
        shouldRunToolNow: false,
      },
    };
  }

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

  if (input.pendingPlan && (isExplicitConfirmation(input.userMessage, pendingCapabilityId) ||
      (input.pendingPlan.intentGrant?.standardWorkAuthorized && isTaskControlConfirmation(input.userMessage)))) {
    const requiresHumanGate = requiresHumanGateForPendingPlan(input.pendingPlan, pendingCapabilityId!, input.externalProviderCallsUsed);
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
        toolPlan: { ...input.pendingPlan.toolPlan, requiresConfirmation: requiresHumanGate },
        deliveryPlan: input.pendingPlan.deliveryPlan,
        shouldRunToolNow: !requiresHumanGate || Boolean(input.receivedConfirmedActionId),
      },
    };
  }

  if (input.pendingPlan && isContinuationSelection(input.userMessage) && requiresHumanGateForPendingPlan(input.pendingPlan, pendingCapabilityId!, input.externalProviderCallsUsed)) {
    return {
      decision: { kind: "clarify_offer", reasonCode: "high_cost_continuation_requires_bound_confirmation", targetCapabilityId: pendingCapabilityId },
      turn: {
        ...input.agentTurn,
        assistantMessage: { body: `${input.pendingPlan.toolPlan.reasonForUser}这一步会生成真实文件或调用外部生成能力，请使用当前确认选项明确授权后开始。` },
        state: "awaiting_confirmation",
        toolPlan: { ...input.pendingPlan.toolPlan, requiresConfirmation: false },
        deliveryPlan: input.pendingPlan.deliveryPlan,
        shouldRunToolNow: false,
      },
    };
  }

  if (input.pendingPlan && isContinuationSelection(input.userMessage) && input.pendingPlan.intentGrant?.standardWorkAuthorized) {
    return {
      decision: {
        kind: "confirm_active_offer",
        reasonCode: "continue_active_standard_task",
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

  const turn = normalizeExecutionPolicy(input.agentTurn, input.intentGrant, input.externalProviderCallsUsed);
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
  return tool.requiresHumanGate || actionRiskForTool(tool) === "external_generation";
}

function requiresHumanGateForPendingPlan(plan: ConversationControlPendingPlan, capabilityId: CapabilityId, externalProviderCallsUsed = 0) {
  if (!plan.intentGrant) return toolRequiresHumanGate(capabilityId);
  const tool = getToolDefinitionByCapabilityId(capabilityId);
  return evaluateActionPolicy({
    risk: actionRiskForTool(tool),
    intentGrant: plan.intentGrant,
    externalProviderCallsUsed,
  }).kind === "human_gate";
}

export function normalizeExecutionPolicy(turn: MainAgentTurn, intentGrant?: IntentGrant, externalProviderCallsUsed = 0): MainAgentTurn {
  if (!turn.toolPlan || turn.toolPlan.missingInputs.length > 0) return turn;
  const tool = getToolDefinitionByCapabilityId(turn.toolPlan.capabilityId);
  if (!intentGrant && actionRiskForTool(tool) === "internal" && tool.adapterKind === "internal_capability" && !tool.requiresHumanGate) {
    return turn;
  }
  const requiresHumanGate = evaluateActionPolicy({
    risk: actionRiskForTool(tool),
    intentGrant,
    externalProviderCallsUsed,
  }).kind === "human_gate";
  const toolPlan = { ...turn.toolPlan, requiresConfirmation: requiresHumanGate };

  if (requiresHumanGate && turn.shouldRunToolNow) {
    return { ...turn, state: "awaiting_confirmation", toolPlan, shouldRunToolNow: false };
  }
  if (!requiresHumanGate && !turn.shouldRunToolNow && isExecutionReadyState(turn.state)) {
    return { ...turn, state: "running_tool", toolPlan, shouldRunToolNow: true };
  }
  return { ...turn, toolPlan };
}

function isExecutionReadyState(state: MainAgentTurn["state"]) {
  return state === "awaiting_confirmation" || state === "planning_tools" ||
    state === "running_tool" || state === "continuing_workflow";
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

function isExplicitCancellation(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "");
  return /(?:取消|拒绝|算了|不做|停止|终止|先不做|暂时不做|不要做)(?:这一步|刚才|当前|任务|了|$)/.test(normalized)
    || /(?:这一步|刚才|当前).*(?:取消|停止|先不做|暂时不做)/.test(normalized);
}

function isExplicitPause(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "");
  return /(?:暂停|停一下|先停|先放一放|稍后再继续)(?:这一步|刚才|当前|任务|了|$)/.test(normalized)
    || /(?:这一步|刚才|当前|任务).*(?:暂停|停一下|先停)/.test(normalized);
}

function isExplicitResume(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "");
  return /(?:恢复|继续|接着)(?:刚才|之前|上次|暂停的)?的?(?:任务|计划|那一步)/.test(normalized)
    || /(?:刚才|之前|上次|暂停的)(?:任务|计划|那一步).*(?:恢复|继续|接着)/.test(normalized);
}

function isContinuationSelection(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
  return /^(继续|接着做|继续下一步|继续推进|往下做|按计划继续)$/.test(normalized);
}

function isTaskControlConfirmation(text: string): boolean {
  return /^确定[。.!！]?$/.test(text.trim());
}

function hasMainAgentSelectedReplacement(plan: ConversationControlPendingPlan, turn: MainAgentTurn) {
  const selected = turn.toolPlan;
  if (!selected) return false;
  return selected.capabilityId !== plan.toolPlan.capabilityId ||
    selected.planId !== plan.toolPlan.planId ||
    JSON.stringify(selected.inputDraft) !== JSON.stringify(plan.toolPlan.inputDraft);
}
