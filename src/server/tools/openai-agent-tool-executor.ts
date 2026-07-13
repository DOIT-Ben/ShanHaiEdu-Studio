import OpenAI from "openai";

import { createToolObservation } from "@/server/capabilities/tool-observation";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";
import { prisma } from "@/server/db/client";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";

import type { AgentToolInvocationEnvelope } from "./agent-tool-invocation";
import type { AgentToolDefinition, AgentToolExecutor } from "./agent-tool-types";

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
};

export type AgentToolContextLoader = (
  envelope: AgentToolInvocationEnvelope,
) => Promise<AgentToolContextArtifact[]>;

export type OpenAIAgentToolExecutorOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  loadContext?: AgentToolContextLoader;
};

export function createOpenAIAgentToolExecutor(options: OpenAIAgentToolExecutorOptions): AgentToolExecutor<AgentToolInvocationEnvelope> {
  const adapter = createOpenAIResponsesGptAdapter({ client: options.client, model: options.model });
  const loadContext = options.loadContext ?? loadAgentToolContext;
  const reasoningEffort = options.reasoningEffort ?? "high";

  return async (envelope, definition) => {
    try {
      const artifacts = await loadContext(envelope);
      const response = await adapter.createResponse({
        reasoning: { effort: reasoningEffort },
        instructions: instructionsFor(definition),
        input: JSON.stringify({
          goal: envelope.arguments,
          project: { projectId: envelope.projectId, intentEpoch: envelope.intentEpoch },
          approvedArtifacts: artifacts.filter((artifact) => artifact.isApproved),
          reviewTarget: artifacts.find((artifact) => artifact.id === envelope.reviewTargetRef?.artifactId) ?? null,
        }),
        text: {
          format: {
            type: "json_schema",
            name: definition.transportName,
            strict: true,
            schema: definition.outputSchema,
          },
        },
      });
      if (response.diagnostics.status !== "succeeded" || !response.assistantText) {
        return failed(envelope, definition, "agent_tool_model_failed", true);
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

export function createAgentToolExecutorFromEnv(
  env: OpenAICompatibleEnv = process.env,
): AgentToolExecutor<AgentToolInvocationEnvelope> | undefined {
  const config = pickOpenAICompatibleConfig(env);
  if (!config) return undefined;
  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: 60_000,
    maxRetries: 0,
  }) as OpenAIResponsesClient;
  return createOpenAIAgentToolExecutor({
    client,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
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
  }));
}

function instructionsFor(definition: AgentToolDefinition): string {
  const common = [
    "你是山海课伴产品内部的专业只读Agent Tool。",
    "只依据输入中的可信材料工作，不批准教师操作，不创建文件，不调用外部媒体，不改变Artifact状态。",
    "返回内容必须严格符合指定JSON结构，不输出密钥、路径、接口地址或调试信息。",
  ];
  if (definition.agentProfileId === "ppt_director") {
    common.push("你负责PPT叙事、视觉、逐页设计和页级返修规划；精确信息必须保留可编辑层。 ");
  } else if (definition.agentProfileId === "video_director") {
    common.push("你先保证视频作为独立创意短片成立，再使用唯一最小课程锚点回接；小学生受众不等于儿童主角、教室或课堂活动。 ");
  } else {
    common.push("你是独立Critic；按量表给出证据、定位、责任阶段和最小修复，不能用自评替代审查。 ");
  }
  return common.join("\n");
}

function failed(
  envelope: AgentToolInvocationEnvelope,
  definition: AgentToolDefinition,
  reason: string,
  retryable: boolean,
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
      internalReasonSanitized: reason,
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
