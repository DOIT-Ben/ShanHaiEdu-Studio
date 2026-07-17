import OpenAI from "openai";
import { createOpenAICompatibleConfigDigest, pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentState, MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import type { GptProtocolResponse } from "@/server/gpt-protocol/types";
import {
  createDeterministicMainConversationAgent,
  type MainAgentTaskIntakeDecision,
  type MainAgentTaskIntakeInput,
  type MainConversationAgent,
  type MainConversationAgentInput,
} from "./main-conversation-agent";
import { runMainAgentControlledReActLoop } from "./main-agent-controlled-react-loop";
import { projectMainAgentRequestContext } from "./main-agent-request-context";
import { mainAgentRoundBudgetPauseSummary } from "./main-agent-run-pause";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import type { OpenAIReasoningEffort } from "@/server/openai-compatible-config";
import { classifyMainAgentFailure, type MainAgentFailurePhase } from "./main-agent-failure";
import { validateTaskBriefProposal } from "./task-intake";
import { TASK_REQUESTED_OUTPUTS } from "./task-contract";
import {
  createNaturalLanguageMainAgentStreamProjection,
  createStructuredMainAgentStreamProjection,
} from "./main-agent-stream-projection";

type OpenAIMainConversationAgentOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
  onFailureDiagnostic?: (event: MainAgentFailureDiagnostic) => void;
  runtimeEvidenceDigest?: string;
};

export type MainAgentFailureDiagnostic = {
  phase: "direct_response" | "agent_tool_loop" | "output_parse";
  reason: string;
  errorName: string;
  summary: string;
  reasonCode?: string;
  retryability?: string;
};

type StructuredMainAgentOutput = {
  assistantMessage: {
    title?: string;
    body: string;
  };
  state: MainAgentState;
  quickReplies?: QuickReply[];
  recommendedOptions?: RecommendedOption[];
  shouldRunToolNow?: boolean;
  toolPlan?: Partial<CapabilityToolPlan> & {
    capabilityId: CapabilityId;
  };
  deliveryPlan?: {
    mode?: "full" | "none";
  };
};

const fullDeliveryStepIds: CapabilityId[] = [
  "requirement_spec",
  "lesson_plan",
  "ppt_outline",
  "ppt_design",
  "ppt_sample_assets",
  "ppt_key_samples",
  "ppt_full_assets",
  "ppt_full_deck",
  "image_asset",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "concat_only_assemble",
  "final_package",
];
const capabilityIdEnum = getCapabilityDefinitions().map((capability) => capability.id);
const repeatableOuterCapabilityIds = new Set<CapabilityId>(["ppt_page_repair", "video_segment_generate"]);
const defaultMainAgentTimeoutMs = 180_000;
const minimumMainAgentTimeoutMs = 10_000;

export class OpenAIMainConversationAgent implements MainConversationAgent {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly reasoningEffort: OpenAIReasoningEffort;
  private readonly onFailureDiagnostic?: (event: MainAgentFailureDiagnostic) => void;
  private readonly runtimeEvidenceDigest?: string;

  constructor(options: OpenAIMainConversationAgentOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
    this.onFailureDiagnostic = options.onFailureDiagnostic;
    this.runtimeEvidenceDigest = options.runtimeEvidenceDigest;
  }

  async intakeTask(input: MainAgentTaskIntakeInput): Promise<MainAgentTaskIntakeDecision> {
    try {
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: this.model });
      const response = await adapter.createResponse({
        ...buildTaskIntakeRequest(input, "low"),
        onStreamEvent: createNaturalLanguageMainAgentStreamProjection(input.onProgress),
      });
      if (response.diagnostics.status === "failed") {
        throw new MainAgentExecutionError("direct_response", "task_intake_transport_failed", response.diagnostics.errorMessage);
      }
      return parseTaskIntakeDecision(response, input.userMessage);
    } catch (error) {
      const diagnostic = toMainAgentFailureDiagnostic(error);
      const failure = classifyMainAgentFailure({
        phase: diagnostic.phase,
        reason: diagnostic.reason,
        diagnosticSummary: diagnostic.summary,
        evidenceDigest: this.runtimeEvidenceDigest,
      });
      this.onFailureDiagnostic?.({ ...diagnostic, reasonCode: failure.reasonCode, retryability: failure.retryability });
      return {
        kind: "failed",
        turn: {
          assistantMessage: { body: failure.summary },
          state: "failed_retryable",
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai",
          failure,
        },
      };
    }
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    try {
      const strategy = input.generationIntensity ? resolveGenerationIntensityStrategy(input.generationIntensity) : null;
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: strategy?.model ?? this.model });
      const naturalControlPlane = nativeToolControlPlaneOwnsTurn(input);
      const request = {
        ...buildMainAgentRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort),
        onStreamEvent: naturalControlPlane
          ? createNaturalLanguageMainAgentStreamProjection(input.onProgress)
          : createStructuredMainAgentStreamProjection(input.onProgress),
      };
      let assistantText: string;
      if (input.agentToolLoop) {
        assistantText = await runMainAgentToolLoop(adapter, request, input.agentToolLoop, input.onProgress);
      } else {
        const response = await adapter.createResponse(request);
        if (response.diagnostics.status === "failed") {
          throw new MainAgentExecutionError("direct_response", "adapter_failed", response.diagnostics.errorMessage);
        }
        if (!response.assistantText.trim()) throw new MainAgentExecutionError("direct_response", "empty_output");
        assistantText = response.assistantText;
      }
      if (naturalControlPlane) return naturalMainAgentTurn(assistantText, input);
      try {
        let turn = normalizeModelTurn(parseMainAgentOutput(assistantText), input);
        if (input.replanDirective?.reason === "completion_contract_unsatisfied" &&
            !turn.toolPlan &&
            turn.state !== "failed_blocked" &&
            turn.state !== "failed_retryable") {
          const availableCapabilityIds = outerToolPlanCapabilityIds(input);
          if (availableCapabilityIds.length === 0) {
            throw new MainAgentExecutionError("output_parse", "completion_contract_no_available_tool");
          }
          const repairResponse = await adapter.createResponse(buildCompletionContractRepairRequest(
            input,
            availableCapabilityIds,
            strategy?.reasoningEffort ?? this.reasoningEffort,
            createStructuredMainAgentStreamProjection(input.onProgress),
          ));
          if (repairResponse.diagnostics.status === "failed") {
            throw new MainAgentExecutionError("direct_response", "completion_contract_repair_failed", repairResponse.diagnostics.errorMessage);
          }
          if (!repairResponse.assistantText.trim()) {
            throw new MainAgentExecutionError("direct_response", "completion_contract_repair_empty");
          }
          turn = normalizeModelTurn(parseMainAgentOutput(repairResponse.assistantText), input);
          if (!turn.toolPlan || !turn.shouldRunToolNow) {
            throw new MainAgentExecutionError("output_parse", "completion_contract_repair_invalid");
          }
        }
        if (input.replanDirective?.reason === "tool_failed" &&
            input.replanDirective.repairAction === "fix_inputs" &&
            input.replanDirective.reliableDefaultsAvailable === true &&
            !turn.toolPlan) {
          const availableCapabilityIds = outerToolPlanCapabilityIds(input);
          if (availableCapabilityIds.length === 0) {
            throw new MainAgentExecutionError("output_parse", "tool_failure_repair_no_available_tool");
          }
          const repairResponse = await adapter.createResponse(buildToolFailureRepairRequest(
            input,
            availableCapabilityIds,
            strategy?.reasoningEffort ?? this.reasoningEffort,
            createStructuredMainAgentStreamProjection(input.onProgress),
          ));
          if (repairResponse.diagnostics.status === "failed") {
            throw new MainAgentExecutionError("direct_response", "tool_failure_repair_failed", repairResponse.diagnostics.errorMessage);
          }
          if (!repairResponse.assistantText.trim()) {
            throw new MainAgentExecutionError("direct_response", "tool_failure_repair_empty");
          }
          turn = normalizeModelTurn(parseMainAgentOutput(repairResponse.assistantText), input);
          if (!turn.toolPlan || !turn.shouldRunToolNow) {
            throw new MainAgentExecutionError("output_parse", "tool_failure_repair_invalid");
          }
        }
        return turn;
      } catch (error) {
        throw error instanceof MainAgentExecutionError
          ? error
          : new MainAgentExecutionError("output_parse", classifyMainAgentOutputError(error), errorMessage(error));
      }
    } catch (error) {
      if (isRecoverableAgentToolLoopPause(error)) return recoverableAgentToolLoopPauseTurn(error.reason);
      const diagnostic = toMainAgentFailureDiagnostic(error);
      const failure = classifyMainAgentFailure({
        phase: diagnostic.phase,
        reason: diagnostic.reason,
        diagnosticSummary: diagnostic.summary,
        evidenceDigest: this.runtimeEvidenceDigest,
      });
      this.onFailureDiagnostic?.({ ...diagnostic, reasonCode: failure.reasonCode, retryability: failure.retryability });
      return {
        assistantMessage: {
          body: "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。请稍后重试，或联系管理员检查配置。",
        },
        state: "failed_retryable",
        quickReplies: [{ label: "重试", prompt: input.userMessage, recommended: true }],
        recommendedOptions: [],
        shouldRunToolNow: false,
        runtimeKind: "openai",
        failure,
      };
    }
  }
}

export function createMainConversationAgentFromEnv(env: OpenAICompatibleEnv = process.env): MainConversationAgent {
  if (resolveMainAgentToolControlPlane(env) === "outer") {
    return createDeterministicMainConversationAgent();
  }

  const config = pickOpenAICompatibleConfig(env);
  if (!config) {
    return new ModelUnavailableMainConversationAgent();
  }

  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: resolveMainAgentTimeoutMs(env),
    maxRetries: 0,
  }) as OpenAIResponsesClient;

  return new OpenAIMainConversationAgent({
    client,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    runtimeEvidenceDigest: createOpenAICompatibleConfigDigest(config),
    onFailureDiagnostic: (event) => console.error("[main-agent-failure]", JSON.stringify(event)),
  });
}

function buildTaskIntakeRequest(input: MainAgentTaskIntakeInput, reasoningEffort: OpenAIReasoningEffort) {
  return {
    reasoning: { effort: reasoningEffort },
    instructions: [
      "你是山海课伴的同一主控备课 Agent，当前只负责理解教师本轮话语，尚未开放任何业务 Tool。",
      "不要用关键词匹配或固定流程决定范围；结合完整语义、否定、局部任务、数量、教材和创意约束理解教师真实目标。",
      "如果存在 activeTask，先判断教师是在讨论可能性、回答问题、补充当前任务，还是明确暂停、取消或实质改道；不能仅因出现‘改成’‘不要’‘只做’等词就判定控制意图。",
      "只有教师明确要求停止当前方向并采用新的交付范围时调用 revise_active_task；边界模糊、只是比较方案或否定你的误解时，直接用自然中文追问，不调用函数。",
      "教师明确要求暂停或取消当前任务时调用 submit_conversation_control；它不是业务能力门禁，也不能用于例行确认。",
      "kind=task 仅用于教师明确要求形成可交付备课成果；问候、闲聊、探索、信息不足或仅提问时使用 kind=conversation。",
      "任务输出只能使用以下 canonical output：requirement_spec、textbook_evidence、lesson_plan、interactive_courseware_spec、ppt_outline、ppt_design、ppt_sample_assets、ppt_key_samples、ppt_full_assets、ppt、knowledge_anchor、creative_theme、video_script、storyboard、asset_brief、video_assets、video_segment_plan、video_narration、video_shot、image、video、package。",
      "只列教师真实要求的终点，不把 ppt_outline 扩张为 ppt_design、图片或最终PPT，不把 video_script、storyboard、asset_brief 扩张为图片、成片或package。完整材料包只在教师明确要求时列出，并保留所有排除项。",
      "constraints 必须保留年级、学科、课题、教材、页数、时长、创意、课程锚点和其他会影响执行的要求。",
      "没有 activeTask 时，明确交付任务只调用 submit_task_brief；存在 activeTask 时，实质修订只调用 revise_active_task。调用函数时不要同时输出解释文本。",
      "不得把任务提案 JSON、函数参数、provider、schema、API、密钥、本地路径或其他工程词写进教师回复。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      responseStyle: input.responseStyle ?? "pragmatic",
      generationIntensity: input.generationIntensity,
      projectContext: input.projectContext,
      activeTask: input.activeTask,
      recentMessages: input.recentMessages.slice(-8),
    }),
    tools: input.activeTask
      ? [reviseActiveTaskTool, submitConversationControlTool]
      : [submitTaskBriefTool],
    toolChoice: "auto" as const,
    parallelToolCalls: false,
    promptCacheKey: "shanhai-task-intake:v3",
  };
}

function parseTaskIntakeDecision(response: GptProtocolResponse, originalGoal: string): MainAgentTaskIntakeDecision {
  if (response.functionCalls.length > 1) {
    throw new MainAgentExecutionError("output_parse", "task_intake_multiple_calls");
  }
  const taskCall = response.functionCalls[0];
  if (taskCall) {
    if (taskCall.argumentsJsonParseStatus !== "parsed" || !taskCall.argumentsJson) {
      throw new MainAgentExecutionError("output_parse", "task_intake_bad_arguments");
    }
    if (taskCall.name === "submit_conversation_control") {
      const action = taskCall.argumentsJson.action;
      if (action !== "pause" && action !== "cancel") {
        throw new MainAgentExecutionError("output_parse", "task_intake_bad_control_action");
      }
      return {
        kind: "control",
        control: {
          kind: action,
          reasonCode: action === "pause" ? "teacher_requested_pause" : "teacher_requested_cancel",
          advanceIntentEpoch: action === "cancel",
          userMessage: originalGoal.trim(),
        },
      };
    }
    if (taskCall.name !== "submit_task_brief" && taskCall.name !== "revise_active_task") {
      throw new MainAgentExecutionError("output_parse", "task_intake_unknown_call");
    }
    const proposal = validateTaskBriefProposal({
      ...taskCall.argumentsJson,
      goal: originalGoal.trim(),
    } as Parameters<typeof validateTaskBriefProposal>[0]);
    if (taskCall.name === "revise_active_task") {
      return {
        kind: "control",
        control: {
          kind: "redirect",
          reasonCode: "teacher_requested_redirect",
          advanceIntentEpoch: true,
          userMessage: originalGoal.trim(),
        },
        replacementProposal: proposal,
      };
    }
    return { kind: "task", proposal };
  }
  const body = response.assistantText.trim();
  if (!body) throw new MainAgentExecutionError("output_parse", "task_intake_missing_output");
  return {
    kind: "conversation",
    turn: {
      assistantMessage: { body },
      state: "chatting",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
      runtimeKind: "openai",
    },
  };
}

const submitTaskBriefTool = {
  type: "function" as const,
  name: "submit_task_brief",
  description: "提交教师明确要求执行的备课交付任务。问候、闲聊、探索、信息不足或仅提问时不要调用。",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["goal", "requestedOutputs", "constraints", "excludedOutputs"],
    properties: {
      goal: { type: "string", description: "用一句话概括教师的真实交付目标。" },
      requestedOutputs: {
        type: "array",
        items: { type: "string", enum: [...TASK_REQUESTED_OUTPUTS] },
      },
      constraints: { type: "array", items: { type: "string" } },
      excludedOutputs: {
        type: "array",
        items: { type: "string", enum: [...TASK_REQUESTED_OUTPUTS] },
      },
    },
  },
} as const;

const reviseActiveTaskTool = {
  ...submitTaskBriefTool,
  name: "revise_active_task",
  description: "教师明确要求停止当前方向并采用新的交付范围时，提交替换后的完整任务语义。讨论可能性、补充细节或边界模糊时不要调用。",
} as const;

const submitConversationControlTool = {
  type: "function" as const,
  name: "submit_conversation_control",
  description: "教师明确要求暂停或取消当前活动任务时提交控制决定。不得用于业务范围判断或例行确认。",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["action", "understandingSummary"],
    properties: {
      action: { type: "string", enum: ["pause", "cancel"] },
      understandingSummary: { type: "string", description: "对教师控制意图的简短理解，仅用于内部审计。" },
    },
  },
} as const;

export function resolveMainAgentToolControlPlane(
  env: OpenAICompatibleEnv = process.env,
): "native" | "outer" {
  if (env.NODE_ENV !== "production" && env.SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT === "1") {
    return "outer";
  }
  if (env.NODE_ENV === "test" && env.SHANHAI_MAIN_AGENT_FORCE_MODEL !== "1") {
    return "outer";
  }
  return "native";
}

export function resolveMainAgentTimeoutMs(env: OpenAICompatibleEnv = process.env) {
  const configured = Number.parseInt(env.MAIN_AGENT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= minimumMainAgentTimeoutMs ? configured : defaultMainAgentTimeoutMs;
}

class ModelUnavailableMainConversationAgent implements MainConversationAgent {
  async intakeTask(_input: MainAgentTaskIntakeInput): Promise<MainAgentTaskIntakeDecision> {
    return { kind: "failed", turn: modelUnavailableTurn() };
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    const pendingPlan = input.conversationContext?.pendingDeliveryPlan;
    if (pendingPlan && isModelFallbackConfirmation(input.userMessage)) {
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
        runtimeKind: "openai",
      };
    }

    return modelUnavailableTurn();
  }
}

function modelUnavailableTurn(): MainAgentTurn {
  const summary = "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。请稍后重试，或联系管理员检查配置。";
  return {
    assistantMessage: { body: summary },
    state: "failed_retryable",
    quickReplies: [],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai",
    failure: {
      phase: "direct_response",
      reasonCode: "main_agent_provider_unavailable",
      category: "provider_unavailable",
      retryability: "after_provider_health_change",
      summary,
    },
  };
}

function isModelFallbackConfirmation(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "").toLowerCase();
  if (["开始", "确认", "确认开始", "可以", "好的", "好", "ok", "继续", "下一步", "继续下一步", "没问题"].includes(normalized)) return true;
  return /确认开始|按这个计划推进|开始生成|可以生成|继续下一步|继续推进|继续生成/.test(normalized);
}

function unavailableTurnFromPlan(input: { toolPlan: CapabilityToolPlan; status: string; reasonForUser: string; runtimeKind: MainAgentTurn["runtimeKind"] }): MainAgentTurn {
  const blockedPlan: CapabilityToolPlan = {
    ...input.toolPlan,
    reasonForUser: input.reasonForUser,
    internalReason: `${input.toolPlan.internalReason};capability_unavailable:${input.status}`,
    requiresConfirmation: false,
  };

  return {
    assistantMessage: { body: input.reasonForUser },
    state: input.status === "provider_unavailable" || input.status === "blocked" ? "failed_blocked" : "collecting_inputs",
    quickReplies: [],
    recommendedOptions: [],
    toolPlan: blockedPlan,
    shouldRunToolNow: false,
    runtimeKind: input.runtimeKind,
  };
}

function buildMainAgentRequest(input: MainConversationAgentInput, reasoningEffort: OpenAIReasoningEffort = "medium") {
  const outerCapabilityIds = outerToolPlanCapabilityIds(input);
  const nativeToolControlPlane = nativeToolControlPlaneOwnsTurn(input);
  const requestContext = projectMainAgentRequestContext(input.conversationContext);
  return {
    reasoning: { effort: reasoningEffort },
    instructions: [
      "你是山海课伴的主控备课 Agent。",
      "你在教师端的名字是“小酷”；需要自称时使用这个名字，不要自称为模型、系统或 AI。",
      input.responseStyle === "concise" ? "本轮偏好为简洁直接：先给结论，除非教师追问，否则不展开背景说明。" : "本轮偏好为务实展开：给出可执行建议，并只解释影响决策的关键取舍。",
      "产品的默认角色语境偏向小学公开课备课，示例和表达可以优先贴近小学教师。",
      "小学定位不是年级、学科或学段的能力门禁。对合理的初中、高中、大学及其他教育任务照常理解、回答并调用当前合格的高层业务 Tool。",
      "不得因年级、学科、课题或教育阶段拒绝任务、改写教师要求、隐藏 Tool 或要求教师改成小学内容。",
      "不要用关键词门禁拦截用户。任何用户输入都先由你自然理解。",
      "你可以自由聊天、追问、整理需求、制定计划，或选择最合适的工具。",
      "只有当你认为需要产生或推进备课产物时，才返回 toolPlan；否则不要返回 toolPlan。",
      "如果信息不足，不要机械拒绝；自然说明你已经理解的信息，并追问下一步最有价值的问题。",
      "如果用户只给年级、学科、片段想法或问候，也要自然回应，不要复述系统门禁。",
      "用户只输入问候或极短社交语时，按轻量问候处理：回复限制为一到两句，先自然回应，再只追问年级、学科或课题中的一个最容易回答的信息。此时不得返回 toolPlan、deliveryPlan 或 shouldRunToolNow=true，也不要列出教案、PPT、图片、视频或材料包流程。",
      "你会收到最近对话和可能存在的 pendingDeliveryPlan。短回复如“开始”“好”“可以”“继续”要结合上下文理解。",
      "如果收到 contextPackage，它是本轮上下文边界；产物能否用于下游，以 agentWorldState.trustedInputs 和 capabilityAvailability 为准，不要仅凭 needs_review 要求教师确认。",
      "如果收到 semanticSnapshot，它是跨轮任务语义真源；目标、约束、排除项、IntentEpoch、计划 revision、未决决定和可信引用必须以该快照为准，不得被最近消息窗口覆盖。",
      "如果 contextPackage.summaryValidation.status=failed，不要使用 sessionSummary 作事实依据，只使用最近消息、节点状态和 artifact 状态。",
      "如果收到 agentWorldState，它是当前项目事实状态；trustedInputs 包含教师已批准产物和内部验证审查通过且下游可用的产物，可以继续内部工作；draftArtifacts 不能作为可信下游输入。教师签收是独立状态。",
      "如果收到 capabilityAvailability，不要把 provider_unavailable 或 needs_approved_inputs 的能力当成可立即执行；对教师只说自然语言，不输出 status、capabilityId、provider、runtimeKind 等工程词。",
      "你可以调用提供的只读专业Agent Tool获取规划或审查意见。Agent Tool不会创建文件或批准业务操作；收到结果后必须继续判断，不要照抄工具结论。",
      "需要生成或写入产物时，选择已注册的高层业务 Tool；业务 Tool 会提供其领域规则、输入和质量约束。不得猜测或复述未加载领域的流程。",
      "服务端会依据任务授权、预算和副作用决定是否需要 HumanGate。标准范围内的内部工作可以连续推进；遇到无授权、超范围或不可逆动作时，只读取并遵守服务端返回的真实HumanGate。",
      "标准授权不等于禁止语义校准。若当前存在多个合理理解，差异会实质改变结果，并且TaskBrief、对话、可信成果和Observation仍无法消除边界，你可以自主调用request_teacher_decision；边界清晰时不要例行询问，也不得按固定节点、needs_review状态、年级或关键词触发询问。",
      "request_teacher_decision只用于理解校准、方向选择或成果审阅，不授予费用、外发、权限或破坏性操作。调用后等待教师自然语言回答，再从同一任务checkpoint继续。",
      "每次 Tool 返回后，先读取 Observation 与当前世界状态，再选择继续、局部返修、上游返修、请求教师、暂停或完成。不要重复相同的阻塞调用。",
      "Tool 失败后，如果 Observation 没有表明缺少真实用户选择、授权、预算或存在外发/破坏性副作用，不得要求教师回复“继续”来恢复内部工作；应自主修正输入、选择其他当前合格 Tool 或 Replan。重试预算耗尽时诚实暂停并保留恢复入口，不得循环调用或生成 fallback 成果。",
      "如果 replanDirective.reason=completion_contract_unsatisfied，说明 TaskBrief 仍有未满足交付；不要声称任务完成。应自主选择一个当前 available 的高层业务 Tool，或在确有缺失输入/真实决策门时明确等待。",
      nativeToolControlPlane
        ? "本轮由原生 function-call 循环独占 Tool 选择、下一步、重试和停止权。需要推进时直接调用合格 Tool；不再需要 Tool 时，用自然、简洁的中文说明已经完成什么、当前成果或下一步。不得在正文中输出 toolPlan、deliveryPlan 或其他控制 JSON。"
        : "如果用户是在确认 pendingDeliveryPlan，请返回 shouldRunToolNow=true，并复用 pendingDeliveryPlan 的 toolPlan 和 deliveryPlan。",
      "不要输出工程词、底层字段名、schema、provider、node_id、storage、debug、local path 或密钥。",
      nativeToolControlPlane
        ? "最终教师回复使用普通 Markdown 文本，不要包裹 JSON，不要复述函数参数。"
        : "返回内容必须严格符合 JSON 结构。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      responseStyle: input.responseStyle ?? "pragmatic",
      taskBrief: input.taskBrief ?? null,
      intentGrant: input.intentGrant ?? null,
      projectContext: input.projectContext ?? {},
      ...requestContext,
      replanDirective: input.replanDirective ?? null,
      availableArtifactKinds: input.availableArtifactKinds,
      availableCapabilities: (nativeToolControlPlane ? [] : getCapabilityDefinitions())
        .filter((capability) => outerCapabilityIds.includes(capability.id))
        .map((capability) => ({
        id: capability.id,
        label: capability.userLabel,
        description: capability.description,
        artifactKind: capability.artifactKind,
        requiresConfirmation: capability.requiresConfirmation,
        upstreamCapabilities: capability.upstreamCapabilities,
        availability: input.conversationContext?.capabilityAvailability?.find((entry) => entry.capabilityId === capability.id)?.status ?? "unknown",
      })),
      outputGuidance: {
        noTool: "聊天、追问或探索时不返回 toolPlan。",
        toolPlan: nativeToolControlPlane ? "本轮必须返回 null；Tool 选择只通过 function call。" : "需要推进产物时返回最合适 capabilityId。完整材料包可返回 deliveryPlan.mode=full。",
        confirmation: "不要自行决定确认门；服务端会根据任务授权和副作用执行 HumanGate。",
        completion: "只有 TaskBrief 的 requestedOutputs 已由可信产物满足，才可返回 succeeded 且不带 toolPlan。",
      },
    }),
    ...(!nativeToolControlPlane ? {
      text: {
        format: {
          type: "json_schema" as const,
          name: "shanhai_main_agent_turn",
          strict: true,
          schema: buildMainAgentOutputSchema(outerCapabilityIds),
        },
      },
    } : {}),
    promptCacheKey: nativeToolControlPlane ? "shanhai-main-agent:native-v2" : "shanhai-main-agent:outer-v1",
  };
}

function outerToolPlanCapabilityIds(input: MainConversationAgentInput): CapabilityId[] {
  const availability = input.conversationContext?.capabilityAvailability ?? [];
  const candidates = availability.length > 0
    ? availability.filter((entry) => entry.status === "available").map((entry) => entry.capabilityId)
    : getCapabilityDefinitions().map((capability) => capability.id);
  const completedArtifactKinds = input.replanDirective
    ? new Set(input.availableArtifactKinds)
    : new Set<string>();
  return candidates.filter((capabilityId) => {
    if (repeatableOuterCapabilityIds.has(capabilityId)) return true;
    return !completedArtifactKinds.has(getCapabilityDefinition(capabilityId).artifactKind);
  });
}

function buildMainAgentOutputSchema(availableCapabilityIds: CapabilityId[]) {
  return {
    ...mainAgentOutputSchema,
    properties: {
      ...mainAgentOutputSchema.properties,
      toolPlan: {
        ...mainAgentOutputSchema.properties.toolPlan,
        properties: {
          ...mainAgentOutputSchema.properties.toolPlan.properties,
          capabilityId: { type: "string", enum: availableCapabilityIds },
        },
      },
    },
  };
}

function buildCompletionContractRepairRequest(
  input: MainConversationAgentInput,
  availableCapabilityIds: CapabilityId[],
  reasoningEffort: OpenAIReasoningEffort,
  onStreamEvent?: ReturnType<typeof createStructuredMainAgentStreamProjection>,
) {
  const base = buildMainAgentRequest(input, reasoningEffort);
  const schema = {
    ...mainAgentOutputSchema,
    properties: {
      ...mainAgentOutputSchema.properties,
      state: {
        type: "string",
        enum: ["planning_tools", "running_tool", "continuing_workflow"],
      },
      shouldRunToolNow: { type: "boolean", const: true },
      toolPlan: {
        ...mainAgentOutputSchema.properties.toolPlan,
        type: "object",
        properties: {
          ...mainAgentOutputSchema.properties.toolPlan.properties,
          capabilityId: { type: "string", enum: availableCapabilityIds },
        },
      },
    },
  };
  return {
    ...base,
    ...(onStreamEvent ? { onStreamEvent } : {}),
    instructions: `${base.instructions}\n这是完成合同修复请求。TaskBrief 仍有未满足交付，你必须从当前 available 的高层业务 Tool 中自主选择一个最合适的下一步。不得返回无 Tool 的聊天、确认偏好或完成声明；HumanGate 由服务端判断。`,
    text: {
      format: {
        type: "json_schema" as const,
        name: "shanhai_main_agent_completion_repair",
        strict: true,
        schema,
      },
    },
  };
}

function buildToolFailureRepairRequest(
  input: MainConversationAgentInput,
  availableCapabilityIds: CapabilityId[],
  reasoningEffort: OpenAIReasoningEffort,
  onStreamEvent?: ReturnType<typeof createStructuredMainAgentStreamProjection>,
) {
  const base = buildMainAgentRequest(input, reasoningEffort);
  const schema = buildRequiredToolSchema(availableCapabilityIds);
  return {
    ...base,
    ...(onStreamEvent ? { onStreamEvent } : {}),
    instructions: `${base.instructions}\n这是内部失败修复请求。最近 Tool 的校验失败要求 fix_inputs，且项目、TaskBrief 或可信上游已经提供可靠默认。你必须自行修正输入并从当前 available 的高层业务 Tool 中选择下一步；不得再次询问教师已知或可推断的年级、学科、课题、页数、教材版本、页码或例题照片。不得降低质量门，HumanGate 仍由服务端判断。`,
    text: {
      format: {
        type: "json_schema" as const,
        name: "shanhai_main_agent_tool_failure_repair",
        strict: true,
        schema,
      },
    },
  };
}

function buildRequiredToolSchema(availableCapabilityIds: CapabilityId[]) {
  return {
    ...mainAgentOutputSchema,
    properties: {
      ...mainAgentOutputSchema.properties,
      state: {
        type: "string",
        enum: ["planning_tools", "running_tool", "continuing_workflow"],
      },
      shouldRunToolNow: { type: "boolean", const: true },
      toolPlan: {
        ...mainAgentOutputSchema.properties.toolPlan,
        type: "object",
        properties: {
          ...mainAgentOutputSchema.properties.toolPlan.properties,
          capabilityId: { type: "string", enum: availableCapabilityIds },
        },
      },
    },
  };
}

async function runMainAgentToolLoop(
  adapter: ReturnType<typeof createOpenAIResponsesGptAdapter>,
  request: ReturnType<typeof buildMainAgentRequest>,
  options: NonNullable<MainConversationAgentInput["agentToolLoop"]>,
  onProgress: MainConversationAgentInput["onProgress"],
) {
  const result = await runMainAgentControlledReActLoop({
    adapter,
    request,
    tools: options.tools,
    allowedToolNames: options.allowedToolNames,
    prepareTools: options.prepareTools,
    refreshTools: options.refreshTools,
    describeToolCall: options.describeToolCall,
    dispatch: options.dispatch,
    validateCompletion: options.validateCompletion,
    maxToolRounds: options.maxToolRounds,
    maxToolRoundsPerSegment: options.maxToolRoundsPerSegment,
    resumeCheckpoint: options.resumeCheckpoint,
    checkpointSeed: options.checkpointSeed,
    getCheckpointSeed: options.getCheckpointSeed,
    onContextTelemetry: options.onContextTelemetry,
    onRejectedToolCall: options.onRejectedToolCall,
    onBudgetExhausted: options.onBudgetExhausted,
    onSegmentCheckpoint: options.onSegmentCheckpoint,
    onRecoveryCheckpoint: options.onRecoveryCheckpoint,
    onProgress,
  });
  if (result.status !== "completed") throw new MainAgentExecutionError("agent_tool_loop", result.reason, result.diagnosticMessage);
  if (!result.assistantText.trim()) throw new MainAgentExecutionError("agent_tool_loop", "empty_output");
  return result.assistantText;
}

class MainAgentExecutionError extends Error {
  constructor(
    readonly phase: MainAgentFailurePhase,
    readonly reason: string,
    diagnostic?: string,
  ) {
    super(diagnostic || reason);
    this.name = "MainAgentExecutionError";
  }
}

function isRecoverableAgentToolLoopPause(error: unknown): error is MainAgentExecutionError {
  return error instanceof MainAgentExecutionError &&
    error.phase === "agent_tool_loop" &&
    (
      error.reason === "tool_round_limit_reached" ||
      error.reason === "completion_contract_unsatisfied" ||
      error.reason === "dialogue_checkpoint_required" ||
      error.reason === "human_gate_required" ||
      error.reason === "repeated_tool_call" ||
      error.reason === "repeated_tool_failure"
    );
}

function recoverableAgentToolLoopPauseTurn(reason: string): MainAgentTurn {
  const humanGate = reason === "human_gate_required";
  const dialogueCheckpoint = reason === "dialogue_checkpoint_required";
  const repeated = reason === "repeated_tool_call" || reason === "repeated_tool_failure";
  const body = dialogueCheckpoint
    ? "我需要你判断一个会影响结果的理解边界。当前理解、影响和可选方向已经列在下方，你也可以直接说你的想法。"
    : humanGate
    ? "这一步需要教师完成授权、预算或风险确认，当前进度已保存，等待决定后再继续。"
    : reason === "completion_contract_unsatisfied"
      ? "当前任务还没有完整完成，当前进度已保存，可以从现有成果继续。"
      : repeated
        ? "相同修复路径连续没有通过，当前进度已保存，具体失败位置也已记录，需要从恢复入口调整后继续。"
        : mainAgentRoundBudgetPauseSummary();
  return {
    assistantMessage: {
      body,
    },
    state: dialogueCheckpoint ? "needs_input" : "failed_blocked",
    quickReplies: humanGate || dialogueCheckpoint ? [] : [{ label: "继续处理", prompt: "继续当前任务", recommended: true }],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai",
    ...(repeated ? {
      failure: {
        phase: "agent_tool_loop" as const,
        reasonCode: "main_agent_retry_budget_exhausted",
        category: "control_plane" as const,
        retryability: "not_retryable" as const,
        summary: body,
      },
    } : {}),
  };
}

function toMainAgentFailureDiagnostic(error: unknown): MainAgentFailureDiagnostic {
  const executionError = error instanceof MainAgentExecutionError ? error : null;
  return {
    phase: executionError?.phase ?? "output_parse",
    reason: executionError?.reason ?? "unexpected_error",
    errorName: error instanceof Error ? error.name : "Error",
    summary: sanitizeFailureSummary(errorMessage(error)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
}

function sanitizeFailureSummary(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(api[_-]?key|credential|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s,;)]+/gi, "[redacted-url]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s,;)]+/g, "[redacted-path]")
    .slice(0, 600);
}

function parseMainAgentOutput(outputText: string | undefined): StructuredMainAgentOutput {
  if (!outputText) throw new MainAgentOutputError("missing_field", "Missing model output");
  let parsed: StructuredMainAgentOutput;
  try {
    parsed = JSON.parse(outputText) as StructuredMainAgentOutput;
  } catch {
    throw new MainAgentOutputError("bad_json", "Invalid JSON output");
  }
  if (!parsed.assistantMessage || typeof parsed.assistantMessage.body !== "string" || !parsed.assistantMessage.body.trim()) {
    throw new MainAgentOutputError("missing_field", "Missing main agent message");
  }
  if (!isMainAgentState(parsed.state)) throw new MainAgentOutputError("validation_failed", "Invalid main agent state");
  if (parsed.toolPlan && !isCapabilityId(parsed.toolPlan.capabilityId)) throw new MainAgentOutputError("validation_failed", "Invalid capability id");
  return parsed;
}

class MainAgentOutputError extends Error {
  constructor(readonly reason: "bad_json" | "missing_field" | "validation_failed", message: string) {
    super(message);
    this.name = "MainAgentOutputError";
  }
}

function classifyMainAgentOutputError(error: unknown) {
  return error instanceof MainAgentOutputError ? error.reason : "validation_failed";
}

function naturalMainAgentTurn(assistantText: string, input: MainConversationAgentInput): MainAgentTurn {
  const body = assistantText.trim();
  if (!body) throw new MainAgentExecutionError("output_parse", "missing_field", "Missing main agent message");
  return {
    assistantMessage: { body },
    state: input.taskBrief ? "succeeded" : "chatting",
    quickReplies: [],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai",
  };
}

function normalizeModelTurn(output: StructuredMainAgentOutput, input: MainConversationAgentInput): MainAgentTurn {
  const nativeToolControlPlane = nativeToolControlPlaneOwnsTurn(input);
  const toolPlan = !nativeToolControlPlane && output.toolPlan ? buildModelToolPlan(output.toolPlan, input.userMessage) : undefined;
  const plannedCapabilityId = toolPlan?.capabilityId;
  const availability = plannedCapabilityId
    ? input.conversationContext?.capabilityAvailability?.find((entry) => entry.capabilityId === plannedCapabilityId)
    : undefined;
  if (toolPlan && availability && availability.status !== "available") {
    return unavailableTurnFromPlan({
      toolPlan,
      status: availability.status,
      reasonForUser: availability.reasonForUser,
      runtimeKind: "openai",
    });
  }
  const deliveryPlan = toolPlan && output.deliveryPlan?.mode === "full" ? buildFullDeliveryPlan(toolPlan.capabilityId, input.availableArtifactKinds) : undefined;

  return {
    assistantMessage: output.assistantMessage,
    state: output.state,
    quickReplies: normalizeQuickReplies(output.quickReplies),
    recommendedOptions: normalizeRecommendedOptions(output.recommendedOptions),
    toolPlan,
    deliveryPlan,
    shouldRunToolNow: nativeToolControlPlane ? false : output.shouldRunToolNow === true,
    runtimeKind: "openai",
  };
}

function nativeToolControlPlaneOwnsTurn(input: MainConversationAgentInput) {
  return input.toolControlPlane === "native" || input.agentToolLoop !== undefined;
}

function buildModelToolPlan(modelPlan: StructuredMainAgentOutput["toolPlan"], teacherRequest: string): CapabilityToolPlan {
  if (!modelPlan) throw new Error("Missing model tool plan");
  const capability = getCapabilityDefinition(modelPlan.capabilityId);
  const nextSuggestedCapabilities = (modelPlan.nextSuggestedCapabilities ?? []).filter(isCapabilityId);

  return {
    planId: `${capability.id}:${stablePlanSegment(teacherRequest)}`,
    capabilityId: capability.id,
    reasonForUser: stringOrDefault(modelPlan.reasonForUser, `我可以先为你${capability.userLabel}。`),
    internalReason: "model_selected_capability",
    inputDraft: isRecord(modelPlan.inputDraft) ? modelPlan.inputDraft : { teacherGoal: teacherRequest },
    missingInputs: Array.isArray(modelPlan.missingInputs) ? modelPlan.missingInputs.map(String).filter(Boolean) : [],
    upstreamPlan: [],
    nextSuggestedCapabilities,
    requiresConfirmation: typeof modelPlan.requiresConfirmation === "boolean" ? modelPlan.requiresConfirmation : capability.requiresConfirmation,
    expectedArtifactKind: capability.artifactKind,
  };
}

function buildFullDeliveryPlan(currentStepId: CapabilityId, availableArtifactKinds: string[]): DeliveryPlan {
  const completedStepIds = completedDeliveryStepIds(availableArtifactKinds);
  return {
    id: `delivery:${currentStepId}`,
    title: "公开课完整交付计划",
    summary: "我会按你的目标推进教案、PPT、课堂素材和最终交付包。",
    currentStepId,
    steps: fullDeliveryStepIds.map((capabilityId) => {
      const capability = getCapabilityDefinition(capabilityId);
      return {
        id: capabilityId,
        capabilityId,
        artifactKind: capability.artifactKind,
        title: capability.userLabel,
        teacherDescription: capability.description,
        status: completedStepIds.has(capabilityId) ? "succeeded" : capabilityId === currentStepId ? "awaiting_confirmation" : "pending",
        requiresConfirmation: capability.requiresConfirmation,
      };
    }),
  };
}

function completedDeliveryStepIds(availableArtifactKinds: string[]): Set<CapabilityId> {
  const remainingArtifactKinds = [...availableArtifactKinds];
  const completedStepIds = new Set<CapabilityId>();

  for (const capabilityId of fullDeliveryStepIds) {
    const artifactKind = getCapabilityDefinition(capabilityId).artifactKind;
    const artifactIndex = remainingArtifactKinds.indexOf(artifactKind);
    if (artifactIndex === -1) continue;
    completedStepIds.add(capabilityId);
    remainingArtifactKinds.splice(artifactIndex, 1);
  }

  return completedStepIds;
}

function normalizeQuickReplies(replies: QuickReply[] | undefined): QuickReply[] {
  if (!Array.isArray(replies)) return [];
  return replies
    .filter((reply) => typeof reply?.label === "string" && typeof reply?.prompt === "string")
    .map((reply) => ({ label: reply.label, prompt: reply.prompt, recommended: reply.recommended === true }));
}

function normalizeRecommendedOptions(options: RecommendedOption[] | undefined): RecommendedOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => typeof option?.label === "string" && typeof option?.value === "string")
    .map((option) => ({ slot: option.slot, label: option.label, value: option.value, recommended: option.recommended === true }));
}

function isMainAgentState(value: unknown): value is MainAgentState {
  return typeof value === "string" && [
    "chatting",
    "exploring",
    "collecting_inputs",
    "awaiting_confirmation",
    "planning_tools",
    "running_tool",
    "needs_input",
    "failed_retryable",
    "failed_blocked",
    "succeeded",
    "continuing_workflow",
  ].includes(value);
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && capabilityIdEnum.includes(value as CapabilityId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stablePlanSegment(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "draft";
}

const mainAgentOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "state", "quickReplies", "recommendedOptions", "shouldRunToolNow", "toolPlan", "deliveryPlan"],
  properties: {
    assistantMessage: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: ["string", "null"] },
        body: { type: "string" },
      },
    },
    state: {
      type: "string",
      enum: ["chatting", "exploring", "collecting_inputs", "awaiting_confirmation", "planning_tools", "running_tool", "needs_input", "failed_retryable", "failed_blocked", "succeeded", "continuing_workflow"],
    },
    quickReplies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "prompt", "recommended"],
        properties: {
          label: { type: "string" },
          prompt: { type: "string" },
          recommended: { type: "boolean" },
        },
      },
    },
    recommendedOptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "label", "value", "recommended"],
        properties: {
          slot: { type: ["string", "null"] },
          label: { type: "string" },
          value: { type: "string" },
          recommended: { type: "boolean" },
        },
      },
    },
    shouldRunToolNow: { type: "boolean" },
    toolPlan: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["capabilityId", "reasonForUser", "missingInputs", "nextSuggestedCapabilities", "requiresConfirmation", "inputDraft"],
      properties: {
        capabilityId: { type: "string", enum: capabilityIdEnum },
        reasonForUser: { type: "string" },
        missingInputs: { type: "array", items: { type: "string" } },
        nextSuggestedCapabilities: { type: "array", items: { type: "string", enum: capabilityIdEnum } },
        requiresConfirmation: { type: "boolean" },
        inputDraft: {
          type: "object",
          additionalProperties: false,
          required: ["teacherGoal", "notes", "classroomRunSpecDraft"],
          properties: {
            teacherGoal: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
            classroomRunSpecDraft: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["schemaVersion", "courseAnchor", "sequence"],
              properties: {
                schemaVersion: { type: "string", const: "classroom-run-spec-draft.v1" },
                courseAnchor: { type: "string" },
                sequence: {
                  type: "array",
                  minItems: 5,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ordinal", "action", "artifactRole", "pptPage", "instruction"],
                    properties: {
                      ordinal: { type: "integer", minimum: 1 },
                      action: { type: "string", enum: ["play_intro_video", "ask_return_question", "open_ppt", "teacher_explain", "reveal_answer"] },
                      artifactRole: { type: ["string", "null"], enum: ["lesson_plan", "pptx", "pdf", "image", "video", null] },
                      pptPage: { type: ["integer", "null"], minimum: 1 },
                      instruction: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    deliveryPlan: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["full", "none"] },
      },
    },
  },
};
