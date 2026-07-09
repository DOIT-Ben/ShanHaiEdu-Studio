import OpenAI from "openai";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentState, MainAgentTurn, QuickReply, RecommendedOption } from "@/server/capabilities/types";
import { createDeterministicMainConversationAgent, type MainConversationAgent, type MainConversationAgentInput } from "./main-conversation-agent";

type OpenAIMainConversationAgentOptions = {
  client: OpenAIResponsesClient;
  model: string;
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
  "coze_ppt",
  "image_asset",
  "intro_video",
  "final_package",
];
const capabilityIdEnum = getCapabilityDefinitions().map((capability) => capability.id);
const defaultMainAgentTimeoutMs = 60_000;
const minimumMainAgentTimeoutMs = 10_000;

export class OpenAIMainConversationAgent implements MainConversationAgent {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;

  constructor(options: OpenAIMainConversationAgentOptions) {
    this.client = options.client;
    this.model = options.model;
  }

  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
    try {
      const response = await this.client.responses.create(buildMainAgentRequest(input, this.model));
      return normalizeModelTurn(parseMainAgentOutput(response.output_text), input.userMessage, input.availableArtifactKinds);
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

  return new OpenAIMainConversationAgent({ client, model: config.model });
}

export function resolveMainAgentTimeoutMs(env: OpenAICompatibleEnv = process.env) {
  const configured = Number.parseInt(env.MAIN_AGENT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= minimumMainAgentTimeoutMs ? configured : defaultMainAgentTimeoutMs;
}

class ModelUnavailableMainConversationAgent implements MainConversationAgent {
  async respond(input: MainConversationAgentInput): Promise<MainAgentTurn> {
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

function buildMainAgentRequest(input: MainConversationAgentInput, model: string) {
  return {
    model,
    instructions: [
      "你是 ShanHaiEdu 的主控备课 Agent。",
      "不要用关键词门禁拦截用户。任何用户输入都先由你自然理解。",
      "你可以自由聊天、追问、整理需求、制定计划，或选择最合适的工具。",
      "只有当你认为需要产生或推进备课产物时，才返回 toolPlan；否则不要返回 toolPlan。",
      "如果信息不足，不要机械拒绝；自然说明你已经理解的信息，并追问下一步最有价值的问题。",
      "如果用户只给年级、学科、片段想法或问候，也要自然回应，不要复述系统门禁。",
      "你会收到最近对话和可能存在的 pendingDeliveryPlan。短回复如“开始”“好”“可以”“继续”要结合上下文理解。",
      "如果用户是在确认 pendingDeliveryPlan，请返回 shouldRunToolNow=true，并复用 pendingDeliveryPlan 的 toolPlan 和 deliveryPlan。",
      "不要输出工程词、底层字段名、schema、provider、node_id、storage、debug、local path 或密钥。",
      "返回内容必须严格符合 JSON 结构。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      projectContext: input.projectContext ?? {},
      conversationContext: input.conversationContext ?? {},
      availableArtifactKinds: input.availableArtifactKinds,
      availableCapabilities: getCapabilityDefinitions().map((capability) => ({
        id: capability.id,
        label: capability.userLabel,
        description: capability.description,
        artifactKind: capability.artifactKind,
        requiresConfirmation: capability.requiresConfirmation,
        upstreamCapabilities: capability.upstreamCapabilities,
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

function normalizeModelTurn(output: StructuredMainAgentOutput, teacherRequest: string, availableArtifactKinds: string[]): MainAgentTurn {
  const toolPlan = output.toolPlan ? buildModelToolPlan(output.toolPlan, teacherRequest) : undefined;
  const deliveryPlan = toolPlan && output.deliveryPlan?.mode === "full" ? buildFullDeliveryPlan(toolPlan.capabilityId, availableArtifactKinds) : undefined;

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
