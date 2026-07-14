import OpenAI from "openai";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentState, MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { createDeterministicMainConversationAgent, type MainConversationAgent, type MainConversationAgentInput } from "./main-conversation-agent";
import { runMainAgentControlledReActLoop } from "./main-agent-controlled-react-loop";
import { projectMainAgentRequestContext } from "./main-agent-request-context";
import { mainAgentRoundBudgetPauseSummary } from "./main-agent-run-pause";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import type { OpenAIReasoningEffort } from "@/server/openai-compatible-config";

type OpenAIMainConversationAgentOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
  onFailureDiagnostic?: (event: MainAgentFailureDiagnostic) => void;
};

export type MainAgentFailureDiagnostic = {
  phase: "direct_response" | "agent_tool_loop" | "output_parse";
  reason: string;
  errorName: string;
  summary: string;
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

  constructor(options: OpenAIMainConversationAgentOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
    this.onFailureDiagnostic = options.onFailureDiagnostic;
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    if (isOutsidePrimarySchoolScope(input.userMessage)) {
      return primaryScopeBoundaryTurn();
    }

    try {
      const strategy = input.generationIntensity ? resolveGenerationIntensityStrategy(input.generationIntensity) : null;
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: strategy?.model ?? this.model });
      const request = buildMainAgentRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort);
      let assistantText: string;
      if (input.agentToolLoop?.tools.length) {
        assistantText = await runMainAgentToolLoop(adapter, request, input.agentToolLoop);
      } else {
        const response = await adapter.createResponse(request);
        if (response.diagnostics.status === "failed") {
          throw new MainAgentExecutionError("direct_response", "adapter_failed", response.diagnostics.errorMessage);
        }
        if (!response.assistantText.trim()) throw new MainAgentExecutionError("direct_response", "empty_output");
        assistantText = response.assistantText;
      }
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
      if (isRecoverableAgentToolLoopPause(error)) return recoverableAgentToolLoopPauseTurn();
      this.onFailureDiagnostic?.(toMainAgentFailureDiagnostic(error));
      return {
        assistantMessage: {
          body: "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。请稍后重试，或联系管理员检查配置。",
        },
        state: "failed_retryable",
        quickReplies: [{ label: "重试", prompt: input.userMessage, recommended: true }],
        recommendedOptions: [],
        shouldRunToolNow: false,
        runtimeKind: "openai",
      };
    }
  }
}

export function createMainConversationAgentFromEnv(env: OpenAICompatibleEnv = process.env): MainConversationAgent {
  if (env.NODE_ENV !== "production" && env.SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT === "1") {
    return createDeterministicMainConversationAgent();
  }
  if (env.NODE_ENV === "test" && env.SHANHAI_MAIN_AGENT_FORCE_MODEL !== "1") {
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
    onFailureDiagnostic: (event) => console.error("[main-agent-failure]", JSON.stringify(event)),
  });
}

export function resolveMainAgentTimeoutMs(env: OpenAICompatibleEnv = process.env) {
  const configured = Number.parseInt(env.MAIN_AGENT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= minimumMainAgentTimeoutMs ? configured : defaultMainAgentTimeoutMs;
}

class ModelUnavailableMainConversationAgent implements MainConversationAgent {
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

    return {
      assistantMessage: {
        body: "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。请稍后重试，或联系管理员检查配置。",
      },
      state: "failed_retryable",
      quickReplies: [{ label: "重试", prompt: input.userMessage, recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      runtimeKind: "openai",
    };
  }
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
  const nativeToolControlPlane = Boolean(input.agentToolLoop?.tools.length);
  const requestContext = projectMainAgentRequestContext(input.conversationContext);
  return {
    reasoning: { effort: reasoningEffort },
    instructions: [
      "你是山海课伴的主控备课 Agent。",
      "你在教师端的名字是“小酷”；需要自称时使用这个名字，不要自称为模型、系统或 AI。",
      input.responseStyle === "concise" ? "本轮偏好为简洁直接：先给结论，除非教师追问，否则不展开背景说明。" : "本轮偏好为务实展开：给出可执行建议，并只解释影响决策的关键取舍。",
      "产品当前只服务小学公开课备课，默认范围是一至六年级；不要生成初中、高中或大学内容。",
      "如果教师没有给年级，追问时示例必须使用小学一至六年级，例如“五年级数学《百分数的认识》，新授课，约10页”。",
      "如果教师明确提出初中、高中或超出小学的内容，说明当前版本先限定在小学，并请教师改成小学年级、课题和材料要求；不要返回 toolPlan。",
      "不要用关键词门禁拦截用户。任何用户输入都先由你自然理解。",
      "你可以自由聊天、追问、整理需求、制定计划，或选择最合适的工具。",
      "只有当你认为需要产生或推进备课产物时，才返回 toolPlan；否则不要返回 toolPlan。",
      "如果信息不足，不要机械拒绝；自然说明你已经理解的信息，并追问下一步最有价值的问题。",
      "如果用户只给年级、学科、片段想法或问候，也要自然回应，不要复述系统门禁。",
      "用户只输入问候或极短社交语时，按轻量问候处理：回复限制为一到两句，先自然回应，再只追问年级、学科或课题中的一个最容易回答的信息。此时不得返回 toolPlan、deliveryPlan 或 shouldRunToolNow=true，也不要列出教案、PPT、图片、视频或材料包流程。",
      "你会收到最近对话和可能存在的 pendingDeliveryPlan。短回复如“开始”“好”“可以”“继续”要结合上下文理解。",
      "如果收到 contextPackage，它是本轮上下文边界；产物能否用于下游，以 agentWorldState.trustedInputs 和 capabilityAvailability 为准，不要仅凭 needs_review 要求教师确认。",
      "如果 contextPackage.summaryValidation.status=failed，不要使用 sessionSummary 作事实依据，只使用最近消息、节点状态和 artifact 状态。",
      "如果收到 agentWorldState，它是当前项目事实状态；trustedInputs 包含教师已批准产物和内部验证审查通过且下游可用的产物，可以继续内部工作；draftArtifacts 不能作为可信下游输入。教师签收是独立状态。",
      "如果收到 capabilityAvailability，不要把 provider_unavailable 或 needs_approved_inputs 的能力当成可立即执行；对教师只说自然语言，不输出 status、capabilityId、provider、runtimeKind 等工程词。",
      "你可以调用提供的只读专业Agent Tool获取规划或审查意见。Agent Tool不会创建文件或批准业务操作；收到结果后必须继续判断，不要照抄工具结论。",
      "需要生成或写入产物时，选择已注册的高层业务 Tool；业务 Tool 会提供其领域规则、输入和质量约束。不得猜测或复述未加载领域的流程。",
      "服务端会依据任务授权、预算和副作用决定是否需要 HumanGate。标准范围内的内部工作可以连续推进；遇到无授权、超范围、不可逆动作或明确检查点时，说明影响并等待唯一的待决决定。",
      "如果intentGrant.standardWorkAuthorized=true且TaskBrief已给出明确目标，标准范围内不得要求教师再次确认需求规格、大纲、设计候选或其他可逆内部节点；应继续读取Observation并自主推进，只有服务端返回真实HumanGate时才等待教师。",
      "每次 Tool 返回后，先读取 Observation 与当前世界状态，再选择继续、局部返修、上游返修、请求教师、暂停或完成。不要重复相同的阻塞调用。",
      "Tool 失败后，如果 Observation 没有表明缺少真实用户选择、授权、预算或存在外发/破坏性副作用，不得要求教师回复“继续”来恢复内部工作；应自主修正输入、选择其他当前合格 Tool 或 Replan。重试预算耗尽时诚实暂停并保留恢复入口，不得循环调用或生成 fallback 成果。",
      "如果 replanDirective.reason=completion_contract_unsatisfied，说明 TaskBrief 仍有未满足交付；不要声称任务完成。应自主选择一个当前 available 的高层业务 Tool，或在确有缺失输入/真实决策门时明确等待。",
      nativeToolControlPlane
        ? "本轮由原生 function-call 循环独占 Tool 选择、下一步、重试和停止权。最终 JSON 不得再返回 toolPlan 或 deliveryPlan，也不得要求兼容层继续执行下一 Tool。"
        : "如果用户是在确认 pendingDeliveryPlan，请返回 shouldRunToolNow=true，并复用 pendingDeliveryPlan 的 toolPlan 和 deliveryPlan。",
      "不要输出工程词、底层字段名、schema、provider、node_id、storage、debug、local path 或密钥。",
      "返回内容必须严格符合 JSON 结构。",
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
    text: {
      format: {
        type: "json_schema" as const,
        name: "shanhai_main_agent_turn",
        strict: true,
        schema: nativeToolControlPlane ? buildNativeControlPlaneOutputSchema() : buildMainAgentOutputSchema(outerCapabilityIds),
      },
    },
  };
}

function buildNativeControlPlaneOutputSchema() {
  return {
    ...mainAgentOutputSchema,
    properties: {
      ...mainAgentOutputSchema.properties,
      shouldRunToolNow: { type: "boolean", const: false },
      toolPlan: { type: "null" },
      deliveryPlan: { type: "null" },
    },
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
) {
  const base = buildMainAgentRequest(input, reasoningEffort);
  const schema = buildRequiredToolSchema(availableCapabilityIds);
  return {
    ...base,
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
) {
  const result = await runMainAgentControlledReActLoop({
    adapter,
    request,
    tools: options.tools,
    allowedToolNames: options.allowedToolNames,
    refreshTools: options.refreshTools,
    dispatch: options.dispatch,
    maxToolRounds: options.maxToolRounds,
    checkpointSeed: options.checkpointSeed,
    getCheckpointSeed: options.getCheckpointSeed,
    onContextTelemetry: options.onContextTelemetry,
    onRejectedToolCall: options.onRejectedToolCall,
    onBudgetExhausted: options.onBudgetExhausted,
  });
  if (result.status !== "completed") throw new MainAgentExecutionError("agent_tool_loop", result.reason, result.diagnosticMessage);
  if (!result.assistantText.trim()) throw new MainAgentExecutionError("agent_tool_loop", "empty_output");
  return result.assistantText;
}

class MainAgentExecutionError extends Error {
  constructor(
    readonly phase: MainAgentFailureDiagnostic["phase"],
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
    error.reason === "tool_round_limit_reached";
}

function recoverableAgentToolLoopPauseTurn(): MainAgentTurn {
  return {
    assistantMessage: {
      body: mainAgentRoundBudgetPauseSummary(),
    },
    state: "failed_blocked",
    quickReplies: [{ label: "继续处理", prompt: "继续当前任务", recommended: true }],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai",
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

function normalizeModelTurn(output: StructuredMainAgentOutput, input: MainConversationAgentInput): MainAgentTurn {
  if (isOutsidePrimarySchoolScope(input.userMessage) || containsOutOfScopeTeachingContent(output)) {
    return primaryScopeBoundaryTurn();
  }

  const nativeToolControlPlane = Boolean(input.agentToolLoop?.tools.length);
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

function containsOutOfScopeTeachingContent(output: StructuredMainAgentOutput): boolean {
  const visibleParts = [
    output.assistantMessage?.title,
    output.assistantMessage?.body,
    ...(output.quickReplies ?? []).flatMap((reply) => [reply.label, reply.prompt]),
    ...(output.recommendedOptions ?? []).flatMap((option) => [option.label, option.value]),
    output.toolPlan?.reasonForUser,
  ];

  return visibleParts.some((part) => typeof part === "string" && isOutsidePrimarySchoolScope(part));
}

function isOutsidePrimarySchoolScope(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (!normalized) return false;

  return /七年级|八年级|九年级|7年级|8年级|9年级|初一|初二|初三|初中|高中|高一|高二|高三|中考|高考|有理数|一次函数|二次函数|一元一次方程|一元二次方程|三角函数/.test(normalized);
}

function primaryScopeBoundaryTurn(): MainAgentTurn {
  return {
    assistantMessage: {
      title: "先限定在小学范围",
      body: "当前版本先限定在小学公开课备课。我可以继续帮你做小学一至六年级的课件、教案和课堂素材。你可以这样补充：五年级数学《百分数的认识》，新授课，约10页，简洁课堂风。",
    },
    state: "collecting_inputs",
    quickReplies: [
      { label: "五年级百分数", prompt: "五年级数学《百分数的认识》，新授课，约10页，简洁课堂风。", recommended: true },
      { label: "三年级周长", prompt: "三年级数学《认识周长》，新授课，约10页，活动课堂风。" },
      { label: "六年级比例", prompt: "六年级数学《比例的意义》，复习课，约10页，简洁课堂风。" },
    ],
    recommendedOptions: [
      { slot: "grade", label: "一至六年级", value: "小学一至六年级", recommended: true },
      { slot: "subject", label: "数学", value: "数学", recommended: true },
      { slot: "output", label: "教案 + PPT", value: "教案和 PPT" },
    ],
    shouldRunToolNow: false,
    runtimeKind: "openai",
  };
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
