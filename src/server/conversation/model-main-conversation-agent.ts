import OpenAI from "openai";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentState, MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { createDeterministicMainConversationAgent, type MainConversationAgent, type MainConversationAgentInput } from "./main-conversation-agent";
import { runMainAgentControlledReActLoop } from "./main-agent-controlled-react-loop";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import type { OpenAIReasoningEffort } from "@/server/openai-compatible-config";

type OpenAIMainConversationAgentOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
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
const defaultMainAgentTimeoutMs = 60_000;
const minimumMainAgentTimeoutMs = 10_000;

export class OpenAIMainConversationAgent implements MainConversationAgent {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly reasoningEffort: OpenAIReasoningEffort;

  constructor(options: OpenAIMainConversationAgentOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    if (isOutsidePrimarySchoolScope(input.userMessage)) {
      return primaryScopeBoundaryTurn();
    }

    try {
      const strategy = input.generationIntensity ? resolveGenerationIntensityStrategy(input.generationIntensity) : null;
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: strategy?.model ?? this.model });
      const request = buildMainAgentRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort);
      const assistantText = input.agentToolLoop?.tools.length
        ? await runMainAgentToolLoop(adapter, request, input.agentToolLoop)
        : (await adapter.createResponse(request)).assistantText;
      return normalizeModelTurn(parseMainAgentOutput(assistantText), input);
    } catch {
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

  return new OpenAIMainConversationAgent({ client, model: config.model, reasoningEffort: config.reasoningEffort });
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
      "如果收到 contextPackage，它是本轮可信上下文边界；只把 approved artifact 作为下游可信输入，needs_review 或 failed 只能作为待确认/风险状态。",
      "如果 contextPackage.summaryValidation.status=failed，不要使用 sessionSummary 作事实依据，只使用最近消息、节点状态和 artifact 状态。",
      "如果收到 agentWorldState，它是当前项目事实状态；trustedInputs 才能作为下游可信输入，draftArtifacts 只能作为待教师确认内容。",
      "如果收到 capabilityAvailability，不要把 provider_unavailable 或 needs_approved_inputs 的能力当成可立即执行；对教师只说自然语言，不输出 status、capabilityId、provider、runtimeKind 等工程词。",
      "你可以调用提供的只读专业Agent Tool获取规划或审查意见。Agent Tool不会创建文件或批准业务操作；收到结果后必须继续判断，不要照抄工具结论。",
      "需要真实生成或写入产物时，最终仍通过toolPlan提出一个业务能力并等待服务端HumanGate；不得在只读Agent Tool循环中直接调用媒体或打包能力。",
      "如果专业Agent Tool返回返修、阻塞或证据不足，结合finding和最小修复改计划、定点返修或请求教师，不要原样重复调用。",
      "PPT质量主线必须按逐页四层设计、风险样张、样张审查、教师批准、全量资产、可编辑组装、整套审查和页级返修推进；已有合格产物要复用，不得强制从头重跑。",
      "PPT样张候选完成后，先调用delivery_critic_review，domain=ppt且stage=ppt_sample_review，targetLocators必须包含绑定当前样张artifactId的artifact locator；Critic通过只表示审查证据成立，必须停下等待教师明确批准，不能自行调用全量资产。",
      "只有当前样张审查通过且教师批准形成可信样张输入后，才可提出ppt_full_assets或ppt_full_deck业务计划。",
      "完整PPT候选完成后，调用delivery_critic_review，domain=ppt且stage=ppt_full_review；若finding定位到具体pageId，只提出ppt_page_repair并把这些pageId放入inputDraft.pageIds，不得重做未受影响页面。",
      "PPT Critic的失败finding必须带page locator和design、visual、provenance或readability维度；证据不足时停止下游并补审查，不得猜测通过。",
      "如果用户是在确认 pendingDeliveryPlan，请返回 shouldRunToolNow=true，并复用 pendingDeliveryPlan 的 toolPlan 和 deliveryPlan。",
      "不要输出工程词、底层字段名、schema、provider、node_id、storage、debug、local path 或密钥。",
      "返回内容必须严格符合 JSON 结构。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      responseStyle: input.responseStyle ?? "pragmatic",
      projectContext: input.projectContext ?? {},
      contextPackage: input.conversationContext?.contextPackage ?? null,
      agentWorldState: input.conversationContext?.agentWorldState ?? null,
      capabilityAvailability: input.conversationContext?.capabilityAvailability ?? [],
      conversationContext: input.conversationContext ?? {},
      replanDirective: input.replanDirective ?? null,
      availableArtifactKinds: input.availableArtifactKinds,
      availableCapabilities: getCapabilityDefinitions().map((capability) => ({
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
        toolPlan: "需要推进产物时返回最合适 capabilityId。完整材料包可返回 deliveryPlan.mode=full。",
        confirmation: "会写入 artifact 的动作通常应 shouldRunToolNow=false 并等待教师确认。",
      },
    }),
    text: {
      format: {
        type: "json_schema" as const,
        name: "shanhai_main_agent_turn",
        strict: true,
        schema: mainAgentOutputSchema,
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
    dispatch: options.dispatch,
    maxToolRounds: options.maxToolRounds,
  });
  if (result.status !== "completed") throw new Error(`Main Agent ReAct loop stopped: ${result.reason}`);
  return result.assistantText;
}

function parseMainAgentOutput(outputText: string | undefined): StructuredMainAgentOutput {
  if (!outputText) throw new Error("Missing model output");
  const parsed = JSON.parse(outputText) as StructuredMainAgentOutput;
  if (!parsed.assistantMessage || typeof parsed.assistantMessage.body !== "string" || !parsed.assistantMessage.body.trim()) {
    throw new Error("Invalid main agent message");
  }
  if (!isMainAgentState(parsed.state)) throw new Error("Invalid main agent state");
  if (parsed.toolPlan && !isCapabilityId(parsed.toolPlan.capabilityId)) throw new Error("Invalid capability id");
  return parsed;
}

function normalizeModelTurn(output: StructuredMainAgentOutput, input: MainConversationAgentInput): MainAgentTurn {
  if (isOutsidePrimarySchoolScope(input.userMessage) || containsOutOfScopeTeachingContent(output)) {
    return primaryScopeBoundaryTurn();
  }

  const toolPlan = output.toolPlan ? buildModelToolPlan(output.toolPlan, input.userMessage) : undefined;
  const availability = toolPlan
    ? input.conversationContext?.capabilityAvailability?.find((entry) => entry.capabilityId === toolPlan.capabilityId)
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
    shouldRunToolNow: output.shouldRunToolNow === true,
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
          required: ["teacherGoal", "notes"],
          properties: {
            teacherGoal: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
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
