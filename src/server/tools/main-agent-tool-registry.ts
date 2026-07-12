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
