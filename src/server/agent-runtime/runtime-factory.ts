import OpenAI from "openai";
import { OpenAIRuntime, type OpenAIResponsesClient } from "./openai-runtime";
import type { AgentRuntime, AgentRuntimeInput, AgentRuntimeResult } from "./types";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";

type RuntimeFactoryEnv = OpenAICompatibleEnv & {
  AGENT_RUNTIME_TIMEOUT_MS?: string;
};

const defaultAgentRuntimeTimeoutMs = 180_000;
const minimumAgentRuntimeTimeoutMs = 10_000;

export function createAgentRuntimeFromEnv(env: RuntimeFactoryEnv = process.env): AgentRuntime {
  const config = pickOpenAICompatibleConfig(env);
  if (!config) {
    return new UnavailableAgentRuntime();
  }

  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: resolveAgentRuntimeTimeoutMs(env),
    maxRetries: 0,
  }) as OpenAIResponsesClient;

  return new OpenAIRuntime({
    client,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  });
}

export function resolveAgentRuntimeTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const configured = Number.parseInt(env.AGENT_RUNTIME_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= minimumAgentRuntimeTimeoutMs
    ? configured
    : defaultAgentRuntimeTimeoutMs;
}

class UnavailableAgentRuntime implements AgentRuntime {
  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    return {
      status: "failed",
      run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "failed" },
      failure: { category: "provider", retryable: true },
      assistantMessage: { title: "暂时无法生成", body: "智能生成服务暂时不可用，请稍后重试。" },
      nextSuggestedAction: { type: "retry", label: "稍后重试" },
    };
  }
}
