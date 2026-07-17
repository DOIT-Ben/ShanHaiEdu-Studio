import { isExplorationOnlyRequest, planCapabilityForRequest, planDeliveryForRequest } from "@/server/capabilities/capability-planner";
import type { CapabilityToolPlan, DeliveryPlan, MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";
import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import type { AgentWorldState } from "@/server/conversation/agent-world-state";
import type { ContextPackage } from "@/server/conversation/context-package";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import type { MainAgentReActBudgetExhausted, MainAgentReActCompletionContract, MainAgentReActContextTelemetry, MainAgentReActDispatchResult, MainAgentReActRecoveryCheckpoint, MainAgentReActRejectedToolCall, MainAgentReActSegmentCheckpoint, MainAgentReActToolSet } from "@/server/conversation/main-agent-controlled-react-loop";
import type { MainAgentReActCheckpoint, MainAgentReActCheckpointSeed } from "@/server/conversation/main-agent-react-checkpoint";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { IntentGrant, TaskBrief } from "./task-contract";
import { proposeDeterministicTaskBriefFixture, type TaskBriefProposalInput } from "./task-intake";
import type { SemanticContextSnapshot } from "./context-semantic-snapshot";
import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import type { PreAgentControlDecision } from "./turn-intake-control";
import { isBoundActionConfirmation } from "./conversation-control-resolver";

export type MainConversationAgentInput = {
  userMessage: string;
  toolControlPlane?: "native" | "outer";
  taskBrief?: TaskBrief;
  intentGrant?: IntentGrant | { standardWorkAuthorized: boolean };
  responseStyle?: XiaoKuResponseStyle;
  generationIntensity?: GenerationIntensity;
  availableArtifactKinds: string[];
  onProgress?: MainAgentProgressSink;
  projectContext?: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
  conversationContext?: {
    contextPackage?: ContextPackage;
    agentWorldState?: AgentWorldState;
    capabilityAvailability?: CapabilityAvailabilityEntry[];
    semanticSnapshot?: SemanticContextSnapshot;
    recentMessages: Array<{ role: "teacher" | "assistant" | "system"; content: string }>;
    latestAssistantContent?: string;
    pendingDeliveryPlan?: {
      teacherRequest: string;
      toolPlan: CapabilityToolPlan;
      deliveryPlan?: DeliveryPlan;
    };
  };
  agentToolLoop?: {
    tools: unknown[];
    allowedToolNames: readonly string[];
    prepareTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
    refreshTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
    describeToolCall?: (call: { toolName: string; arguments: Record<string, unknown> }) => {
      purpose?: string;
      inputSummary?: string[];
      expectedOutput?: string;
    } | Promise<{
      purpose?: string;
      inputSummary?: string[];
      expectedOutput?: string;
    }>;
    dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
    validateCompletion?: () => MainAgentReActCompletionContract | Promise<MainAgentReActCompletionContract>;
    maxToolRounds?: number;
    maxToolRoundsPerSegment?: number;
    resumeCheckpoint?: MainAgentReActCheckpoint;
    checkpointSeed?: MainAgentReActCheckpointSeed;
    getCheckpointSeed?: () => MainAgentReActCheckpointSeed;
    onContextTelemetry?: (event: MainAgentReActContextTelemetry) => void | Promise<void>;
    onRejectedToolCall?: (event: MainAgentReActRejectedToolCall) => void | Promise<void>;
    onBudgetExhausted?: (event: MainAgentReActBudgetExhausted) => void | Promise<void>;
    onSegmentCheckpoint?: (event: MainAgentReActSegmentCheckpoint) => void | Promise<void>;
    onRecoveryCheckpoint?: (event: MainAgentReActRecoveryCheckpoint) => void | Promise<void>;
  };
  replanDirective?: {
    reason: "tool_succeeded" | "tool_failed" | "quality_rework" | "completion_contract_unsatisfied";
    previousActionKey: string;
    observationIds: string[];
    remainingRequestedOutputs?: string[];
    repairAction?: "fix_inputs" | "retry_later" | "ask_teacher" | "do_not_retry_automatically";
    reliableDefaultsAvailable?: boolean;
  };
};

export type MainConversationAgent = {
  intakeTask?: (input: MainAgentTaskIntakeInput) => Promise<MainAgentTaskIntakeDecision>;
  respond(input: MainConversationAgentInput): Promise<MainAgentTurn>;
};

export type MainAgentTaskIntakeInput = {
  userMessage: string;
  responseStyle?: XiaoKuResponseStyle;
  generationIntensity: GenerationIntensity;
  projectContext: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
  activeTask?: Pick<TaskBrief, "taskId" | "digest" | "intentEpoch" | "goal" | "requestedOutputs" | "constraints" | "excludedOutputs">;
  recentMessages: Array<{ role: "teacher" | "assistant" | "system"; content: string }>;
  onProgress?: MainAgentProgressSink;
};

export type MainAgentTaskIntakeDecision =
  | { kind: "task"; proposal: TaskBriefProposalInput }
  | { kind: "control"; control: PreAgentControlDecision; replacementProposal?: TaskBriefProposalInput }
  | { kind: "conversation"; turn?: MainAgentTurn }
  | { kind: "failed"; turn: MainAgentTurn };

export function createDeterministicMainConversationAgent(): MainConversationAgent {
  const agent: MainConversationAgent = {
    async intakeTask(input) {
      const proposal = proposeDeterministicTaskBriefFixture(input.userMessage, {
        grade: input.projectContext.grade,
        subject: input.projectContext.subject,
        lessonTopic: input.projectContext.topic,
      });
      return proposal ? { kind: "task", proposal } : { kind: "conversation" };
    },
    async respond(input) {
      const text = input.userMessage.trim();
      const pendingPlan = input.conversationContext?.pendingDeliveryPlan;

      if (pendingPlan && (isBoundActionConfirmation(text, pendingPlan) || isShortConfirmation(text))) {
        return {
          assistantMessage: {
            body: pendingPlan.toolPlan.reasonForUser,
          },
          state: "running_tool",
          quickReplies: [],
          recommendedOptions: [],
          toolPlan: pendingPlan.toolPlan,
          deliveryPlan: pendingPlan.deliveryPlan,
          shouldRunToolNow: true,
          runtimeKind: "deterministic",
        };
      }

      if (isCasualChat(text)) {
        return {
          assistantMessage: {
            body: input.responseStyle === "concise"
              ? "你好，我是小酷。想先准备哪节课？"
              : "你好，我是小酷。你今天想准备哪一节课？告诉我年级和课题就可以开始。",
          },
          state: "chatting",
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      if (isExplorationOnlyRequest(text)) {
        return {
          assistantMessage: {
            body: "可以，我们先不急着生成材料。你可以先从课堂目标、导入情境和学生互动方式里选一个方向聊起。",
          },
          state: "exploring",
          quickReplies: [
            { label: "先聊导入", prompt: "先帮我想几个导入情境。", recommended: true },
            { label: "设计互动", prompt: "帮我设计几个课堂互动。" },
            { label: "开始整理需求", prompt: "我已经有方向了，帮我整理成备课需求。" },
          ],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      const plannerInput = {
        ...input,
        intentGrant: input.intentGrant,
        capabilityAvailability: input.conversationContext?.capabilityAvailability,
      };
      const toolPlan = planCapabilityForRequest(plannerInput);
      const deliveryPlan = planDeliveryForRequest(plannerInput) ?? undefined;
      if (!toolPlan) {
        return {
          assistantMessage: {
            body: "我先不启动生成。你可以补充年级、学科、课题和想要的交付物，我再帮你整理。",
          },
          state: "collecting_inputs",
          quickReplies: defaultCollectionReplies(),
          recommendedOptions: defaultRecommendedOptions(),
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      if (isUnavailableToolPlan(toolPlan)) {
        return {
          assistantMessage: {
            body: toolPlan.reasonForUser,
          },
          state: "collecting_inputs",
          quickReplies: defaultCollectionReplies(),
          recommendedOptions: [],
          toolPlan,
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      if (toolPlan.missingInputs.length > 0) {
        return {
          assistantMessage: {
            body: "可以做，但我还需要补齐年级、学科和课题，这样生成的内容才不会跑偏。",
          },
          state: "collecting_inputs",
          quickReplies: defaultCollectionReplies(),
          recommendedOptions: defaultRecommendedOptions(),
          toolPlan,
          shouldRunToolNow: false,
          runtimeKind: "deterministic",
        };
      }

      const shouldRunToolNow = !toolPlan.requiresConfirmation;
      return {
        assistantMessage: {
          title: "我理解你的任务",
          body: deliveryPlan
            ? "你想做一套完整公开课材料。我会先整理需求，再按计划推进教案、PPT、图片、导入视频和最终交付包。"
            : "你想做一套公开课相关材料。我会按本轮目标直接生成第一个必要成果，不扩张到未请求的交付物。",
        },
        state: shouldRunToolNow ? "running_tool" : "awaiting_confirmation",
        quickReplies: shouldRunToolNow ? [] : deliveryPlan ? deliveryPlanConfirmationReplies() : singleStepConfirmationReplies(),
        recommendedOptions: [],
        toolPlan,
        deliveryPlan,
        shouldRunToolNow,
        runtimeKind: "deterministic",
      };
    },
  };
  return agent;
}

function isUnavailableToolPlan(toolPlan: CapabilityToolPlan): boolean {
  return toolPlan.requiresConfirmation === false && toolPlan.internalReason.includes("capability_unavailable:");
}

function singleStepConfirmationReplies(): QuickReply[] {
  return [
    { label: "确认开始", prompt: "确认开始，先整理需求规格。", recommended: true },
    { label: "补充要求", prompt: "我想补充教学风格和课堂时长。" },
    { label: "先聊创意", prompt: "先不要生成，继续聊几个课堂创意。" },
  ];
}

function deliveryPlanConfirmationReplies(): QuickReply[] {
  return [
    { label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true },
    { label: "补充要求", prompt: "我想补充教学风格和课堂时长。" },
    { label: "先只做文本", prompt: "先只生成需求、教案和 PPT 大纲。" },
  ];
}

function isCasualChat(text: string): boolean {
  return ["你好", "您好", "hi", "hello", "在吗", "谢谢"].includes(text.toLowerCase());
}

function isShortConfirmation(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "").toLowerCase();
  if (["开始", "确认", "确认开始", "可以", "好的", "好", "ok", "继续", "下一步", "继续下一步", "没问题"].includes(normalized)) return true;
  return /确认开始|按这个计划推进|开始生成|可以生成|继续下一步|继续推进|继续生成/.test(normalized);
}

function defaultCollectionReplies(): QuickReply[] {
  return [
    { label: "三年级数学公开课", prompt: "我想做三年级数学公开课，需要教案和 PPT。", recommended: true },
    { label: "六年级百分数", prompt: "苏教版六年级百分数，帮我做公开课课件。" },
    { label: "先整理需求", prompt: "先帮我整理备课需求，我再补充信息。" },
  ];
}

function defaultRecommendedOptions(): RecommendedOption[] {
  return [
    { slot: "grade", label: "三年级", value: "三年级", recommended: true },
    { slot: "subject", label: "数学", value: "数学", recommended: true },
    { slot: "output", label: "教案 + PPT", value: "教案和 PPT" },
  ];
}
