import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { executeInternalCapabilityTool } from "@/server/tools/internal-capability-tool-adapter";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { createTaskBrief } from "@/server/conversation/task-contract";
import { validPptDirectorOutput } from "./support/ppt-director-output-fixture";
import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";

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
    const fixtureRuntime = new FixtureAgentRuntime();
    const runtime: AgentRuntime = {
      async run(input) {
        runtimeCalledWith = input;
        return fixtureRuntime.run(input);
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
      taskInput: {
        teacherGoal: "五年级数学百分数公开课，约 10 页",
        targetPageCount: 10,
      },
    });

    expect(runtimeCalledWith).toMatchObject({
      projectId: "project-a",
      task: "requirement_spec",
      userMessage: "帮我整理一份百分数公开课需求",
      projectContext,
      approvedArtifacts: [],
      sourceMessageId: "message-a",
      taskInput: {
        teacherGoal: "五年级数学百分数公开课，约 10 页",
        targetPageCount: 10,
      },
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
        title: "需求规格说明书",
        structuredContent: {
          capabilityId: "requirement_spec",
          generationMode: "model_generated",
          providerStatus: "real",
          runtimeKind: "openai",
        },
      },
      assistantSummary: expect.stringContaining("需求规格说明书已生成"),
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
          reasonCode: "ppt_design_candidate_semantics_invalid",
        }),
      },
    );

    expect(result).toMatchObject({
      status: "retryable_failed",
      toolId: "create_ppt_design_draft",
      capabilityId: "ppt_design",
      artifactCreated: false,
      reasonCode: "ppt_design_candidate_semantics_invalid",
      observation: {
        kind: "quality_gate_failed",
        reasonCode: "ppt_design_candidate_semantics_invalid",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "retryable_failed",
        kind: "quality_gate_failed",
      },
    });
  });

  it("reuses a current server-bound Director result when the Main Agent selected that path", async () => {
    let runtimeCalls = 0;
    const result = await executeInternalCapabilityTool({
      tool: getToolDefinition("create_ppt_design_draft"),
      runtime: {
        async run() {
          runtimeCalls += 1;
          throw new Error("generic ppt_design runtime must not run");
        },
      },
      projectId: "project-a",
      userMessage: "生成 PPT 设计稿",
      projectContext,
      pptDirectorPlan: {
        invocationId: "ppt-director-bound-1",
        projectId: "project-a",
        intentEpoch: 2,
        structuredOutput: validPptDirectorOutput(),
        approvedArtifactRefs: [{ artifactId: "artifact_textbook_evidence", kind: "textbook_evidence", version: 1, digest: "a".repeat(64) }],
      },
      intentEpoch: 2,
    });

    expect(runtimeCalls).toBe(0);
    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        structuredContent: { directorInvocationId: "ppt-director-bound-1" },
      },
    });
  });

  it("runs the real ppt_design capability when no Director result was selected", async () => {
    let runCapabilityCalls = 0;
    const result = await executeInternalCapabilityTool({
      tool: getToolDefinition("create_ppt_design_draft"),
      runtime: fakeRuntime(),
      projectId: "project-a",
      userMessage: "生成 PPT 设计稿",
      projectContext,
    }, {
      runCapability: async () => {
        runCapabilityCalls += 1;
        return {
          status: "succeeded",
          artifactDraft: {
            nodeKey: "ppt_design_draft",
            kind: "ppt_design_draft",
            title: "百分数逐页设计",
            summary: "真实模型逐页设计候选",
            markdownContent: "# 逐页设计",
            structuredContent: { providerStatus: "real", generationMode: "model_generated" },
          },
          assistantSummary: "已形成可信逐页设计候选。",
          providerStatus: "real",
        };
      },
    });

    expect(runCapabilityCalls).toBe(1);
    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        kind: "ppt_design_draft",
        structuredContent: { providerStatus: "real", generationMode: "model_generated" },
      },
    });
  });

  it("fails closed before the capability runner when a direct semantic Tool has no valid TaskBrief input", async () => {
    let runCapabilityCalls = 0;
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_lesson_plan"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "生成教案",
        projectContext,
      },
      {
        runCapability: async () => {
          runCapabilityCalls += 1;
          throw new Error("runner must not receive a direct Tool without TaskBrief");
        },
      },
    );

    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "create_lesson_plan",
      capabilityId: "lesson_plan",
      missingInputs: ["task_brief"],
      artifactCreated: false,
      observation: {
        kind: "quality_gate_failed",
        artifactCreated: false,
        retryPolicy: {
          retryable: false,
          nextAction: "fix_inputs",
        },
      },
      budgetEvent: {
        status: "failed",
        kind: "quality_gate_failed",
      },
    });
    expect(runCapabilityCalls).toBe(0);
  });

  it("maps permission failures to a non-retryable policy block observation", async () => {
    const taskBrief = createTaskBrief({
      taskId: "task-permission", projectId: "project-a", intentEpoch: 0,
      goal: "生成教案", requestedOutputs: ["lesson_plan"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: "message-permission",
    });
    const result = await executeInternalCapabilityTool(
      {
        tool: getToolDefinition("create_lesson_plan"),
        runtime: fakeRuntime(),
        projectId: "project-a",
        userMessage: "生成教案",
        taskInput: { taskBrief },
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
