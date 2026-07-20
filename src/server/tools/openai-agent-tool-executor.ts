import OpenAI from "openai";

import { createToolObservation } from "@/server/capabilities/tool-observation";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import { adaptPptDirectorOutputToDesignArtifact } from "@/server/ppt-quality/ppt-director-design-adapter";
import { resolveModelGatewayConfig } from "@/server/model-gateway-config";
import {
  runWithProviderCallTracePhase,
  type ProviderCallTraceInput,
  type ProviderCallTraceRecorder,
} from "@/server/provider-ledger/provider-call-trace";
import { prisma } from "@/server/db/client";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";

import type { AgentToolInvocationEnvelope } from "./agent-tool-invocation";
import type { AgentToolDefinition, AgentToolExecutor } from "./agent-tool-types";
import { validateJsonSchemaValue } from "./json-schema-value-validator";
import { sanitizeOpenAiStrictSchema } from "./openai-tool-schema";

const chatCompletionsMaxOutputTokens = 32_768;

type AgentToolContextArtifact = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  markdownExcerpt: string;
  structuredContent: Record<string, unknown>;
  status: string;
  isApproved: boolean;
  version: number;
  digest: string;
};

export type AgentToolContextLoader = (
  envelope: AgentToolInvocationEnvelope,
) => Promise<AgentToolContextArtifact[]>;

export type OpenAIAgentToolExecutorOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  providerChannel?: ProviderCallTraceInput["channel"];
  traceRecorder?: ProviderCallTraceRecorder;
  loadContext?: AgentToolContextLoader;
};

export type OpenAIChatCompletionsClient = {
  chat: {
    completions: {
      create(payload: Record<string, unknown>): Promise<{
        choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }>;
      }>;
    };
  };
};

export type OpenAIChatCompletionsAgentToolExecutorOptions = {
  client: OpenAIChatCompletionsClient;
  model: string;
  loadContext?: AgentToolContextLoader;
};

type AgentToolExecutorEnv = OpenAICompatibleEnv & {
  AGENT_TOOL_MODEL_CHANNEL?: string;
};

type AgentToolExecutorFactoryOptions = {
  loadContext?: AgentToolContextLoader;
};

export function createOpenAIAgentToolExecutor(options: OpenAIAgentToolExecutorOptions): AgentToolExecutor<AgentToolInvocationEnvelope> {
  const loadContext = options.loadContext ?? loadAgentToolContext;
  const reasoningEffort = options.reasoningEffort ?? "high";

  return async (envelope, definition) => {
    try {
      const strategy = resolveGenerationIntensityStrategy(envelope.generationIntensity);
      const adapter = createOpenAIResponsesGptAdapter({
        client: options.client,
        model: options.model,
        providerChannel: options.providerChannel,
        traceRecorder: options.traceRecorder,
      });
      const artifacts = await loadContext(envelope);
      const response = await runWithProviderCallTracePhase("tool", () => adapter.createResponse({
        reasoning: { effort: strategy.reasoningEffort ?? reasoningEffort },
        instructions: instructionsFor(definition, envelope),
        input: JSON.stringify({
          goal: envelope.arguments,
          project: { projectId: envelope.projectId, intentEpoch: envelope.intentEpoch },
          approvedArtifacts: selectApprovedArtifacts(definition, artifacts),
          reviewTarget: artifacts.find((artifact) => artifact.id === envelope.reviewTargetRef?.artifactId) ?? null,
        }),
        text: {
          format: {
            type: "json_schema",
            name: definition.transportName,
            strict: true,
            schema: sanitizeOpenAiStrictSchema(definition.outputSchema),
          },
        },
      }));
      if (response.diagnostics.status !== "succeeded" || !response.assistantText) {
        return failed(
          envelope,
          definition,
          "agent_tool_model_failed",
          true,
          response.diagnostics.errorMessage,
        );
      }
      const structuredOutput = JSON.parse(response.assistantText) as unknown;
      if (!isRecord(structuredOutput)) return failed(envelope, definition, "agent_tool_output_not_object", false);
      return {
        status: "succeeded",
        toolId: definition.id,
        invocationId: envelope.invocationId,
        structuredOutput,
        assistantSummary: summaryFromOutput(structuredOutput, definition),
        artifactCreated: false,
      };
    } catch {
      return failed(envelope, definition, "agent_tool_execution_failed", true);
    }
  };
}

export function createOpenAIChatCompletionsAgentToolExecutor(
  options: OpenAIChatCompletionsAgentToolExecutorOptions,
): AgentToolExecutor<AgentToolInvocationEnvelope> {
  const loadContext = options.loadContext ?? loadAgentToolContext;

  return async (envelope, definition) => {
    try {
      const strategy = resolveGenerationIntensityStrategy(envelope.generationIntensity);
      const artifacts = await loadContext(envelope);
      const messages: Array<Record<string, unknown>> = [
        {
          role: "system",
          content: [
            instructionsFor(definition, envelope),
            `当前生成强度为${strategy.intensity}；完整返回一个JSON对象，不得使用Markdown代码块。`,
            `输出必须逐字段符合以下权威JSON Schema：${JSON.stringify(definition.outputSchema)}`,
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            goal: envelope.arguments,
            project: { projectId: envelope.projectId, intentEpoch: envelope.intentEpoch },
            approvedArtifacts: selectApprovedArtifacts(definition, artifacts),
            reviewTarget: artifacts.find((artifact) => artifact.id === envelope.reviewTargetRef?.artifactId) ?? null,
          }),
        },
      ];
      let response;
      try {
        response = await options.client.chat.completions.create({
          model: options.model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: chatCompletionsMaxOutputTokens,
        });
      } catch {
        return failed(envelope, definition, "agent_tool_model_failed", true);
      }
      let parsed = parseChatStructuredOutput(response);
      if (!parsed.ok) return failed(envelope, definition, parsed.errorCategory, parsed.retryable);

      const firstValidationIssues = validateAgentToolOutput(definition, envelope, parsed.structuredOutput);
      if (firstValidationIssues.length > 0) {
        try {
          response = await options.client.chat.completions.create({
            model: options.model,
            messages: [
              ...messages,
              { role: "assistant", content: parsed.assistantText },
              {
                role: "user",
                content: [
                  "上一次JSON未通过权威合同。只修正以下问题并返回一份完整JSON，不得省略其他字段：",
                  ...firstValidationIssues.map((issue) => `- ${issue}`),
                ].join("\n"),
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: chatCompletionsMaxOutputTokens,
          });
        } catch {
          return failed(envelope, definition, "agent_tool_repair_model_failed", true);
        }
        parsed = parseChatStructuredOutput(response);
        if (!parsed.ok) return failed(envelope, definition, `agent_tool_repair_${parsed.errorCategory}`, parsed.retryable);
      }
      const structuredOutput = parsed.structuredOutput;
      return {
        status: "succeeded",
        toolId: definition.id,
        invocationId: envelope.invocationId,
        structuredOutput,
        assistantSummary: summaryFromOutput(structuredOutput, definition),
        artifactCreated: false,
      };
    } catch {
      return failed(envelope, definition, "agent_tool_execution_failed", true);
    }
  };
}

function parseChatStructuredOutput(response: {
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }>;
}):
  | { ok: true; assistantText: string; structuredOutput: Record<string, unknown> }
  | { ok: false; errorCategory: string; retryable: boolean } {
  const choice = response.choices?.[0];
  if (choice?.finish_reason === "length") {
    return { ok: false, errorCategory: "agent_tool_output_truncated", retryable: true };
  }
  const assistantText = choice?.message?.content;
  if (typeof assistantText !== "string" || !assistantText.trim()) {
    return { ok: false, errorCategory: "agent_tool_model_failed", retryable: true };
  }
  let structuredOutput: unknown;
  try {
    structuredOutput = JSON.parse(assistantText);
  } catch {
    return { ok: false, errorCategory: "agent_tool_output_invalid_json", retryable: false };
  }
  if (!isRecord(structuredOutput)) {
    return { ok: false, errorCategory: "agent_tool_output_not_object", retryable: false };
  }
  return { ok: true, assistantText, structuredOutput };
}

function validateAgentToolOutput(
  definition: AgentToolDefinition,
  envelope: AgentToolInvocationEnvelope,
  structuredOutput: Record<string, unknown>,
): string[] {
  const schemaValidation = validateJsonSchemaValue(structuredOutput, definition.outputSchema);
  if (!schemaValidation.valid) return schemaValidation.issues;
  if (definition.agentProfileId !== "ppt_director" ||
      (structuredOutput.decision !== "plan" && structuredOutput.decision !== "repair")) {
    return [];
  }
  try {
    adaptPptDirectorOutputToDesignArtifact({
      invocationId: envelope.invocationId,
      structuredOutput,
      approvedArtifactRefs: envelope.approvedArtifactRefs.map((ref) => ({
        artifactId: ref.artifactId,
        kind: ref.kind,
        version: ref.version,
        digest: ref.digest,
      })),
    });
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "ppt_director_output_invalid";
    return message.split(",").map((issue) => issue.trim()).filter(Boolean).slice(0, 40);
  }
}

export function createAgentToolExecutorFromEnv(
  env: AgentToolExecutorEnv = process.env,
  options: AgentToolExecutorFactoryOptions = {},
): AgentToolExecutor<AgentToolInvocationEnvelope> | undefined {
  const channel = env.AGENT_TOOL_MODEL_CHANNEL?.trim().toLowerCase();
  if (channel === "deepseek") {
    let gateway: ReturnType<typeof resolveModelGatewayConfig>;
    try { gateway = resolveModelGatewayConfig("text", env); } catch { return undefined; }
    const client = new OpenAI({ apiKey: gateway.apiKey, baseURL: gateway.baseUrl, timeout: 180_000, maxRetries: 0 }) as unknown as OpenAIChatCompletionsClient;
    return createOpenAIChatCompletionsAgentToolExecutor({
      client,
      model: gateway.model,
      loadContext: options.loadContext,
    });
  }
  if (channel && channel !== "responses") return undefined;
  const config = pickOpenAICompatibleConfig(env);
  if (!config) return undefined;
  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: 180_000,
    maxRetries: 0,
  }) as OpenAIResponsesClient;
  return createOpenAIAgentToolExecutor({
    client,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    providerChannel: config.channel,
    loadContext: options.loadContext,
  });
}

async function loadAgentToolContext(envelope: AgentToolInvocationEnvelope): Promise<AgentToolContextArtifact[]> {
  const ids = [...new Set([
    ...envelope.approvedArtifactRefs.map((ref) => ref.artifactId),
    ...(envelope.reviewTargetRef ? [envelope.reviewTargetRef.artifactId] : []),
  ])];
  if (ids.length === 0) return [];
  const artifacts = await prisma.artifact.findMany({
    where: { projectId: envelope.projectId, id: { in: ids } },
  });
  if (artifacts.length !== ids.length) throw new Error("Agent Tool context is incomplete.");
  return artifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownExcerpt: excerpt(artifact.markdownContent),
    structuredContent: parseStructuredContent(artifact.structuredContentJson),
    status: artifact.status,
    isApproved: artifact.isApproved,
    version: artifact.version,
    digest: envelope.approvedArtifactRefs.find((ref) => ref.artifactId === artifact.id)?.digest
      ?? (envelope.reviewTargetRef?.artifactId === artifact.id ? envelope.reviewTargetRef.digest : ""),
  }));
}

function instructionsFor(definition: AgentToolDefinition, envelope: AgentToolInvocationEnvelope): string {
  const common = [
    "你是山海课伴产品内部的专业只读Agent Tool。",
    "只依据输入中的可信材料工作，不批准教师操作，不创建文件，不调用外部媒体，不改变Artifact状态。",
    "返回内容必须严格符合指定JSON结构，不输出密钥、路径、接口地址或调试信息。",
  ];
  if (definition.agentProfileId === "ppt_director") {
    common.push("你负责PPT叙事、视觉、逐页设计和页级返修规划；精确信息必须保留可编辑层。返回完整、连续、逐页的Director结果，每页必须包含可执行组合层和无障碍语义，不得用范围页、通用序号句、重复教学动作或占位场景压缩输出。 ");
    common.push("evidence_bindings只声明事实主张、引用位置和approvedArtifacts中存在的source_artifact_kind；不要输出Artifact id、version或digest，这些权威字段由服务端Invocation Envelope绑定。缺教材页码时可引用已批准的教师材料并说明假设，不得编造教材证据。 ");
    common.push("sample_plan必须选择3至4个真实page_id，至少覆盖两种layout_family，并且所选页面中至少一页的risk_level必须为high；required_risk_coverage必须同时包含narrative、layout、math、visual，每个样张页都要有对应rationale。 ");
    common.push("每个ai_scene、ai_assets、editable_text和editable_math条目都必须在同页composition.layers中有且只有一个source_id完全相同的放置层，layer_kind必须分别匹配AI_SCENE、AI_ASSET、EDITABLE_TEXT、EDITABLE_MATH；不得引用未声明source，不得漏放任何已声明source。 ");
    common.push("每一页的primary_visual_brief和ai_scene.brief都必须至少包含20个可见字符，具体写清对象、空间关系、注意焦点和为可编辑层预留的位置，不能用短标签代替。 ");
  } else if (definition.agentProfileId === "video_director") {
    common.push("你先保证视频作为独立创意短片成立，再使用唯一最小课程锚点回接；小学生受众不等于儿童主角、教室或课堂活动。 ");
  } else {
    common.push("你是独立Critic；按量表给出证据、定位、责任阶段和最小修复，不能用自评替代审查。 ");
    if (envelope.arguments.domain === "video" && envelope.arguments.stage === "course_anchor") {
      common.push("课程锚点审查必须逐项输出六个且仅六个hardGateResults：independent_understandability、standalone_viewing_value、not_textbook_or_ppt_retelling、exactly_one_minimal_course_anchor、audience_not_story_world_constraint、no_answer_disclosure。每项必须引用实际证据；失败finding定位当前创意Artifact并返回可执行最小修复。 ");
    }
    if (envelope.arguments.domain === "video" && envelope.arguments.stage === "video_final_review") {
      common.push("成片审查必须读取实际MP4、时间线、采样帧、字幕或转写和音轨证据，并逐项输出十个且仅十个hardGateResults：independent_understandability、standalone_viewing_value、not_textbook_or_ppt_retelling、exactly_one_minimal_course_anchor、audience_not_story_world_constraint、no_answer_disclosure、shot_timeline_continuity、narrative_completeness_and_pacing、caption_transcript_integrity、audio_track_integrity。narrative_completeness_and_pacing必须检查钩子、目标/阻碍、可见变化、信息密度、结尾悬念和节奏是否构成完整可观看短片；仅时长达标不能自动通过。失败finding只能定位当前成片内的shot、frame_range、track或timeline。 ");
    }
  }
  return common.join("\n");
}

function selectApprovedArtifacts(
  definition: AgentToolDefinition,
  artifacts: AgentToolContextArtifact[],
): AgentToolContextArtifact[] {
  const approved = artifacts.filter((artifact) => artifact.isApproved);
  if (definition.agentProfileId !== "ppt_director") return approved;
  const relevantKinds = new Set([
    "requirement_spec",
    "textbook_evidence",
    "lesson_plan",
    "ppt_draft",
    "ppt_design_draft",
  ]);
  return approved.filter((artifact) => relevantKinds.has(artifact.kind));
}

function failed(
  envelope: AgentToolInvocationEnvelope,
  definition: AgentToolDefinition,
  reason: string,
  retryable: boolean,
  diagnostic?: string,
) {
  return {
    status: "failed" as const,
    toolId: definition.id,
    invocationId: envelope.invocationId,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: definition.id,
      kind: "tool_failed",
      teacherSafeSummary: "专业审查这次没有完成，我会保留当前状态并重新判断。",
      internalReasonSanitized: diagnostic ? `${reason}:${diagnostic}` : reason,
      retryPolicy: { retryable, nextAction: retryable ? "retry_later" : "fix_inputs" },
    }),
    errorCategory: reason,
    artifactCreated: false as const,
  };
}

function summaryFromOutput(output: Record<string, unknown>, definition: AgentToolDefinition) {
  const summary = output.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : `${definition.label}已完成。`;
}

function parseStructuredContent(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function excerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 8_000 ? `${normalized.slice(0, 8_000)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
