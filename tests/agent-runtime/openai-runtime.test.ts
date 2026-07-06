import { describe, expect, it } from "vitest";
import { createAgentRuntimeFromEnv } from "../../src/server/agent-runtime/runtime-factory";
import { OpenAIRuntime } from "../../src/server/agent-runtime/openai-runtime";
import type { AgentRuntimeInput } from "../../src/server/agent-runtime/types";
import { expectSucceeded } from "./test-helpers";

function input(): AgentRuntimeInput {
  return {
    projectId: "project-openai",
    runId: "run-openai",
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
        markdown: "## 项目概述\n百分数公开课。\n\n## 后续节点输入\n教案需围绕百分数意义展开。",
      },
    ],
  };
}

describe("OpenAIRuntime", () => {
  it("builds a Responses API request and parses structured output into the runtime contract", async () => {
    const calls: unknown[] = [];
    const client = {
      responses: {
        create: async (payload: unknown) => {
          calls.push(payload);
          return {
            output_text: JSON.stringify({
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
            }),
          };
        },
      },
    };

    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = expectSucceeded(await runtime.run(input()));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "gpt-test",
      instructions: expect.stringContaining("小学数学公开课"),
      text: {
        format: {
          type: "json_schema",
          name: "shanhai_agent_runtime_result",
          strict: true,
        },
      },
    });
    expect(JSON.stringify(calls[0])).toContain("五年级");
    expect(JSON.stringify(calls[0])).toContain("百分数");
    expect(JSON.stringify(calls[0])).toContain("需求规格说明书");
    expect(JSON.stringify(calls[0])).toContain("教案需围绕百分数意义展开");
    expect(result).toMatchObject({
      status: "succeeded",
      run: {
        runtimeKind: "openai",
        status: "succeeded",
      },
      artifactDraft: {
        nodeKey: "lesson_plan",
        kind: "lesson_plan",
        generationMode: "model_generated",
        contentType: "text/markdown",
      },
    });
  });

  it("falls back to deterministic runtime when no key is configured", async () => {
    const runtime = createAgentRuntimeFromEnv({});
    const result = expectSucceeded(await runtime.run(input()));

    expect(result.status).toBe("succeeded");
    expect(result.run.runtimeKind).toBe("deterministic");
    expect(result.artifactDraft.generationMode).toBe("deterministic_draft");
  });

  it("rejects thin model output that misses required review sections", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            assistantMessage: {
              title: "公开课教案已生成",
              body: "已生成。",
            },
            artifactDraft: {
              title: "公开课教案",
              summary: "内容较短。",
              markdown: "## 教学目标\n- 理解百分数意义。",
            },
            nextSuggestedAction: {
              label: "查看并确认教案",
            },
          }),
        }),
      },
    };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = await runtime.run(input());

    expect(result.status).toBe("failed");
    expect(result.assistantMessage.body).toContain("重试");
  });

  it("returns teacher-facing recovery when the model call fails", async () => {
    const client = {
      responses: {
        create: async () => {
          throw new Error("provider schema debug stack OPENAI_API_KEY local path");
        },
      },
    };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = await runtime.run(input());

    expect(result.status).toBe("failed");
    const teacherText = [result.assistantMessage.title, result.assistantMessage.body, result.nextSuggestedAction.label].join("\n");
    for (const term of ["provider", "schema", "debug", "stack", "OPENAI_API_KEY", "local path"]) {
      expect(teacherText).not.toContain(term);
    }
    expect(teacherText).toContain("本次生成没有完成");
    expect(teacherText).toContain("重试");
  });
});
