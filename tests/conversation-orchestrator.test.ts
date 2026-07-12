import { describe, expect, it } from "vitest";
import {
  OpenAIConversationOrchestrator,
  buildOpenAIConversationRequest,
  createDeterministicConversationOrchestrator,
} from "../src/server/conversation/conversation-orchestrator";
import { pickOpenAICompatibleConfig } from "../src/server/openai-compatible-config";

const baseInput = {
  projectContext: {
    grade: "五年级",
    subject: "数学",
    topic: "百分数",
    textbookVersion: "人教版",
  },
  artifactRefs: [],
  recentMessages: [],
};

describe("ConversationOrchestrator", () => {
  it("uses model intent to answer greetings without generating requirement artifacts", async () => {
    const calls: unknown[] = [];
    const orchestrator = new OpenAIConversationOrchestrator({
      model: "gpt-test",
      fallback: createDeterministicConversationOrchestrator(),
      client: {
        responses: {
          create: async (payload: unknown) => {
            calls.push(payload);
            return {
              output_text: JSON.stringify({
                intent: "clarify",
                assistantMessage: {
                  body: "我在。你可以先告诉我年级、课题和想生成的材料，我再开始整理。",
                },
                shouldGenerateRequirement: false,
                normalizedBrief: {},
              }),
            };
          },
        },
      },
    });

    const decision = await orchestrator.decide({ ...baseInput, userMessage: "你好" });

    expect(decision).toMatchObject({
      intent: "clarify",
      shouldGenerateRequirement: false,
      runtimeKind: "openai",
      assistantMessage: { body: expect.stringContaining("年级") },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "gpt-test",
      text: { format: { type: "json_schema", name: "shanhai_conversation_decision", strict: true } },
    });
    expect(JSON.stringify(calls[0])).not.toContain("credential-sample");
  });

  it("uses model intent to start requirement generation for explicit lesson requests", async () => {
    const orchestrator = new OpenAIConversationOrchestrator({
      model: "gpt-test",
      fallback: createDeterministicConversationOrchestrator(),
      client: {
        responses: {
          create: async () => ({
            output_text: JSON.stringify({
              intent: "start_requirement",
              assistantMessage: {
                title: "开始整理备课需求",
                body: "我先把这节课整理成可确认的需求规格。",
              },
              shouldGenerateRequirement: true,
              normalizedBrief: {
                grade: "五年级",
                subject: "数学",
                topic: "百分数",
                requestedOutputs: ["教案", "PPT 大纲"],
                teacherGoal: "公开课展示",
              },
            }),
          }),
        },
      },
    });

    const decision = await orchestrator.decide({
      ...baseInput,
      userMessage: "五年级百分数公开课，生成教案和 PPT 大纲",
    });

    expect(decision).toMatchObject({
      intent: "start_requirement",
      shouldGenerateRequirement: true,
      runtimeKind: "openai",
      normalizedBrief: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["教案", "PPT 大纲"],
      },
    });
  });

  it("falls back safely when the model call fails", async () => {
    const orchestrator = new OpenAIConversationOrchestrator({
      model: "gpt-test",
      fallback: createDeterministicConversationOrchestrator(),
      client: {
        responses: {
          create: async () => {
            throw new Error("provider debug credential-sample internal-endpoint-marker");
          },
        },
      },
    });

    const decision = await orchestrator.decide({ ...baseInput, userMessage: "你好" });
    const teacherText = [decision.assistantMessage.title, decision.assistantMessage.body].join("\n");

    expect(decision.runtimeKind).toBe("deterministic");
    expect(decision.shouldGenerateRequirement).toBe(false);
    for (const term of ["provider", "debug", "credential-sample", "internal-endpoint-marker"]) {
      expect(teacherText).not.toContain(term);
    }
    expect(teacherText).toContain("我在");
  });

  it("builds request payload without credentials", () => {
    const request = buildOpenAIConversationRequest(
      {
        ...baseInput,
        userMessage: "三年级数学公开课，生成教案",
        recentMessages: [{ role: "assistant", content: "上一轮回复" }],
      },
      "gpt-test",
    );

    const payload = JSON.stringify(request);
    expect(payload).toContain("三年级数学公开课");
    expect(payload).toContain("上一轮回复");
    expect(payload).toContain("shanhai_conversation_decision");
    expect(payload).not.toContain("OPENAI_API_KEY");
    expect(payload).not.toContain("AGENT_BRAIN");
    expect(payload).not.toContain("sk-");
  });
});

describe("OpenAI-compatible config", () => {
  it("defaults Main Agent model selection to Terra High", () => {
    const config = pickOpenAICompatibleConfig({
      AGENT_BRAIN_API_KEY: "ledger-secret",
    });

    expect(config).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });

  it("selects OpenAI env before ledger env", () => {
    const config = pickOpenAICompatibleConfig({
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "openai-model",
      AGENT_BRAIN_API_KEY: "ledger-secret",
      AGENT_BRAIN_MODEL: "ledger-model",
    });

    expect(config).toMatchObject({
      credential: "openai-secret",
      credentialSource: "openai_env",
      model: "openai-model",
    });
  });

  it("selects the requested ledger channel", () => {
    const config = pickOpenAICompatibleConfig({
      AGENT_BRAIN_CHANNEL: "third",
      AGENT_BRAIN_API_KEY: "primary-secret",
      AGENT_BRAIN_THIRD_API_KEY: "third-secret",
      AGENT_BRAIN_THIRD_BASE_URL: "https://third.invalid/v1",
      AGENT_BRAIN_THIRD_MODEL: "third-model",
    });

    expect(config).toMatchObject({
      credential: "third-secret",
      credentialSource: "agent_brain_third_ledger_env",
      baseURL: "https://third.invalid/v1",
      model: "third-model",
    });
  });
}
);
