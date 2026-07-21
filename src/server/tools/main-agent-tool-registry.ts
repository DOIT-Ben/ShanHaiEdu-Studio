import {
  getAgentToolDefinition,
  getAgentToolDefinitionByTransportName,
  listAgentToolDefinitions,
} from "./agent-tool-registry";
import { resolveBusinessToolSemanticBinding } from "@/server/skills/business-tool-skill-bindings";
import type { AgentToolDefinition } from "./agent-tool-types";
import { getToolDefinition } from "./tool-registry";
import type { ToolDefinition } from "./tool-types";

type MainAgentBusinessToolDefinition = ToolDefinition & {
  transportName: string;
  internalToolId: string;
  modelVisible: true;
  mainAgentExecutable: true;
  businessSkillName?: string;
  businessSkillBindingMode?: "skill" | "guidance";
};

type MainAgentAgentToolDefinition = AgentToolDefinition & {
  internalToolId?: undefined;
};

export type MainAgentControlToolDefinition = ToolDefinition & {
  transportName: "request_teacher_decision";
  internalToolId?: undefined;
  controlKind: "dialogue_checkpoint";
  modelVisible: true;
  mainAgentExecutable: true;
};

export type MainAgentToolDefinition = MainAgentAgentToolDefinition | MainAgentControlToolDefinition | MainAgentBusinessToolDefinition;

const dialogueCheckpointTool: MainAgentControlToolDefinition = {
  id: "request_teacher_decision",
  transportName: "request_teacher_decision",
  controlKind: "dialogue_checkpoint",
  label: "请教师判断方向",
  description: "当多个合理理解会实质改变结果，并且当前任务、对话和可信成果仍无法消除边界时，请教师判断方向。不得用于例行确认、固定节点审批、授权、预算或副作用门禁。",
  adapterKind: "internal_capability",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      question: { type: "string", minLength: 1 },
      understandingSummary: { type: "string", minLength: 1 },
      impactSummary: { type: "string", minLength: 1 },
      options: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1 },
            description: { type: "string", minLength: 1 },
            recommended: { type: "boolean" },
          },
          required: ["id", "label", "description", "recommended"],
        },
      },
      allowFreeText: { type: "boolean" },
    },
    required: ["question", "understandingSummary", "impactSummary", "options", "allowFreeText"],
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      checkpointId: { type: "string" },
      status: { type: "string", enum: ["pending"] },
    },
    required: ["checkpointId", "status"],
  },
  requiresHumanGate: false,
  sideEffectLevel: "none",
  requiredArtifactKinds: [],
  failurePolicy: { retryable: false, maxRetries: 0, onFailure: "record_observation" },
  implemented: true,
  modelVisible: true,
  mainAgentExecutable: true,
};

const businessToolAliases = [
  { id: "create_requirement_spec", internalToolId: "create_requirement_spec" },
  { id: "create_lesson_plan", internalToolId: "create_lesson_plan" },
  { id: "create_ppt_outline", internalToolId: "create_ppt_outline" },
  { id: "create_video_course_anchor", internalToolId: "extract_knowledge_anchors" },
  { id: "generate_intro_creative_themes", internalToolId: "generate_intro_creative_themes" },
  { id: "generate_intro_video_script", internalToolId: "generate_intro_video_script" },
  { id: "generate_video_storyboard", internalToolId: "generate_video_storyboard" },
  { id: "generate_video_asset_brief", internalToolId: "generate_video_asset_brief" },
  { id: "plan_video_segments", internalToolId: "plan_video_segments" },
  { id: "create_ppt_design_draft", internalToolId: "create_ppt_design_draft" },
  { id: "generate_ppt_sample_assets", internalToolId: "generate_ppt_sample_assets" },
  { id: "assemble_ppt_key_samples", internalToolId: "assemble_ppt_key_samples" },
  { id: "generate_ppt_full_assets", internalToolId: "generate_ppt_full_assets" },
  { id: "generate_ppt_page_images", internalToolId: "generate_ppt_page_images" },
  { id: "assemble_ppt_full_deck", internalToolId: "assemble_ppt_full_deck" },
  { id: "assemble_ppt_image_slides", internalToolId: "assemble_ppt_image_slides" },
  { id: "repair_ppt_full_deck_pages", internalToolId: "repair_ppt_full_deck_pages" },
  { id: "generate_classroom_image", internalToolId: "generate_classroom_image" },
  { id: "generate_video_assets", internalToolId: "asset_image_generate" },
  { id: "generate_video_narration", internalToolId: "generate_video_narration" },
  { id: "generate_video_shot", internalToolId: "generate_video_segment" },
  { id: "assemble_video", internalToolId: "concat_only_assemble" },
  { id: "create_final_package", internalToolId: "create_final_package" },
] as const;

export function listMainAgentToolDefinitions(): MainAgentToolDefinition[] {
  return [
    ...listAgentToolDefinitions().map(asMainAgentAgentTool),
    dialogueCheckpointTool,
    ...businessToolAliases.map(createBusinessToolAlias),
  ].map(cloneMainAgentToolDefinition);
}

export function listMainAgentExecutableToolDefinitions(): MainAgentToolDefinition[] {
  return listMainAgentToolDefinitions().filter((tool) => tool.mainAgentExecutable);
}

export function listMainAgentBusinessToolNames(): string[] {
  return businessToolAliases.map((tool) => tool.id);
}

export function resolveMainAgentToolDefinition(idOrTransportName: string): MainAgentToolDefinition {
  try {
    return asMainAgentAgentTool(getAgentToolDefinition(idOrTransportName));
  } catch {
    try {
      return asMainAgentAgentTool(getAgentToolDefinitionByTransportName(idOrTransportName));
    } catch {
      const alias = businessToolAliases.find((entry) => entry.id === idOrTransportName);
      if (alias) return createBusinessToolAlias(alias);
      if (idOrTransportName === dialogueCheckpointTool.id) return structuredClone(dialogueCheckpointTool);
    }
  }

  throw new Error(`Tool is not visible to Main Agent: ${idOrTransportName}`);
}

function asMainAgentAgentTool(tool: AgentToolDefinition): MainAgentAgentToolDefinition {
  return { ...tool, internalToolId: undefined };
}

function createBusinessToolAlias(alias: typeof businessToolAliases[number]): MainAgentBusinessToolDefinition {
  const internal = getToolDefinition(alias.internalToolId);
  const businessSkillBinding = resolveBusinessToolSemanticBinding(alias.id);
  if (!internal.implemented || internal.blockedReason) {
    throw new Error(`Main Agent business tool is unavailable: ${alias.id}`);
  }

  return {
    ...internal,
    ...(alias.id === "create_ppt_design_draft" ? {
      description: "基于当前TaskBrief和可信上游生成逐页PPT设计候选；可复用本轮PPT Director结果，但Director不是必经步骤。首次调用传空repairIssues；校验失败后读取Observation.reasonCodes，把需要修复的具体字段传入repairIssues。候选必须来自真实模型、绑定证据并通过最低结构校验。",
      teacherDescription: "根据当前任务说明和已保存成果形成逐页 PPT 设计候选；若结构检查发现具体问题，只修正受影响内容。",
      inputSchema: {
        type: "object" as const,
        additionalProperties: false as const,
        properties: {
          repairIssues: {
            type: "array" as const,
            maxItems: 12,
            uniqueItems: true,
            items: { type: "string" as const },
          },
        },
        required: ["repairIssues"],
      },
    } : {}),
    id: alias.id,
    transportName: alias.id,
    internalToolId: alias.internalToolId,
    modelVisible: true,
    mainAgentExecutable: true,
    ...(businessSkillBinding ? {
      businessSkillName: businessSkillBinding.skillName,
      businessSkillBindingMode: businessSkillBinding.bindingMode,
    } : {}),
  };
}

export function isMainAgentControlToolDefinition(tool: MainAgentToolDefinition): tool is MainAgentControlToolDefinition {
  return "controlKind" in tool && tool.controlKind === "dialogue_checkpoint";
}

function cloneMainAgentToolDefinition(definition: MainAgentToolDefinition): MainAgentToolDefinition {
  return structuredClone(definition);
}
