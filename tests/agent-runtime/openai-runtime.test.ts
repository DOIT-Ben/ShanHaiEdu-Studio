import { describe, expect, it, vi } from "vitest";
import { createAgentRuntimeFromEnv } from "../../src/server/agent-runtime/runtime-factory";
import { DeterministicRuntime } from "../../src/server/agent-runtime/deterministic-runtime";
import { OpenAIRuntime } from "../../src/server/agent-runtime/openai-runtime";
import type { AgentRuntime, AgentRuntimeInput } from "../../src/server/agent-runtime/types";
import type { ToolCallIntent } from "../../src/server/gpt-protocol/tool-call-intent";
import type { ToolRouterInput } from "../../src/server/tools/tool-router";
import type { ToolExecutionResult } from "../../src/server/tools/tool-types";
import { expectSucceeded } from "./test-helpers";
import { validPptDesignPackage } from "../support/ppt-quality-fixture";
import { createPptDesignCandidateProjection, type PptDesignCandidateInput } from "../../src/server/ppt-quality/ppt-design-candidate";
import { createStoryboardManifest } from "../../src/server/video-quality/video-production-contract";
import { createVideoNarrationScript } from "../../src/server/video-quality/video-narration-contract";

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

function pptDesignInput(): AgentRuntimeInput {
  return {
    ...input(),
    task: "ppt_design",
    userMessage: "请生成逐页 PPT 质量设计包。",
    approvedArtifacts: [{
      nodeKey: "ppt_draft",
      title: "百分数 PPT 大纲",
      summary: "已确认 12 页逐页大纲。",
      markdown: "## 建议页数\n12 页\n\n## 逐页脚本\n12 页均已逐页确认。",
    }],
  };
}

function storyboardInput(): AgentRuntimeInput {
  return { ...input(), task: "storyboard_generate", userMessage: "请生成独立创意导入视频分镜。", approvedArtifacts: [{ nodeKey: "video_script_generate", title: "机械谜题", summary: "独立短片在结尾回到课程问题。", markdown: "## 视频脚本\n机械装置发生三次变化。" }] };
}

function videoScriptInput(): AgentRuntimeInput {
  return { ...input(), task: "video_script_generate", userMessage: "请生成受控旁白脚本。", approvedArtifacts: [{ nodeKey: "creative_theme_generate", title: "机械谜题", summary: "独立短片只在结尾回接课程。", markdown: "## 一句话故事\n机械装置发生异常变化。" }] };
}

function validStoryboardManifest() {
  return createStoryboardManifest({
    schemaVersion: "video-storyboard.v1",
    intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, courseAnchor: "结尾只出现一次课堂问题", classroomReturnQuestion: "这个变化意味着什么？", answerDisclosureBoundary: "不得解释课程答案" },
    shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, sceneFunction: "推进独立悬念", mainSubject: "机械装置", subjectAction: "改变状态", cameraMotion: "缓慢推进", continuityKeys: ["同一装置"], startFrameIntent: "承接上一状态", endFrameIntent: "留下新疑问", referencePolicy: "none" as const, referenceAssetIds: [], textPolicy: "post_production_only" as const, modelPrompt: `机械装置镜头 ${ordinal}`, negativePrompt: "不要课堂讲解和答案", retakeVariables: ["subjectAction"] })),
    references: [],
  });
}

describe("OpenAIRuntime", () => {
  it("computes and transports a controlled narration script", async () => {
    const semantic = { schemaVersion: "video-narration-script.v1" as const, language: "zh-CN" as const, voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么会连续发生变化？带着这个问题回到课堂。", courseAnchor: "带着问题回到课堂", answerDisclosureBoundary: "不解释答案" };
    const expected = createVideoNarrationScript(semantic);
    const client = { responses: { create: async () => ({ output_text: structuredVideoScriptOutput(semantic) }) } };
    const result = expectSucceeded(await new OpenAIRuntime({ client, model: "gpt-test" }).run(videoScriptInput()));
    expect(result.artifactDraft.structuredContent).toEqual({ videoNarrationScript: expected });
  });

  it("rejects a video script without controlled narration data", async () => {
    const client = { responses: { create: async () => ({ output_text: structuredVideoScriptOutput(null) }) } };
    await expect(new OpenAIRuntime({ client, model: "gpt-test" }).run(videoScriptInput())).resolves.toMatchObject({ status: "failed" });
  });

  it("transports a validated video storyboard manifest as executable structured content", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const manifest = validStoryboardManifest();
    const client = { responses: { create: async (payload: Record<string, unknown>) => { calls.push(payload); return { output_text: structuredStoryboardOutput(manifest) }; } } };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = expectSucceeded(await runtime.run(storyboardInput()));
    expect(result.artifactDraft.structuredContent).toEqual({ videoStoryboardManifest: manifest });
    expect(JSON.stringify(calls[0])).toContain("videoStoryboardManifest");
    expect(JSON.stringify(calls[0])).toContain("single minimal return");
  });

  it("rejects storyboard output without a validated structured manifest", async () => {
    const client = { responses: { create: async () => ({ output_text: structuredStoryboardOutput(null) }) } };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    await expect(runtime.run(storyboardInput())).resolves.toMatchObject({ status: "failed" });
  });

  it("transports a compact PPT design candidate without projecting production structural content", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const candidate = compactPptDesignCandidate();
    expect(() => createPptDesignCandidateProjection(candidate)).not.toThrow();
    const client = {
      responses: {
        create: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { output_text: structuredPptDesignOutput(candidate) };
        },
      },
    };

    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = expectSucceeded(await runtime.run(pptDesignInput()));

    expect(result.artifactDraft.structuredContent?.pptDesignCandidate).toMatchObject({
      schemaVersion: "ppt-design-candidate.v1",
      taskBriefDigest: "b".repeat(64),
      candidateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptDesignPackage");
    expect(JSON.stringify(calls[0])).not.toContain("mediaAccessibility");
    expect(JSON.stringify(calls[0])).not.toContain("productionPath");
    expect(JSON.stringify(calls[0])).toContain("逐页紧凑设计候选");
    expect(calls[0]).toMatchObject({
      text: {
        format: {
          schema: {
            properties: {
              artifactDraft: {
                required: expect.arrayContaining(["structuredContentJson"]),
              },
            },
          },
        },
      },
    });
  });

  it("rejects PPT design output when the structured candidate is missing", async () => {
    const client = {
      responses: {
        create: async () => ({ output_text: structuredPptDesignOutput(null) }),
      },
    };

    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = await runtime.run(pptDesignInput());

    expect(result.status).toBe("failed");
  });

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
    const result = expectSucceeded(await runtime.run({
      ...input(),
      taskInput: {
        teacherGoal: "五年级数学百分数公开课，约 10 页",
        targetPageCount: 10,
        reliableDefaultPolicy: "use_general_curriculum_context",
      },
    }));

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
    expect(JSON.stringify(calls[0])).toContain("targetPageCount");
    expect(JSON.stringify(calls[0])).toContain("use_general_curriculum_context");
    expect(calls[0]).toMatchObject({ instructions: expect.stringContaining("可修改且不伪造教材证据的通用课程默认") });
    expect(calls[0]).toMatchObject({ instructions: expect.stringContaining("逐字作为二级标题") });
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
      { role: "user", content: expect.stringContaining("百分数") },
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

  it("fails honestly without a configured model channel", async () => {
    const runtime = createAgentRuntimeFromEnv({});
    const result = await runtime.run(input());

    expect(result).toMatchObject({ status: "failed", run: { runtimeKind: "openai", status: "failed" } });
    expect(result).not.toHaveProperty("artifactDraft");
  });

  it("allows an explicit deterministic runtime fixture only outside production", async () => {
    const fixtureRuntime = createAgentRuntimeFromEnv({
      NODE_ENV: "development",
      SHANHAI_E2E_DETERMINISTIC_RUNTIME: "1",
    });
    const fixtureResult = expectSucceeded(await fixtureRuntime.run(input()));
    expect(fixtureResult).toMatchObject({
      status: "succeeded",
      run: { runtimeKind: "deterministic" },
      artifactDraft: { generationMode: "deterministic_draft" },
    });

    const productionRuntime = createAgentRuntimeFromEnv({
      NODE_ENV: "production",
      SHANHAI_E2E_DETERMINISTIC_RUNTIME: "1",
    });
    expect(await productionRuntime.run(input())).toMatchObject({
      status: "failed",
      run: { runtimeKind: "openai" },
    });
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

    expect(result).toMatchObject({ status: "failed", failure: { category: "validation", retryable: true } });
    expect(result.assistantMessage.body).toContain("重试");
  });

  it("sanitizes engineering words from successful model output before returning teacher-facing content", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            assistantMessage: {
              title: "provider schema 已生成 projectId=abc",
              body: "debug function_call runtimeKind=openai artifactRefs=[] placeholder=false",
            },
            artifactDraft: {
              title: "公开课教案 providerStatus=real",
              summary: "sourceMessageId=message-a local path C:\\Users\\HB\\secret.txt",
              markdown: [
                "## 教材依据",
                "- 基于已确认需求规格。projectId=abc",
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
                "- 保留追问句。function_call create_lesson_plan API key: sk-secret-value OPENAI_API_KEY=sk-another-secret C:\\Users\\HB\\Secret Folder\\secret file.pdf",
                "## 自检清单",
                "- 教学重点和教学难点是否区分清楚。",
              ].join("\n"),
            },
            nextSuggestedAction: {
              label: "review_artifact provider debug",
            },
          }),
        }),
      },
    };

    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });
    const result = expectSucceeded(await runtime.run(input()));
    const visibleText = [
      result.assistantMessage.title,
      result.assistantMessage.body,
      result.artifactDraft.title,
      result.artifactDraft.summary,
      result.artifactDraft.markdown,
      result.nextSuggestedAction.label,
    ].join("\n");

    expect(visibleText).not.toMatch(/projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|function_call|provider|schema|debug|local path|create_lesson_plan|OPENAI_API_KEY|API key|sk-secret|Secret Folder|secret file|C:\\Users\\HB/i);
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

  it.each([
    ["timeout", new Error("Request timed out after 20000ms")],
    ["network", new Error("fetch failed: ECONNRESET")],
  ] as const)("classifies %s failures without creating an artifact", async (category, failure) => {
    const client = { responses: { async create() { throw failure; } } };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });

    const result = await runtime.run(input());

    expect(result).toMatchObject({
      status: "failed",
      run: { runId: "run-openai", status: "failed" },
      failure: { category, retryable: true },
    });
    expect("artifactDraft" in result).toBe(false);
  });

  it.each([
    ["parse", "{not-json"],
    ["missing_field", JSON.stringify({ assistantMessage: { title: "标题", body: "正文" } })],
  ] as const)("classifies %s output failures without promoting success", async (category, outputText) => {
    const client = { responses: { async create() { return { output_text: outputText }; } } };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test" });

    const result = await runtime.run(input());

    expect(result).toMatchObject({ status: "failed", failure: { category } });
    expect("artifactDraft" in result).toBe(false);
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

function structuredPptDesignOutput(candidate: PptDesignCandidateInput | null): string {
  return JSON.stringify({
    assistantMessage: {
      title: "PPT 设计候选已生成",
      body: "已生成可检查的逐页结构化设计候选。",
    },
    artifactDraft: {
      title: "百分数 PPT 逐页设计候选",
      summary: "包含 12 页任务语义、视觉方向和逐页结构。",
      markdown: [
        "## 任务语义",
        "五年级百分数公开课逐页设计。",
        "## 证据绑定",
        "教材证据与目标逐项绑定。",
        "## 视觉方向",
        "统一轻立体课堂视觉。",
        "## 逐页结构",
        "12 页逐页描述。",
        "## 下游准备",
        "可继续展开完整页面结构并进入独立生产门。",
        "## 自检清单",
        "逐页结构、证据和下游边界已检查。",
      ].join("\n"),
      structuredContentJson: candidate === null
        ? null
        : JSON.stringify({ pptDesignCandidate: candidate }),
    },
    nextSuggestedAction: {
      label: "查看并确认 PPT 设计包",
    },
  });
}

function compactPptDesignCandidate(): PptDesignCandidateInput {
  const packageValue = validPptDesignPackage();
  return {
    schemaVersion: "ppt-design-candidate.v1",
    taskBriefDigest: "b".repeat(64),
    goalSummary: "五年级百分数公开课逐页PPT设计。",
    brief: {
      grade: packageValue.brief.grade,
      subject: packageValue.brief.subject,
      topic: packageValue.brief.topic,
      audience: packageValue.brief.audience,
      useCase: packageValue.brief.useCase,
      targetSlideCount: packageValue.brief.targetSlideCount,
    },
    evidenceBindings: packageValue.evidenceBindings.map((binding) => ({ ...binding, digest: "a".repeat(64) })),
    objectives: packageValue.objectives,
    narrative: {
      openingTension: packageValue.narrative.openingTension,
      learningProgression: packageValue.narrative.learningProgression,
      closingResolution: packageValue.narrative.closingResolution,
    },
    pagePlans: packageValue.pageSpecs.map((page) => ({
      pageNumber: page.pageNumber,
      objectiveIds: page.objectiveIds,
      narrativeJob: page.narrativeJob,
      teachingAction: page.teachingAction,
      takeawayTitle: page.takeawayTitle,
      primaryVisualBrief: page.primaryVisualBrief,
    })),
    downstreamUse: "production_design_expansion",
  };
}

function structuredStoryboardOutput(manifest: ReturnType<typeof validStoryboardManifest> | null): string {
  return JSON.stringify({
    assistantMessage: { title: "视频分镜已生成", body: "已形成三镜头独立创意分镜。" },
    artifactDraft: {
      title: "机械谜题导入视频分镜", summary: "三镜头推进独立悬念，只在结尾回到课程问题。",
      markdown: ["## 目标总时长", "30-60 秒。", "## 分镜 ID", "shot_01 至 shot_03。", "## 每镜头时长", "每镜头 10-20 秒。", "## 镜头目标", "推进独立悬念。", "## 场景", "机械工作间。", "## 画面动作", "装置逐步变化。", "## 镜头运动", "缓慢推进。", "## 旁白或字幕", "后期仅保留疑问。", "## 角色、道具、场景资产", "同一机械装置。", "## 关键帧要求", "保持装置状态连续。", "## 连贯性说明", "首尾状态逐镜头承接。", "## 自检清单", "镜头、资产和唯一课程回接已检查。"].join("\n"),
      structuredContentJson: manifest ? JSON.stringify({ videoStoryboardManifest: manifest }) : null,
    },
    nextSuggestedAction: { label: "查看并确认视频分镜" },
  });
}

function structuredVideoScriptOutput(script: Omit<ReturnType<typeof createVideoNarrationScript>, "scriptDigest"> | null): string {
  return JSON.stringify({
    assistantMessage: { title: "视频脚本已生成", body: "已形成受控旁白。" },
    artifactDraft: { title: "机械谜题视频脚本", summary: "独立悬念与唯一课程回接。", markdown: ["## 视频脚本", "机械装置连续变化。", "## 旁白或字幕", "提出疑问。", "## 每镜头时长", "三镜头各 6 秒。", "## 课堂边界约束", "不解释答案。", "## 课堂落点", "只在结尾回到课堂问题。", "## 自检清单", "独立创意与课程边界已检查。"].join("\n"), structuredContentJson: script ? JSON.stringify({ videoNarrationScript: script }) : null },
    nextSuggestedAction: { label: "查看并确认视频脚本" },
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
