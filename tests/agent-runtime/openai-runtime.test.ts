import { describe, expect, it, vi } from "vitest";
import { FallbackAgentRuntime, createAgentRuntimeFromEnv } from "../../src/server/agent-runtime/runtime-factory";
import { DeterministicRuntime } from "../../src/server/agent-runtime/deterministic-runtime";
import { OpenAIRuntime } from "../../src/server/agent-runtime/openai-runtime";
import type { AgentRuntime, AgentRuntimeInput } from "../../src/server/agent-runtime/types";
import type { ToolCallIntent } from "../../src/server/gpt-protocol/tool-call-intent";
import type { ToolRouterInput } from "../../src/server/tools/tool-router";
import type { ToolExecutionResult } from "../../src/server/tools/tool-types";
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

  it("does not include native tool fields in the Responses payload when nativeToolLoop is not configured", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      responses: {
        create: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { output_text: structuredLessonPlanOutput() };
        },
      },
    };

    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    expectSucceeded(await runtime.run(input()));

    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty("tools");
    expect(calls[0]).not.toHaveProperty("tool_choice");
    expect(calls[0]).not.toHaveProperty("parallel_tool_calls");
  });

  it("runs the optional native tool loop through server-authoritative ToolRouter mapping before parsing final structured output", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const functionCallItem = {
      id: "fc_1",
      type: "function_call",
      status: "completed",
      call_id: "call_create_slides_1",
      name: "createSlides",
      arguments: JSON.stringify({
        userInstruction: "请根据已确认教案生成课件。",
        projectId: "forged-project",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "forged-artifact" }],
        sourceMessageId: "forged-message",
      }),
    };
    const client = {
      responses: {
        create: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          if (calls.length === 1) {
            return { output_text: "", output: [{ id: "rs_1", type: "reasoning", summary: [] }, functionCallItem] };
          }
          return { output_text: structuredLessonPlanOutput() };
        },
      },
    };
    const toolRouter = vi.fn(async (_input: ToolRouterInput) => succeededToolResult());
    const runtimeInput = input();
    const runtime = new OpenAIRuntime({
      client,
      model: "gpt-test",
      nativeToolLoop: {
        tools: [{ type: "function", name: "createSlides" }],
        allowedToolNames: ["createSlides"],
        toolRouter,
        buildToolRouterInput: (intent: ToolCallIntent, serverInput: AgentRuntimeInput): ToolRouterInput => ({
          toolName: intent.toolName,
          projectId: serverInput.projectId,
          userInstruction: intent.teacherIntent?.userInstruction,
          artifactRefs: [{ kind: "lesson_plan", artifactId: `server-${serverInput.runId}` }],
          sourceMessageId: serverInput.runId,
        }),
      },
    });

    const result = expectSucceeded(await runtime.run(runtimeInput));

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      tools: [{ type: "function", name: "createSlides" }],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(toolRouter).toHaveBeenCalledTimes(1);
    expect(toolRouter).toHaveBeenCalledWith({
      toolName: "createSlides",
      projectId: "project-openai",
      userInstruction: "请根据已确认教案生成课件。",
      artifactRefs: [{ kind: "lesson_plan", artifactId: "server-run-openai" }],
      sourceMessageId: "run-openai",
    });
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-project");
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-artifact");
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-message");
    expect(calls[1].input).toEqual([
      { id: "rs_1", type: "reasoning", summary: [] },
      functionCallItem,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_create_slides_1",
        output: expect.stringContaining("材料已生成"),
      }),
    ]);
    expect(result).toMatchObject({
      status: "succeeded",
      run: { runtimeKind: "openai", status: "succeeded" },
      artifactDraft: { generationMode: "model_generated", contentType: "text/markdown" },
    });
  });

  it("returns the current safe recovery message when the optional native tool loop is blocked", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: "",
          output: [
            { type: "function_call", call_id: "call_1", name: "createSlides", arguments: "{}" },
            { type: "function_call", call_id: "call_2", name: "createSlides", arguments: "{}" },
          ],
        }),
      },
    };
    const toolRouter = vi.fn(async (_input: ToolRouterInput) => succeededToolResult());
    const runtime = new OpenAIRuntime({
      client,
      model: "gpt-test",
      nativeToolLoop: {
        tools: [{ type: "function", name: "createSlides" }],
        allowedToolNames: ["createSlides"],
        toolRouter,
        buildToolRouterInput: (intent: ToolCallIntent, serverInput: AgentRuntimeInput): ToolRouterInput => ({
          toolName: intent.toolName,
          projectId: serverInput.projectId,
        }),
      },
    });

    const result = await runtime.run(input());

    expect(result.status).toBe("failed");
    expect(toolRouter).not.toHaveBeenCalled();
    const teacherText = [result.assistantMessage.title, result.assistantMessage.body, result.nextSuggestedAction.label].join("\n");
    expect(teacherText).toContain("本次生成没有完成");
    expect(teacherText).toContain("重试");
    for (const term of ["provider", "schema", "debug", "function_call", "tool", "OPENAI_API_KEY", "local path"]) {
      expect(teacherText).not.toContain(term);
    }
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

  it("falls back to deterministic artifacts when the configured model runtime fails", async () => {
    const failingPrimary: AgentRuntime = {
      async run(runtimeInput) {
        return {
          status: "failed",
          run: {
            runId: runtimeInput.runId,
            projectId: runtimeInput.projectId,
            task: runtimeInput.task,
            runtimeKind: "openai",
            status: "failed",
          },
          assistantMessage: {
            title: "本次生成没有完成",
            body: "请稍后重试。",
          },
          nextSuggestedAction: {
            type: "retry",
            label: "重试本次生成",
          },
        };
      },
    };

    const runtime = new FallbackAgentRuntime(failingPrimary, new DeterministicRuntime());
    const result = expectSucceeded(await runtime.run(input()));

    expect(result.run.runtimeKind).toBe("deterministic");
    expect(result.artifactDraft.generationMode).toBe("deterministic_draft");
    expect(result.artifactDraft.markdown).toContain("## 教学目标");
    expect(result.artifactDraft.markdown).toContain("## 自检清单");
  });
});

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

function succeededToolResult(): ToolExecutionResult {
  return {
    status: "succeeded",
    toolId: "createSlides",
    capabilityId: "coze_ppt",
    artifactDraft: {
      nodeKey: "slide_deck",
      kind: "pptx",
      title: "百分数课件",
      summary: "已生成。",
      markdownContent: "# 百分数课件",
    },
    assistantSummary: "材料已生成，可以检查。",
    budgetEvent: {
      capabilityId: "coze_ppt",
      actionKey: "createSlides:pptx",
      status: "succeeded",
      kind: "tool_succeeded",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
  };
}
