import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { routeToolCall } from "@/server/tools/tool-router";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ToolDefinition, ToolExecutionResult } from "@/server/tools/tool-types";
import type { ArtifactRecord } from "@/server/workbench/types";

const forbiddenSensitiveText = /token|providerMode|API|api[_-]?key|Bearer\s+\S+|C:\\|\\Users\\|local path|SECRET|credential/i;

const projectContext = {
  grade: "五年级",
  subject: "数学",
  topic: "百分数",
  requestedOutputs: ["需求规格"],
};

function fakeRuntime(): AgentRuntime {
  return {
    async run() {
      throw new Error("tool router tests should use injected executors");
    },
  };
}

function successResult(tool: ToolDefinition): Extract<ToolExecutionResult, { status: "succeeded" }> {
  return {
    status: "succeeded",
    toolId: tool.id,
    capabilityId: tool.capabilityId ?? "unknown",
    artifactDraft: {
      nodeKey: tool.producedArtifactKind ?? tool.id,
      kind: tool.producedArtifactKind ?? tool.id,
      title: "生成结果",
      summary: "已完成。",
      markdownContent: "# 已完成",
    },
    assistantSummary: "已完成。",
    budgetEvent: {
      capabilityId: tool.capabilityId ?? "unknown",
      actionKey: `${tool.id}:${tool.producedArtifactKind ?? ""}`,
      status: "succeeded",
      kind: "tool_succeeded",
      createdAt: new Date().toISOString(),
    },
  };
}

function providerSuccessResult(tool: ToolDefinition): ToolExecutionResult {
  return {
    ...successResult(tool),
    provider: tool.capabilityId,
    artifactTruth: {
      created: true,
      persisted: true,
      persistenceScope: "provider_local_file",
      providerPersisted: true,
      workbenchPersisted: false,
      placeholder: false,
      producedArtifactKind: tool.producedArtifactKind ?? tool.id,
    },
    qualityGate: {
      passed: true,
      gates: ["provider_output_valid"],
    },
  };
}

function resolvedArtifact(kind: ArtifactRecord["kind"], artifactId: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: artifactId,
    projectId: "project-a",
    nodeKey: kind,
    title: `${kind} 已确认产物`,
    kind,
    status: "approved",
    summary: `${kind} 已通过教师确认。`,
    markdownContent: `# ${kind}`,
    structuredContent: {},
    version: 7,
    isApproved: true,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

type FutureToolRouterInput = Parameters<typeof routeToolCall>[0] & {
  resolvedArtifacts?: ArtifactRecord[];
};

const routeFutureToolCall = routeToolCall as (
  input: FutureToolRouterInput,
  dependencies?: Parameters<typeof routeToolCall>[1],
) => ReturnType<typeof routeToolCall>;

function mcpToolDefinition(): ToolDefinition {
  return {
    ...getToolDefinition("create_requirement_spec"),
    id: "future_mcp_tool",
    adapterKind: "mcp",
    capabilityId: "requirement_spec",
    mcpServerId: "future-server",
    mcpToolName: "future.tool",
    implemented: true,
  };
}

describe("M64-D ToolRouter Core", () => {
  it("routes an internal capability tool to the injected internal executor with its tool definition", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeToolCall(
      {
        toolName: "create_requirement_spec",
        projectId: "project-a",
        userInstruction: "帮我整理百分数公开课需求",
        runtime: fakeRuntime(),
        projectContext,
        approvedArtifacts: [],
        sourceMessageId: "message-a",
      },
      { internalExecutor, providerExecutor },
    );

    expect(internalExecutor).toHaveBeenCalledTimes(1);
    expect(providerExecutor).not.toHaveBeenCalled();
    expect(internalExecutor.mock.calls[0][0]).toMatchObject({
      tool: {
        id: "create_requirement_spec",
        adapterKind: "internal_capability",
        capabilityId: "requirement_spec",
      },
      projectId: "project-a",
      userMessage: "帮我整理百分数公开课需求",
      projectContext,
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "create_requirement_spec",
      capabilityId: "requirement_spec",
    });
  });

  it("routes a provider tool with required artifactRefs to the injected provider executor", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => providerSuccessResult(tool));
    const pptDesignArtifact = resolvedArtifact("ppt_design_draft", "artifact-ppt-design-a");

    const result = await routeFutureToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        project: {
          id: "project-a",
          title: "真实项目上下文",
          status: "active",
          currentNodeKey: "ppt_design_draft",
          grade: "五年级",
          subject: "数学",
          textbookVersion: "人教版",
          lessonTopic: "百分数",
          lifecycleState: "active",
          lifecycleVersion: 0,
          archivedAt: null,
          deletedAt: null,
          createdAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        },
        userInstruction: "生成真实 PPTX",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
        resolvedArtifacts: [pptDesignArtifact],
        sourceMessageId: "message-a",
      },
      { internalExecutor, providerExecutor },
    );

    expect(providerExecutor).toHaveBeenCalledTimes(1);
    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor.mock.calls[0][0]).toMatchObject({
      tool: {
        id: "generate_pptx_from_design",
        adapterKind: "provider",
        capabilityId: "coze_ppt",
      },
      projectId: "project-a",
      project: expect.objectContaining({
        id: "project-a",
        grade: "五年级",
        subject: "数学",
        lessonTopic: "百分数",
      }),
      userInstruction: "生成真实 PPTX",
      artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
      resolvedArtifacts: [pptDesignArtifact],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
    });
  });

  it("routes image_asset by capability id to the injected provider executor", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => providerSuccessResult(tool));
    const pptDraftArtifact = resolvedArtifact("ppt_draft", "artifact-ppt-draft-a");

    const result = await routeFutureToolCall(
      {
        capabilityId: "image_asset",
        projectId: "project-a",
        userInstruction: "生成课堂导入图",
        artifactRefs: [{ kind: "ppt_draft", artifactId: "artifact-ppt-draft-a" }],
        resolvedArtifacts: [pptDraftArtifact],
      },
      { internalExecutor, providerExecutor },
    );

    expect(providerExecutor).toHaveBeenCalledTimes(1);
    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor.mock.calls[0][0]).toMatchObject({
      tool: {
        id: "generate_classroom_image",
        adapterKind: "provider",
        capabilityId: "image_asset",
      },
      projectId: "project-a",
      artifactRefs: [{ kind: "ppt_draft", artifactId: "artifact-ppt-draft-a" }],
      resolvedArtifacts: [pptDraftArtifact],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_classroom_image",
      capabilityId: "image_asset",
    });
  });

  it("routes video_segment_generate by capability id to the injected provider executor", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => providerSuccessResult(tool));
    const artifactRefs = [
      { kind: "video_segment_plan", artifactId: "artifact-video-plan-a" },
      { kind: "storyboard_generate", artifactId: "artifact-storyboard-a" },
      { kind: "asset_image_generate", artifactId: "artifact-assets-a" },
    ];
    const resolvedArtifacts = [
      resolvedArtifact("video_segment_plan", "artifact-video-plan-a"),
      resolvedArtifact("storyboard_generate", "artifact-storyboard-a"),
      resolvedArtifact("asset_image_generate", "artifact-assets-a"),
    ];

    const result = await routeFutureToolCall(
      {
        capabilityId: "video_segment_generate",
        projectId: "project-a",
        userInstruction: "生成真实分镜视频",
        toolInput: { shotIds: ["shot_02"] },
        artifactRefs,
        resolvedArtifacts,
      },
      { internalExecutor, providerExecutor },
    );

    expect(providerExecutor).toHaveBeenCalledTimes(1);
    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor.mock.calls[0][0]).toMatchObject({
      tool: {
        id: "generate_video_segment",
        adapterKind: "provider",
        capabilityId: "video_segment_generate",
      },
      projectId: "project-a",
      toolInput: { shotIds: ["shot_02"] },
      artifactRefs,
      resolvedArtifacts,
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_video_segment",
      capabilityId: "video_segment_generate",
    });
  });

  it("returns needs_input without invoking the provider executor when only artifactRefs are supplied", async () => {
    const providerExecutor = vi.fn(async ({ tool }) => providerSuccessResult(tool));

    const result = await routeFutureToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
      },
      { providerExecutor },
    );

    expect(providerExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: { kind: "blocked_by_policy", artifactCreated: false },
      budgetEvent: { status: "blocked", kind: "blocked_by_policy" },
    });
  });

  it.each([
    ["cross-project", [resolvedArtifact("ppt_design_draft", "artifact-ppt-design-a", { projectId: "project-b" })]],
    ["unapproved", [resolvedArtifact("ppt_design_draft", "artifact-ppt-design-a", { status: "needs_review", isApproved: false })]],
    ["kind mismatch", [resolvedArtifact("lesson_plan", "artifact-ppt-design-a")]],
    ["id mismatch", [resolvedArtifact("ppt_design_draft", "artifact-ppt-design-b")]],
  ])("blocks %s resolved artifacts before provider execution", async (_caseName, resolvedArtifacts) => {
    const providerExecutor = vi.fn(async ({ tool }) => providerSuccessResult(tool));

    const result = await routeFutureToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
        resolvedArtifacts,
      },
      { providerExecutor },
    );

    expect(providerExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: { kind: "blocked_by_policy", artifactCreated: false },
    });
  });

  it("converts provider success without artifact truth or quality gate evidence into quality_gate_failed", async () => {
    const providerExecutor = vi.fn(async ({ tool }) => ({
      ...successResult(tool),
      provider: "coze_ppt",
    }));

    const result = await routeFutureToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
        resolvedArtifacts: [resolvedArtifact("ppt_design_draft", "artifact-ppt-design-a")],
      },
      { providerExecutor },
    );

    expect(providerExecutor).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactCreated: false,
      errorCategory: "quality_gate_failed",
      observation: { kind: "quality_gate_failed", artifactCreated: false },
      budgetEvent: { status: "failed", kind: "quality_gate_failed" },
    });
  });

  it("blocks unimplemented tools without invoking any executor", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    for (const toolName of ["intro_video"]) {
      const result = await routeToolCall({ toolName, projectId: "project-a" }, { internalExecutor, providerExecutor });

      expect(result).toMatchObject({
        status: "failed",
        toolId: toolName,
        artifactCreated: false,
        observation: {
          kind: "blocked_by_policy",
          artifactCreated: false,
        },
        budgetEvent: {
          status: "blocked",
          kind: "blocked_by_policy",
        },
      });
    }

    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor).not.toHaveBeenCalled();
  });

  it("routes package tools only after resolved artifact validation", async () => {
    const packageExecutor = vi.fn(async ({ tool }) => ({
      ...successResult(tool),
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file" as const,
        providerPersisted: true,
        workbenchPersisted: false,
        placeholder: false,
        producedArtifactKind: tool.producedArtifactKind ?? tool.id,
      },
      qualityGate: { passed: true, gates: ["package_valid"] },
    }));

    const result = await routeFutureToolCall(
      {
        capabilityId: "concat_only_assemble",
        projectId: "project-a",
        artifactRefs: [{ kind: "video_segment_generate", artifactId: "segment-a" }],
        resolvedArtifacts: [resolvedArtifact("video_segment_generate", "segment-a")],
      },
      { packageExecutor },
    );

    expect(packageExecutor).toHaveBeenCalledTimes(1);
    expect(packageExecutor.mock.calls[0][0]).toMatchObject({
      tool: { id: "concat_only_assemble", adapterKind: "package", capabilityId: "concat_only_assemble" },
      projectId: "project-a",
      artifactRefs: [{ kind: "video_segment_generate", artifactId: "segment-a" }],
      resolvedArtifacts: [resolvedArtifact("video_segment_generate", "segment-a")],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "concat_only_assemble",
      capabilityId: "concat_only_assemble",
    });
  });

  it("does not let bare refs invoke package tools", async () => {
    const packageExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeFutureToolCall(
      {
        capabilityId: "concat_only_assemble",
        projectId: "project-a",
        artifactRefs: [{ kind: "video_segment_generate", artifactId: "segment-a" }],
      },
      { packageExecutor },
    );

    expect(packageExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "concat_only_assemble",
      capabilityId: "concat_only_assemble",
      missingInputs: ["video_segment_generate"],
      artifactCreated: false,
    });
  });

  it("returns needs_input when a required source artifact kind is missing and does not invoke provider executor", async () => {
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        artifactRefs: [{ kind: "lesson_plan", artifactId: "artifact-lesson-plan-a" }],
      },
      { providerExecutor },
    );

    expect(providerExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });

  it("passes structured page ids to the page repair package tool", async () => {
    const packageExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const artifacts = [
      resolvedArtifact("pptx_artifact", "deck-a"),
      resolvedArtifact("ppt_design_draft", "design-a"),
      resolvedArtifact("image_prompts", "assets-a"),
    ];

    await routeToolCall({
      capabilityId: "ppt_page_repair",
      projectId: "project-a",
      userInstruction: "请按审查意见局部返修。",
      toolInput: { pageIds: ["page_06", "page_02"] },
      artifactRefs: artifacts.map((artifact) => ({ kind: artifact.kind, artifactId: artifact.id })),
      resolvedArtifacts: artifacts,
    }, { packageExecutor });

    expect(packageExecutor).toHaveBeenCalledWith(expect.objectContaining({
      toolInput: { pageIds: ["page_06", "page_02"] },
    }));
  });

  it("does not let approvedArtifacts satisfy provider required artifactRefs", async () => {
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        userInstruction: "生成真实 PPTX",
        approvedArtifacts: [
          {
            nodeKey: "ppt_design_draft",
            title: "已确认 PPT 设计稿",
            summary: "设计稿已确认。",
            markdown: "# PPT 设计稿",
          },
        ],
      },
      { providerExecutor },
    );

    expect(providerExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });

  it("safely fails unknown toolName or capabilityId without leaking sensitive input details", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    for (const input of [
      { toolName: "unknown_token=secret_C:\\Users\\HB\\file", projectId: "project-a", userInstruction: "providerMode=openai API_KEY=secret" },
      { capabilityId: "unknown_capability", projectId: "project-a", userInstruction: "Bearer abc.def local path C:\\Users\\HB\\x" },
    ]) {
      const result = await routeToolCall(input, { internalExecutor, providerExecutor });

      expect(result).toMatchObject({
        status: "failed",
        toolId: "unknown_tool",
        capabilityId: "unknown",
        artifactCreated: false,
        observation: {
          kind: "blocked_by_policy",
          artifactCreated: false,
        },
      });
      if ("observation" in result) {
        expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
        expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
      }
    }

    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor).not.toHaveBeenCalled();
  });

  it("blocks future MCP tools as unsupported without invoking executors", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeToolCall(
      { toolName: "future_mcp_tool", projectId: "project-a" },
      {
        internalExecutor,
        providerExecutor,
        resolveToolDefinition: () => mcpToolDefinition(),
      },
    );

    expect(internalExecutor).not.toHaveBeenCalled();
    expect(providerExecutor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed",
      toolId: "future_mcp_tool",
      capabilityId: "requirement_spec",
      artifactCreated: false,
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });
});
