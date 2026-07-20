import OpenAI from "openai";

import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import type { GptProtocolResponse } from "@/server/gpt-protocol/types";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import {
  createOpenAICompatibleConfigDigest,
  pickOpenAICompatibleConfig,
  type AgentBrainChannel,
  type OpenAICompatibleEnv,
  type OpenAIReasoningEffort,
} from "@/server/openai-compatible-config";
import type { MainAgentTurn } from "@/server/capabilities/types";
import {
  type MainAgentTaskIntakeDecision,
  type MainAgentTaskIntakeInput,
  type MainConversationAgent,
  type MainConversationAgentInput,
} from "./main-conversation-agent";
import { runMainAgentControlledReActLoop } from "./main-agent-controlled-react-loop";
import { projectMainAgentRequestContext } from "./main-agent-request-context";
import { mainAgentRoundBudgetPauseSummary } from "./main-agent-run-pause";
import { classifyMainAgentFailure, type MainAgentFailurePhase } from "./main-agent-failure";
import { validateTaskBriefProposal } from "./task-intake";
import { TASK_REQUESTED_OUTPUTS } from "./task-contract";
import { createNaturalLanguageMainAgentStreamProjection } from "./main-agent-stream-projection";

type OpenAIMainConversationAgentOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
  onFailureDiagnostic?: (event: MainAgentFailureDiagnostic) => void;
  runtimeEvidenceDigest?: string;
  providerChannel?: AgentBrainChannel;
};

export type MainAgentFailureDiagnostic = {
  phase: "direct_response" | "agent_tool_loop" | "output_parse";
  reason: string;
  errorName: string;
  summary: string;
  reasonCode?: string;
  retryability?: string;
};

const defaultMainAgentTimeoutMs = 180_000;
const minimumMainAgentTimeoutMs = 10_000;

export class OpenAIMainConversationAgent implements MainConversationAgent {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly reasoningEffort: OpenAIReasoningEffort;
  private readonly onFailureDiagnostic?: (event: MainAgentFailureDiagnostic) => void;
  private readonly runtimeEvidenceDigest?: string;
  private readonly providerChannel?: AgentBrainChannel;

  constructor(options: OpenAIMainConversationAgentOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
    this.onFailureDiagnostic = options.onFailureDiagnostic;
    this.runtimeEvidenceDigest = options.runtimeEvidenceDigest;
    this.providerChannel = options.providerChannel;
  }

  async intakeTask(input: MainAgentTaskIntakeInput): Promise<MainAgentTaskIntakeDecision> {
    try {
      const adapter = createOpenAIResponsesGptAdapter({
        client: this.client,
        model: this.model,
        providerChannel: this.providerChannel,
      });
      const response = await adapter.createResponse({
        ...buildTaskIntakeRequest(input, "low"),
        onStreamEvent: createNaturalLanguageMainAgentStreamProjection(input.onProgress),
      });
      if (response.diagnostics.status === "failed") {
        throw new MainAgentExecutionError("direct_response", "task_intake_transport_failed", response.diagnostics.errorMessage);
      }
      return parseTaskIntakeDecision(response, input.userMessage);
    } catch (error) {
      return {
        kind: "failed",
        turn: this.failedTurn(error, "智能生成服务暂时不可用，暂时不能可靠理解这次需求。请稍后重试，或联系管理员检查配置。"),
      };
    }
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    try {
      const strategy = input.generationIntensity
        ? resolveGenerationIntensityStrategy(input.generationIntensity)
        : null;
      const adapter = createOpenAIResponsesGptAdapter({
        client: this.client,
        model: this.model,
        providerChannel: this.providerChannel,
      });
      const request = {
        ...buildMainAgentRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort),
        onStreamEvent: createNaturalLanguageMainAgentStreamProjection(input.onProgress),
      };
      const assistantText = input.agentToolLoop
        ? await runMainAgentToolLoop(adapter, request, input.agentToolLoop, input.onProgress)
        : await runDirectResponse(adapter, request);
      return naturalMainAgentTurn(assistantText, input);
    } catch (error) {
      if (isRecoverableAgentToolLoopPause(error)) return recoverableAgentToolLoopPauseTurn(error.reason);
      return this.failedTurn(
        error,
        "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。请稍后重试，或联系管理员检查配置。",
        [{ label: "重试", prompt: input.userMessage, recommended: true }],
      );
    }
  }

  private failedTurn(
    error: unknown,
    body: string,
    quickReplies: MainAgentTurn["quickReplies"] = [],
  ): MainAgentTurn {
    const diagnostic = toMainAgentFailureDiagnostic(error);
    const failure = classifyMainAgentFailure({
      phase: diagnostic.phase,
      reason: diagnostic.reason,
      diagnosticSummary: diagnostic.summary,
      evidenceDigest: this.runtimeEvidenceDigest,
    });
    this.onFailureDiagnostic?.({
      ...diagnostic,
      reasonCode: failure.reasonCode,
      retryability: failure.retryability,
    });
    return {
      assistantMessage: { body },
      state: failure.retryability === "not_retryable" ? "failed_blocked" : "failed_retryable",
      quickReplies,
      recommendedOptions: [],
      runtimeKind: "openai",
      failure,
    };
  }
}

export function createMainConversationAgentFromEnv(env: OpenAICompatibleEnv = process.env): MainConversationAgent {
  const config = pickOpenAICompatibleConfig(env);
  if (!config) return new ModelUnavailableMainConversationAgent();

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
    providerChannel: config.channel,
    runtimeEvidenceDigest: createOpenAICompatibleConfigDigest(config),
    onFailureDiagnostic: (event) => console.error("[main-agent-failure]", JSON.stringify(event)),
  });
}

export function resolveMainAgentTimeoutMs(env: OpenAICompatibleEnv = process.env) {
  const configured = Number.parseInt(env.MAIN_AGENT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= minimumMainAgentTimeoutMs
    ? configured
    : defaultMainAgentTimeoutMs;
}

class ModelUnavailableMainConversationAgent implements MainConversationAgent {
  async intakeTask(): Promise<MainAgentTaskIntakeDecision> {
    return { kind: "failed", turn: modelUnavailableTurn() };
  }

  async respond(): Promise<MainAgentTurn> {
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
  if (!taskCall) {
    const body = response.assistantText.trim();
    if (!body) throw new MainAgentExecutionError("output_parse", "task_intake_missing_output");
    return {
      kind: "conversation",
      turn: {
        assistantMessage: { body },
        state: "chatting",
        quickReplies: [],
        recommendedOptions: [],
        runtimeKind: "openai",
      },
    };
  }
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

function buildMainAgentRequest(
  input: MainConversationAgentInput,
  reasoningEffort: OpenAIReasoningEffort = "medium",
) {
  return {
    reasoning: { effort: reasoningEffort },
    instructions: [
      "你是山海课伴的主控备课 Agent，在教师端的名字是“小酷”。",
      input.responseStyle === "concise"
        ? "本轮偏好为简洁直接：先给结论，除非教师追问，否则不展开背景说明。"
        : "本轮偏好为务实展开：给出可执行建议，并只解释影响决策的关键取舍。",
      "产品默认偏向小学公开课备课，但这不是年级、学科或学段的能力门禁。",
      "不要使用关键词门禁、固定宏节点或预设交付顺序替教师作决定；先自然理解本轮消息和完整任务语义。",
      "聊天、探索或信息不足时直接自然回答或追问，不调用业务 Tool。需要推进成果时，只从本轮实际提供的 function Tool 中选择一个最合适的调用。",
      "本轮原生 function-call 循环独占 Tool 选择、下一步、重试和停止权；不得在正文中输出外层计划或其他控制 JSON。",
      "semanticSnapshot 是跨轮任务语义真源；目标、约束、排除项、IntentEpoch、计划 revision、未决决定和可信引用不得被最近消息窗口覆盖。",
      "contextPackage 是本轮上下文边界；可信输入与能力可用性以服务端提供的世界状态和能力事实为准。",
      "标准授权不等于禁止语义校准。只有多个合理理解会实质改变结果且现有事实无法消除边界时，才调用 request_teacher_decision。",
      "Tool 返回后先读取 Observation 与当前世界状态，再选择继续、局部返修、上游返修、请求教师、暂停或完成；不要重复相同的阻塞调用。",
      "内部失败若不涉及真实选择、授权、预算、外发或破坏性副作用，应自主修正或改用当前合格 Tool，不得要求教师回复‘继续’来恢复。",
      "若完成合同仍有未满足交付，不得声称任务完成；从当前 Tool 中继续推进，或在存在真实决策门时明确等待。",
      "不再需要 Tool 时，用自然、简洁的中文说明已经完成什么、当前成果或下一步。最终回复使用普通 Markdown，不要包裹 JSON或复述函数参数。",
      "不要输出 schema、provider、node_id、storage、debug、local path、密钥或其他工程词。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      responseStyle: input.responseStyle ?? "pragmatic",
      taskBrief: input.taskBrief ?? null,
      intentGrant: input.intentGrant ?? null,
      projectContext: input.projectContext ?? {},
      ...projectMainAgentRequestContext(input.conversationContext),
      replanDirective: input.replanDirective ?? null,
      availableArtifactKinds: input.availableArtifactKinds,
    }),
    promptCacheKey: "shanhai-main-agent:native-v3",
  };
}

async function runDirectResponse(
  adapter: ReturnType<typeof createOpenAIResponsesGptAdapter>,
  request: ReturnType<typeof buildMainAgentRequest>,
) {
  const response = await adapter.createResponse(request);
  if (response.diagnostics.status === "failed") {
    throw new MainAgentExecutionError("direct_response", "adapter_failed", response.diagnostics.errorMessage);
  }
  if (!response.assistantText.trim()) throw new MainAgentExecutionError("direct_response", "empty_output");
  return response.assistantText;
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
  if (result.status !== "completed") {
    throw new MainAgentExecutionError("agent_tool_loop", result.reason, result.diagnosticMessage);
  }
  if (!result.assistantText.trim()) throw new MainAgentExecutionError("agent_tool_loop", "empty_output");
  return result.assistantText;
}

function naturalMainAgentTurn(assistantText: string, input: MainConversationAgentInput): MainAgentTurn {
  const body = assistantText.trim();
  if (!body) throw new MainAgentExecutionError("output_parse", "missing_field", "Missing main agent message");
  return {
    assistantMessage: { body },
    state: input.taskBrief && input.agentToolLoop ? "succeeded" : "chatting",
    quickReplies: [],
    recommendedOptions: [],
    runtimeKind: "openai",
  };
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
    [
      "tool_round_limit_reached",
      "completion_contract_unsatisfied",
      "dialogue_checkpoint_required",
      "human_gate_required",
      "repeated_tool_call",
      "repeated_tool_failure",
    ].includes(error.reason);
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
    assistantMessage: { body },
    state: dialogueCheckpoint ? "needs_input" : "failed_blocked",
    quickReplies: humanGate || dialogueCheckpoint
      ? []
      : [{ label: "继续处理", prompt: "继续当前任务", recommended: true }],
    recommendedOptions: [],
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
