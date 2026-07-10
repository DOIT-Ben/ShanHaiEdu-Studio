import type { AgentRuntime, AgentRuntimeInput, AgentRuntimeTask } from "./types";
import type { OpenAIRuntimeNativeToolLoopOptions } from "./openai-runtime";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import { routeToolCall, type ToolRouterInput } from "@/server/tools/tool-router";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ToolDefinition, ToolExecutionResult } from "@/server/tools/tool-types";

export const nativeToolLoopTaskToolMap: Partial<Record<AgentRuntimeTask, string>> = {
  requirement_spec: "create_requirement_spec",
  lesson_plan: "create_lesson_plan",
  ppt_outline: "create_ppt_outline",
  ppt_design: "create_ppt_design_draft",
  knowledge_anchor_extract: "extract_knowledge_anchors",
  creative_theme_generate: "generate_intro_creative_themes",
  video_script_generate: "generate_intro_video_script",
  storyboard_generate: "generate_video_storyboard",
  asset_brief_generate: "generate_video_asset_brief",
  video_segment_plan: "plan_video_segments",
  final_delivery_checklist: "create_final_delivery_checklist",
};

export type NativeToolLoopConfigDependencies = {
  toolExecutionRuntime: AgentRuntime;
  toolRouter?: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  maxToolRounds?: number;
};

export function createOpenAIRuntimeNativeToolLoopOptions(
  input: AgentRuntimeInput,
  dependencies: NativeToolLoopConfigDependencies,
): OpenAIRuntimeNativeToolLoopOptions | undefined {
  const toolId = nativeToolLoopTaskToolMap[input.task];
  if (!toolId) {
    return undefined;
  }

  const tool = getToolDefinition(toolId);
  if (tool.adapterKind !== "internal_capability" || !tool.implemented || tool.blockedReason) {
    return undefined;
  }

  return {
    tools: [toOpenAIFunctionTool(tool)],
    allowedToolNames: [tool.id],
    toolRouter: dependencies.toolRouter ?? routeToolCall,
    buildToolRouterInput: (intent, runtimeInput) => buildToolRouterInput(intent, runtimeInput, dependencies.toolExecutionRuntime),
    maxToolRounds: dependencies.maxToolRounds ?? 1,
  };
}

function toOpenAIFunctionTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: tool.id,
    description: tool.description,
    parameters: teacherIntentInputSchema,
    strict: true,
  };
}

const teacherIntentInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    userInstruction: { type: ["string", "null"] },
    teacherIntent: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: ["userInstruction", "teacherIntent", "notes"],
} as const;

function buildToolRouterInput(
  intent: ToolCallIntent,
  input: AgentRuntimeInput,
  toolExecutionRuntime: AgentRuntime,
): ToolRouterInput {
  return {
    toolName: intent.toolName,
    projectId: input.projectId,
    userInstruction: resolveTeacherInstruction(intent) ?? input.userMessage,
    runtime: toolExecutionRuntime,
    projectContext: input.projectContext,
    approvedArtifacts: input.approvedArtifacts,
    sourceMessageId: input.sourceMessageId,
  };
}

function resolveTeacherInstruction(intent: ToolCallIntent): string | undefined {
  return intent.teacherIntent?.userInstruction ?? intent.teacherIntent?.teacherIntent ?? intent.teacherIntent?.notes;
}
