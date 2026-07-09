import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { executeInternalCapabilityTool } from "@/server/tools/internal-capability-tool-adapter";
import { getToolDefinition } from "@/server/tools/tool-registry";

const projectContext = {
  grade: "五年级",
  subject: "数学",
  topic: "百分数",
  requestedOutputs: ["需求规格"],
};

function fakeRuntime(): AgentRuntime {
  return {
    async run() {
      throw new Error("adapter test should use injected capability runner");
    },
  };
}

describe("M64-B InternalCapabilityToolAdapter", () => {
  it("delegates an internal tool to the capability runner and returns an artifact draft without saving it", async () => {
    const tool = getToolDefinition("create_requirement_spec");
    let runtimeCalledWith: unknown;
    const runtime: AgentRuntime = {
      async run(input) {
        runtimeCalledWith = input;
        return {
          status: "succeeded",
          run: {
            runId: input.runId,
            projectId: input.projectId,
            task: input.task,
            runtimeKind: "deterministic",
            status: "succeeded",
          },
          assistantMessage: {
            title: "需求规格已生成",
            body: "已生成一版可确认的需求规格。",
          },
          artifactDraft: {
            nodeKey: "requirement_spec",
            kind: "requirement_spec",
            title: "需求规格",
            summary: "已整理需求",
            markdown: "# 需求规格",
            contentType: "text/markdown",
            generationMode: "deterministic_draft",
            isReadyForTeacherReview: true,
          },
          nextSuggestedAction: {
            type: "review_artifact",
            label: "查看并确认这份需求规格",
          },
        };
      },
    };

    const result = await executeInternalCapabilityTool({
      tool,
      runtime,
      projectId: "project-a",
      userMessage: "帮我整理一份百分数公开课需求",
      projectContext,
      approvedArtifacts: [],
      sourceMessageId: "message-a",
    });

    expect(runtimeCalledWith).toMatchObject({
      projectId: "project-a",
      task: "requirement_spec",
      userMessage: "帮我整理一份百分数公开课需求",
      projectContext,
      approvedArtifacts: [],
    });
    expect(runtimeCalledWith).toMatchObject({
      runId: expect.any(String),
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "create_requirement_spec",
      capabilityId: "requirement_spec",
      artifactDraft: {
        nodeKey: "requirement_spec",
        kind: "requirement_spec",
        title: "需求规格",
        summary: "已整理需求",
        markdownContent: "# 需求规格",
      },
      assistantSummary: "需求规格已生成\n\n已生成一版可确认的需求规格。",
      budgetEvent: {
        capabilityId: "requirement_spec",
        status: "succeeded",
        kind: "tool_succeeded",
      },
    });
    expect("artifactCreated" in result).toBe(false);
    expect("observation" in result).toBe(false);
  });

  it("returns a failed observation and budget event when the runtime/provider path fails", async () => {
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_requirement_spec"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "帮我整理需求",
        projectContext,
      },
      {
        runCapability: async () => ({
          status: "failed",
          userMessage: "这一步暂时没有完成，可以稍后重试。",
          retryable: true,
          errorCategory: "provider",
        }),
      },
    );

    expect(result).toMatchObject({
      toolId: "create_requirement_spec",
      capabilityId: "requirement_spec",
      status: "retryable_failed",
      artifactCreated: false,
      observation: {
        kind: "tool_failed",
        artifactCreated: false,
      },
      budgetEvent: {
        capabilityId: "requirement_spec",
        status: "retryable_failed",
        kind: "tool_failed",
      },
    });
  });

  it("maps validation failures to a quality gate observation", async () => {
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_ppt_design_draft"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "生成 PPT 设计稿",
        projectContext,
        approvedArtifacts: [
          {
            nodeKey: "ppt_draft",
            title: "PPT 大纲",
            summary: "已确认",
            markdown: "# PPT 大纲",
          },
        ],
      },
      {
        runCapability: async () => ({
          status: "failed",
          userMessage: "PPT 设计稿必须逐页写清底图、元素、文字和教学动作。",
          retryable: true,
          errorCategory: "validation",
        }),
      },
    );

    expect(result).toMatchObject({
      status: "retryable_failed",
      toolId: "create_ppt_design_draft",
      capabilityId: "ppt_design",
      artifactCreated: false,
      observation: {
        kind: "quality_gate_failed",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "retryable_failed",
        kind: "quality_gate_failed",
      },
    });
  });

  it("can surface needs_input results through dependency injection without changing the production runner", async () => {
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_lesson_plan"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "生成教案",
        projectContext,
      },
      {
        runCapability: async () => ({
          status: "needs_input",
          missingInputs: ["requirement_spec"],
          assistantPrompt: "请先确认备课需求。",
        }),
      },
    );

    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "create_lesson_plan",
      capabilityId: "lesson_plan",
      missingInputs: ["requirement_spec"],
      assistantPrompt: "请先确认备课需求。",
      artifactCreated: false,
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
        retryPolicy: {
          retryable: false,
          nextAction: "ask_teacher",
        },
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });

  it("maps permission failures to a non-retryable policy block observation", async () => {
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_lesson_plan"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "生成教案",
        projectContext,
      },
      {
        runCapability: async () => ({
          status: "failed",
          userMessage: "需要教师先确认前置材料后才能继续。",
          retryable: true,
          errorCategory: "permission",
        }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      toolId: "create_lesson_plan",
      capabilityId: "lesson_plan",
      artifactCreated: false,
      errorCategory: "blocked_by_policy",
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
        retryPolicy: {
          retryable: false,
          nextAction: "ask_teacher",
        },
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });
});
