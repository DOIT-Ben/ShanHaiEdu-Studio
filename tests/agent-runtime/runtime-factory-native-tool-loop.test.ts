import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeInput } from "@/server/agent-runtime/types";

const responseQueue: unknown[] = [];
const responsePayloads: Record<string, unknown>[] = [];

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function OpenAIMock() {
    return {
      responses: {
        create: vi.fn(async (payload: Record<string, unknown>) => {
          responsePayloads.push(payload);
          const next = responseQueue.shift();
          if (!next) {
            throw new Error("No fake OpenAI response queued");
          }
          return next;
        }),
      },
    };
  }),
}));

describe("createAgentRuntimeFromEnv native tool loop", () => {
  beforeEach(() => {
    responseQueue.length = 0;
    responsePayloads.length = 0;
  });

  it("does not inject a Tool loop into the artifact runtime", async () => {
    const { createAgentRuntimeFromEnv } = await import("@/server/agent-runtime/runtime-factory");
    responseQueue.push({ output_text: structuredLessonPlanOutput() });

    const runtime = createAgentRuntimeFromEnv(openAIEnv());
    const result = await runtime.run(runtimeInput());

    expect(result.status).toBe("succeeded");
    expect(responsePayloads).toHaveLength(1);
    expect(responsePayloads[0]).not.toHaveProperty("tools");
    expect(responsePayloads[0]).not.toHaveProperty("tool_choice");
    expect(responsePayloads[0]).not.toHaveProperty("parallel_tool_calls");
  });

  it("returns the real runtime failure instead of creating a deterministic draft after a 60-second-equivalent failure", async () => {
    const { createAgentRuntimeFromEnv } = await import("@/server/agent-runtime/runtime-factory");
    const runtime = createAgentRuntimeFromEnv(openAIEnv());

    const result = await runtime.run(runtimeInput());

    expect(result).toMatchObject({
      status: "failed",
      run: { runtimeKind: "openai", status: "failed" },
    });
    expect("artifactDraft" in result).toBe(false);
  });

  it("uses a configurable 180-second Runtime timeout for real Provider generation", async () => {
    const { resolveAgentRuntimeTimeoutMs } = await import("@/server/agent-runtime/runtime-factory");

    expect(resolveAgentRuntimeTimeoutMs({})).toBe(180_000);
    expect(resolveAgentRuntimeTimeoutMs({ AGENT_RUNTIME_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(resolveAgentRuntimeTimeoutMs({ AGENT_RUNTIME_TIMEOUT_MS: "1000" })).toBe(180_000);
    expect(resolveAgentRuntimeTimeoutMs({ AGENT_RUNTIME_TIMEOUT_MS: "not-a-number" })).toBe(180_000);
  });
});

function openAIEnv() {
  return {
    MODEL_GATEWAY_API_KEY: "test-key",
    MODEL_GATEWAY_BASE_URL: "https://example.invalid/v1",
    MODEL_GATEWAY_AGENT_MODEL: "gpt-test",
  };
}

function runtimeInput(overrides: Partial<AgentRuntimeInput> = {}): AgentRuntimeInput {
  return {
    projectId: "project-openai",
    runId: "run-openai",
    sourceMessageId: "message-openai",
    task: "lesson_plan",
    userMessage: "请生成百分数公开课教案。",
    projectContext: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      lessonDurationMinutes: 40,
      textbookVersion: "人教版",
      teacherGoal: "完成一节可展示的公开课。",
      requestedOutputs: ["教案", "PPT 大纲"],
    },
    approvedArtifacts: [
      {
        nodeKey: "requirement_spec",
        title: "需求规格说明书",
        summary: "确认五年级数学百分数公开课。",
        markdown: "## 项目概述\n百分数公开课。",
      },
    ],
    ...overrides,
  };
}

function structuredLessonPlanOutput(): string {
  return JSON.stringify({
    assistantMessage: {
      title: "公开课教案已生成",
      body: "已根据已确认材料生成可检查的教案草稿。",
    },
    artifactDraft: {
      title: "公开课教案",
      summary: "包含目标、重难点、流程和板书。",
      markdown: [
        "## 教材依据",
        "- 基于已确认需求规格。",
        "## 教学目标",
        "- 理解百分数意义。",
        "## 重点难点",
        "- 教学重点：理解百分数意义。",
        "- 教学难点：把生活情境转化为百分数表达。",
        "## 教学流程",
        "- 情境导入。",
        "## 导入设计",
        "- 从生活比例问题开始。",
        "## 学生活动",
        "- 观察、表达、归纳。",
        "## 板书设计",
        "- 百分数。",
        "## 课堂总结",
        "- 回到百分数意义。",
        "## 教师讲稿要点",
        "- 保留追问句。",
        "## 自检清单",
        "- 教学重点和教学难点是否区分清楚。",
      ].join("\n"),
    },
    nextSuggestedAction: {
      label: "查看并确认教案",
    },
  });
}
