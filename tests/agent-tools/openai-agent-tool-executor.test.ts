import { describe, expect, it } from "vitest";

import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { getAgentToolDefinition } from "@/server/tools/agent-tool-registry";
import { createAgentToolExecutorFromEnv, createOpenAIAgentToolExecutor } from "@/server/tools/openai-agent-tool-executor";

describe("V1-3 OpenAI Agent Tool Executor", () => {
  it("uses the Agent Tool output schema and returns a model-generated read-only result", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = {
      responses: {
        async create(input: Record<string, unknown>) {
          payload = input;
          return { output_text: JSON.stringify(validPptDirectorOutput()) };
        },
      },
    } as OpenAIResponsesClient;
    const executor = createOpenAIAgentToolExecutor({
      client,
      model: "test-model",
      loadContext: async () => [],
    });
    const envelope = directorEnvelope();
    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "ppt_director.plan_or_repair",
      artifactCreated: false,
    });
    expect(payload?.text).toMatchObject({
      format: { type: "json_schema", name: "ppt_director_plan_or_repair", strict: true },
    });
    expect(JSON.stringify(payload)).not.toContain("deterministic_draft");
  });

  it("fails closed when the model request fails", async () => {
    const client = {
      responses: { async create() { throw new Error("request failed"); } },
    } as OpenAIResponsesClient;
    const executor = createOpenAIAgentToolExecutor({
      client,
      model: "test-model",
      loadContext: async () => [],
    });
    const envelope = directorEnvelope();
    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({
      status: "failed",
      artifactCreated: false,
      observation: { kind: "tool_failed" },
    });
    expect(result).not.toHaveProperty("structuredOutput");
  });

  it("uses the queued intensity snapshot for the professional Agent Tool", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = { responses: { async create(input: Record<string, unknown>) {
      payload = input;
      return { output_text: JSON.stringify(validPptDirectorOutput()) };
    } } } as OpenAIResponsesClient;
    const executor = createOpenAIAgentToolExecutor({ client, model: "fallback", loadContext: async () => [] });
    const envelope = createAgentToolInvocationEnvelope({ ...directorEnvelopeInput(), generationIntensity: "deep" });

    await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(payload).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "xhigh" } });
  });

  it("does not create a production executor without a configured model channel", () => {
    expect(createAgentToolExecutorFromEnv({})).toBeUndefined();
  });
});

function directorEnvelope() {
  return createAgentToolInvocationEnvelope(directorEnvelopeInput());
}

function directorEnvelopeInput() {
  return {
    invocationId: "invocation-executor-1",
    toolId: "ppt_director.plan_or_repair",
    identity: { actorUserId: "teacher-1", actorAuthMode: "password" as const, authSessionId: "session-1" },
    projectId: "project-1",
    intentEpoch: 1,
    sourceMessageId: "message-1",
    reviewTargetRef: null,
    approvedArtifactRefs: [],
    arguments: { goal: "规划课件", stage: "page_design", targetPageIds: [], focus: null },
  };
}

function validPptDirectorOutput() {
  return {
    decision: "plan",
    summary: "形成逐页设计后再选样张。",
    targetLocators: [],
    nextToolIntents: ["assemble_ppt_key_samples"],
    assumptions: [],
    stopConditions: ["sample_review"],
  };
}
