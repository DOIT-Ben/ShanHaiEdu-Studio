import OpenAI from "openai";
import { DeterministicRuntime } from "./deterministic-runtime";
import { OpenAIRuntime, type OpenAIResponsesClient } from "./openai-runtime";
import type { AgentRuntime, AgentRuntimeInput, AgentRuntimeResult } from "./types";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";

export function createAgentRuntimeFromEnv(env: OpenAICompatibleEnv = process.env): AgentRuntime {
  const fallback = new DeterministicRuntime();
  const config = pickOpenAICompatibleConfig(env);
  if (!config) {
    return fallback;
  }

  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: 20000,
    maxRetries: 0,
  }) as OpenAIResponsesClient;

  return new FallbackAgentRuntime(
    new OpenAIRuntime({
      client,
      model: config.model,
    }),
    fallback,
  );
}

export class FallbackAgentRuntime implements AgentRuntime {
  private readonly primary: AgentRuntime;
  private readonly fallback: AgentRuntime;

  constructor(primary: AgentRuntime, fallback: AgentRuntime) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const primaryResult = await this.primary.run(input);
    if (primaryResult.status === "succeeded") {
      return primaryResult;
    }

    return this.fallback.run(input);
  }
}
