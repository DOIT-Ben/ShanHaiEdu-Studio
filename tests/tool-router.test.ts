import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { routeToolCall } from "@/server/tools/tool-router";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ToolDefinition, ToolExecutionResult } from "@/server/tools/tool-types";

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

function successResult(tool: ToolDefinition): ToolExecutionResult {
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
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    const result = await routeToolCall(
      {
        toolName: "generate_pptx_from_design",
        projectId: "project-a",
        userInstruction: "生成真实 PPTX",
        artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
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
      userInstruction: "生成真实 PPTX",
      artifactRefs: [{ kind: "ppt_design_draft", artifactId: "artifact-ppt-design-a" }],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
    });
  });

  it("blocks unimplemented tools without invoking any executor", async () => {
    const internalExecutor = vi.fn(async ({ tool }) => successResult(tool));
    const providerExecutor = vi.fn(async ({ tool }) => successResult(tool));

    for (const toolName of ["intro_video", "asset_image_generate", "concat_only_assemble"]) {
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
