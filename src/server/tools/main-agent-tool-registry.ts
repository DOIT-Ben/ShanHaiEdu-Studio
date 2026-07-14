import {
  getAgentToolDefinition,
  getAgentToolDefinitionByTransportName,
  listAgentToolDefinitions,
} from "./agent-tool-registry";
import type { AgentToolDefinition } from "./agent-tool-types";
import { getToolDefinition } from "./tool-registry";
import type { ToolDefinition } from "./tool-types";

type MainAgentBusinessToolDefinition = ToolDefinition & {
  transportName: string;
  internalToolId: string;
  modelVisible: true;
  mainAgentExecutable: true;
};

type MainAgentAgentToolDefinition = AgentToolDefinition & {
  internalToolId?: undefined;
};

export type MainAgentToolDefinition = MainAgentAgentToolDefinition | MainAgentBusinessToolDefinition;

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
  { id: "assemble_ppt_full_deck", internalToolId: "assemble_ppt_full_deck" },
  { id: "repair_ppt_full_deck_pages", internalToolId: "repair_ppt_full_deck_pages" },
  { id: "generate_video_assets", internalToolId: "asset_image_generate" },
  { id: "generate_video_shot", internalToolId: "generate_video_segment" },
  { id: "assemble_video", internalToolId: "concat_only_assemble" },
  { id: "create_final_package", internalToolId: "create_final_package" },
] as const;

export function listMainAgentToolDefinitions(): MainAgentToolDefinition[] {
  return [
    ...listAgentToolDefinitions().map(asMainAgentAgentTool),
    ...businessToolAliases.map(createBusinessToolAlias),
  ].map(cloneMainAgentToolDefinition);
}

export function listMainAgentExecutableToolDefinitions(): MainAgentToolDefinition[] {
  return listMainAgentToolDefinitions().filter((tool) => tool.mainAgentExecutable);
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
    }
  }

  throw new Error(`Tool is not visible to Main Agent: ${idOrTransportName}`);
}

function asMainAgentAgentTool(tool: AgentToolDefinition): MainAgentAgentToolDefinition {
  return { ...tool, internalToolId: undefined };
}

function createBusinessToolAlias(alias: typeof businessToolAliases[number]): MainAgentBusinessToolDefinition {
  const internal = getToolDefinition(alias.internalToolId);
  if (!internal.implemented || internal.blockedReason) {
    throw new Error(`Main Agent business tool is unavailable: ${alias.id}`);
  }

  return {
    ...internal,
    ...(alias.id === "create_ppt_design_draft" ? {
      description: "基于当前TaskBrief和可信上游生成逐页PPT设计候选；可复用本轮PPT Director结果，但Director不是必经步骤。候选必须来自真实模型、绑定证据并通过最低结构校验。",
      inputSchema: {
        type: "object" as const,
        additionalProperties: false as const,
        properties: {},
        required: [],
      },
    } : {}),
    id: alias.id,
    transportName: alias.id,
    internalToolId: alias.internalToolId,
    modelVisible: true,
    mainAgentExecutable: true,
  };
}

function cloneMainAgentToolDefinition(definition: MainAgentToolDefinition): MainAgentToolDefinition {
  return structuredClone(definition);
}
