import { describe, expect, it, vi } from "vitest";
import {
  createOpenAIRuntimeNativeToolLoopOptions,
  nativeToolLoopTaskToolMap,
} from "@/server/agent-runtime/native-tool-loop-config";
import type { AgentRuntime, AgentRuntimeInput } from "@/server/agent-runtime/types";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

describe("OpenAIRuntime native tool loop config", () => {
  it("exposes only the first-batch internal tool allowlist", () => {
    expect(nativeToolLoopTaskToolMap.requirement_spec).toBe("create_requirement_spec");
    expect(nativeToolLoopTaskToolMap.lesson_plan).toBe("create_lesson_plan");
    expect(nativeToolLoopTaskToolMap.ppt_design).toBe("create_ppt_design_draft");
    expect(nativeToolLoopTaskToolMap.final_delivery_checklist).toBe("create_final_delivery_checklist");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("generate_pptx_from_design");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("generate_classroom_image");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("generate_video_segment");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("asset_image_generate");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("concat_only_assemble");
  });

  it("builds one OpenAI function tool for the current runtime task", () => {
    const options = createOpenAIRuntimeNativeToolLoopOptions(runtimeInput({ task: "lesson_plan" }), {
      toolExecutionRuntime: fakeRuntime(),
      toolRouter: fakeToolRouter(),
    });

    expect(options).toBeDefined();
    expect(options?.allowedToolNames).toEqual(["create_lesson_plan"]);
    expect(options?.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "create_lesson_plan",
        description: expect.stringContaining("教案"),
        parameters: expect.objectContaining({ type: "object" }),
        strict: true,
      }),
    ]);
  });

  it("exports a strict-safe teacher intent schema without unsupported composition keywords", () => {
    const options = createOpenAIRuntimeNativeToolLoopOptions(runtimeInput({ task: "lesson_plan" }), {
      toolExecutionRuntime: fakeRuntime(),
      toolRouter: fakeToolRouter(),
    });
    const serializedTools = JSON.stringify(options?.tools);

    expect(serializedTools).not.toContain("allOf");
    expect(serializedTools).not.toContain("contains");
    expect(serializedTools).not.toContain("minItems");
    expect(options?.tools).toEqual([
      expect.objectContaining({
        parameters: expect.objectContaining({
          additionalProperties: false,
          required: ["userInstruction", "teacherIntent", "notes"],
        }),
      }),
    ]);
  });

  it("does not expose blocked, provider, or unmapped tasks to the native loop", () => {
    for (const task of ["concat_only_assemble", "textbook_evidence", "intro_video_plan"] as const) {
      expect(createOpenAIRuntimeNativeToolLoopOptions(runtimeInput({ task }), {
        toolExecutionRuntime: fakeRuntime(),
        toolRouter: fakeToolRouter(),
      })).toBeUndefined();
    }
  });

  it("maps tool calls with server-authoritative runtime context and strips forged model controls", () => {
    const toolExecutionRuntime = fakeRuntime();
    const options = createOpenAIRuntimeNativeToolLoopOptions(runtimeInput({
      projectId: "server-project",
      runId: "run-1",
      sourceMessageId: "teacher-message-1",
      task: "ppt_design",
    }), {
      toolExecutionRuntime,
      toolRouter: fakeToolRouter(),
    });
    const intent: ToolCallIntent = {
      toolName: "create_ppt_design_draft",
      callId: "call-1",
      status: "ready",
      teacherIntent: {
        userInstruction: "请生成逐页 PPT 设计稿。",
      },
      diagnostics: {
        omittedUnsafeArgumentCount: 3,
      },
    };

    const routerInput = options?.buildToolRouterInput(intent, runtimeInput({
      projectId: "server-project",
      runId: "run-1",
      sourceMessageId: "teacher-message-1",
      task: "ppt_design",
    }));

    expect(routerInput).toMatchObject({
      toolName: "create_ppt_design_draft",
      projectId: "server-project",
      userInstruction: "请生成逐页 PPT 设计稿。",
      projectContext: expect.objectContaining({ topic: "百分数" }),
      approvedArtifacts: [expect.objectContaining({ nodeKey: "ppt_draft" })],
      sourceMessageId: "teacher-message-1",
    });
    expect(routerInput?.runtime).toBe(toolExecutionRuntime);
    expect(JSON.stringify(routerInput)).not.toContain("forged-project");
    expect(JSON.stringify(routerInput)).not.toContain("forged-artifact");
    expect(JSON.stringify(routerInput)).not.toContain("forged-message");
  });
});

function runtimeInput(overrides: Partial<AgentRuntimeInput> = {}): AgentRuntimeInput {
  return {
    projectId: "project-openai",
    runId: "run-openai",
    sourceMessageId: "message-openai",
    task: "lesson_plan",
    userMessage: "请生成五年级数学百分数公开课材料。",
    projectContext: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      lessonDurationMinutes: 40,
      textbookVersion: "人教版",
      teacherGoal: "完成一节可展示的公开课。",
      requestedOutputs: ["教案", "PPT"],
    },
    approvedArtifacts: [
      {
        nodeKey: "ppt_draft",
        title: "PPT 大纲",
        summary: "已确认逐页大纲。",
        markdown: "## 第 1 页\n百分数导入。",
      },
    ],
    ...overrides,
  };
}

function fakeRuntime(): AgentRuntime {
  return {
    async run(input) {
      return {
        status: "failed",
        run: {
          runId: input.runId,
          projectId: input.projectId,
          task: input.task,
          runtimeKind: "deterministic",
          status: "failed",
        },
        assistantMessage: { title: "未执行", body: "测试替身。" },
        nextSuggestedAction: { type: "retry", label: "重试" },
      };
    },
  };
}

function fakeToolRouter() {
  return vi.fn(async (): Promise<ToolExecutionResult> => ({
    status: "succeeded",
    toolId: "test-tool",
    capabilityId: "lesson_plan",
    artifactDraft: {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "公开课教案",
      summary: "测试产物。",
      markdownContent: "# 公开课教案",
    },
    assistantSummary: "测试产物已生成。",
    budgetEvent: {
      capabilityId: "lesson_plan",
      actionKey: "test-tool:lesson_plan",
      status: "succeeded",
      kind: "tool_succeeded",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
  }));
}
