import { describe, expect, it } from "vitest";

import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { getAgentToolDefinition } from "@/server/tools/agent-tool-registry";
import {
  createAgentToolExecutorFromEnv,
  createOpenAIAgentToolExecutor,
  createOpenAIChatCompletionsAgentToolExecutor,
  type OpenAIChatCompletionsClient,
} from "@/server/tools/openai-agent-tool-executor";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";

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
    expect(JSON.stringify((payload?.text as any).format.schema)).not.toContain("minItems");
    expect(JSON.stringify(getAgentToolDefinition(envelope.toolId).outputSchema)).toContain("minItems");
    expect(JSON.stringify(getAgentToolDefinition(envelope.toolId).outputSchema)).toContain('"contains_embedded_text":{"type":"boolean","const":false}');
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

  it("uses an explicitly selected Chat Completions channel without weakening Router schema validation", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = {
      chat: { completions: { async create(input: Record<string, unknown>) {
        payload = input;
        return { choices: [{ message: { content: JSON.stringify(validPptDirectorOutput()) } }] };
      } } },
    } as OpenAIChatCompletionsClient;
    const executor = createOpenAIChatCompletionsAgentToolExecutor({
      client,
      model: "deepseek-test",
      loadContext: async () => [],
    });
    const envelope = directorEnvelope();

    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({ status: "succeeded", artifactCreated: false });
    expect(payload).toMatchObject({
      model: "deepseek-test",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 32_768,
    });
    expect((payload?.messages as Array<{ content: string }>)[0].content).toContain('"page_specs"');
    expect((payload?.messages as Array<{ content: string }>)[0].content).toContain("所选页面中至少一页的risk_level必须为high");
    expect((payload?.messages as Array<{ content: string }>)[0].content).toContain("有且只有一个source_id完全相同的放置层");
    expect((payload?.messages as Array<{ content: string }>)[0].content).toContain("至少包含20个可见字符");
    expect(JSON.stringify(payload)).not.toContain("deterministic_draft");
  });

  it("requires an explicit complete DeepSeek channel configuration", () => {
    expect(createAgentToolExecutorFromEnv({ AGENT_TOOL_MODEL_CHANNEL: "deepseek" })).toBeUndefined();
    expect(createAgentToolExecutorFromEnv({
      AGENT_TOOL_MODEL_CHANNEL: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://example.invalid/v1",
      DEEPSEEK_MODEL: "deepseek-chat",
    })).toBeDefined();
  });

  it.each([
    ["length", "{\"summary\":", "agent_tool_output_truncated"],
    ["stop", "not-json", "agent_tool_output_invalid_json"],
  ])("classifies Chat Completions %s output without creating an artifact", async (finishReason, content, errorCategory) => {
    const client = {
      chat: { completions: { async create() {
        return { choices: [{ finish_reason: finishReason, message: { content } }] };
      } } },
    } as OpenAIChatCompletionsClient;
    const executor = createOpenAIChatCompletionsAgentToolExecutor({
      client,
      model: "deepseek-test",
      loadContext: async () => [],
    });
    const envelope = directorEnvelope();

    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({ status: "failed", artifactCreated: false, errorCategory });
    expect(result).not.toHaveProperty("structuredOutput");
  });

  it("uses one bounded model repair when Chat Completions output misses the authoritative schema", async () => {
    const invalid: any = structuredClone(validPptDirectorOutput());
    invalid.page_specs[0].composition.layers[0].text = "not allowed";
    const calls: Record<string, unknown>[] = [];
    const client = {
      chat: { completions: { async create(input: Record<string, unknown>) {
        calls.push(input);
        return {
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify(calls.length === 1 ? invalid : validPptDirectorOutput()) },
          }],
        };
      } } },
    } as OpenAIChatCompletionsClient;
    const executor = createOpenAIChatCompletionsAgentToolExecutor({
      client,
      model: "deepseek-test",
      loadContext: async () => [],
    });
    const envelope = directorEnvelope();

    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({ status: "succeeded", artifactCreated: false });
    expect(calls).toHaveLength(2);
    const repairMessages = calls[1].messages as Array<{ role: string; content: string }>;
    expect(repairMessages.at(-1)?.content).toContain("$.page_specs[0].composition.layers[0].text:additionalProperty");
  });

  it("uses the same bounded repair for PPT production semantics before returning to Main Agent", async () => {
    const invalid: any = structuredClone(validPptDirectorOutput());
    for (const page of invalid.page_specs) page.risk_level = "low";
    const calls: Record<string, unknown>[] = [];
    const client = {
      chat: { completions: { async create(input: Record<string, unknown>) {
        calls.push(input);
        return {
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify(calls.length === 1 ? invalid : validPptDirectorOutput()) },
          }],
        };
      } } },
    } as OpenAIChatCompletionsClient;
    const executor = createOpenAIChatCompletionsAgentToolExecutor({ client, model: "deepseek-test", loadContext: async () => [] });
    const envelope = directorEnvelope();

    const result = await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(result).toMatchObject({ status: "succeeded", artifactCreated: false });
    expect(calls).toHaveLength(2);
    const repairMessages = calls[1].messages as Array<{ role: string; content: string }>;
    expect(repairMessages.at(-1)?.content).toContain("sample_high_risk_page_missing");
  });

  it("gives the final-video Critic the exact evidence and hard-gate contract", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = { responses: { async create(input: Record<string, unknown>) {
      payload = input;
      return { output_text: JSON.stringify({ summary: "成片审查完成。" }) };
    } } } as OpenAIResponsesClient;
    const executor = createOpenAIAgentToolExecutor({ client, model: "test-model", loadContext: async () => [] });
    const envelope = createAgentToolInvocationEnvelope({
      invocationId: "video-final-review-1", toolId: "delivery_critic.review",
      identity: { actorUserId: "teacher-1", actorAuthMode: "password", authSessionId: "session-1" },
      projectId: "project-1", intentEpoch: 1, sourceMessageId: "message-1",
      reviewTargetRef: { artifactId: "video-a", kind: "concat_only_assemble", version: 1, digest: "a".repeat(64) },
      approvedArtifactRefs: [],
      arguments: { domain: "video", stage: "video_final_review", targetLocators: [{ kind: "artifact", artifactKind: "concat_only_assemble", artifactId: "video-a" }], reviewFocus: null, courseAnchorRef: null, rubricRef: { id: "video-final", version: "v1", digest: "b".repeat(64) }, generatorInvocationId: "generator-a" },
    });

    await executor(envelope, getAgentToolDefinition(envelope.toolId));

    expect(payload?.instructions).toContain("实际MP4、时间线、采样帧、字幕或转写和音轨证据");
    expect(payload?.instructions).toContain("shot_timeline_continuity");
    expect(payload?.instructions).toContain("frame_range、track或timeline");
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
