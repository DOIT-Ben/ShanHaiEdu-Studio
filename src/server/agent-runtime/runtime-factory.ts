import OpenAI from "openai";
import { DeterministicRuntime } from "./deterministic-runtime";
import { OpenAIRuntime, type OpenAIResponsesClient } from "./openai-runtime";
import type { AgentRuntime } from "./types";

type RuntimeEnv = Record<string, string | undefined> & {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export function createAgentRuntimeFromEnv(env: RuntimeEnv = process.env): AgentRuntime {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return new DeterministicRuntime();
  }

  const client = new OpenAI({ apiKey }) as OpenAIResponsesClient;

  return new OpenAIRuntime({
    client,
    model: env.OPENAI_MODEL?.trim() || "gpt-5.5",
  });
}
