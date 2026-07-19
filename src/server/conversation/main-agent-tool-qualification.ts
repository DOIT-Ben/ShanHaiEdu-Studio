import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import {
  isMainAgentControlToolDefinition,
  listMainAgentToolDefinitions,
} from "@/server/tools/main-agent-tool-registry";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { CreateMainAgentToolLoopOptionsInput } from "./main-agent-tool-loop-types";
import type { TaskBrief, TaskRequestedOutput } from "./task-contract";
import { isCapabilityInTaskScope } from "./task-output-scope";

const nonRepeatableFrontStageToolIds = new Set([
  "create_lesson_plan",
  "create_ppt_outline",
  "create_video_course_anchor",
  "generate_intro_creative_themes",
  "generate_intro_video_script",
  "generate_video_storyboard",
  "generate_video_asset_brief",
  "plan_video_segments",
  "create_ppt_design_draft",
  "generate_video_narration",
]);

export function createMainAgentToolQualification(input: CreateMainAgentToolLoopOptionsInput) {
  const taskArtifacts = () => input.taskBrief
    ? input.artifacts.filter((artifact) => isArtifactBoundToTask(artifact, input.taskBrief!))
    : input.artifacts;
  const qualifiedDefinitions = () => {
    const currentArtifacts = taskArtifacts();
    const trustedKinds = new Set(currentArtifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.kind));
    const presentKinds = new Set(currentArtifacts.map((artifact) => artifact.kind));
    return listMainAgentToolDefinitions().filter((tool) =>
      (tool.adapterKind !== "agent" || Boolean(input.executor)) && tool.mainAgentExecutable &&
      isCurrentlyQualifiedMainAgentTool(tool, trustedKinds, presentKinds, input.taskBrief) &&
      (tool.internalToolId !== "create_ppt_design_draft" || Boolean(input.runtime)));
  };
  return { taskArtifacts, qualifiedDefinitions };
}

function isCurrentlyQualifiedMainAgentTool(
  tool: ReturnType<typeof listMainAgentToolDefinitions>[number],
  trustedKinds: Set<ArtifactRecord["kind"]>,
  presentKinds: Set<ArtifactRecord["kind"]>,
  taskBrief?: TaskBrief,
) {
  if (isMainAgentControlToolDefinition(tool)) return Boolean(taskBrief);
  if (typeof tool.internalToolId === "string") {
    if (!isCapabilityInTaskScope(tool.capabilityId ?? "", taskBrief)) return false;
    if (tool.internalToolId === "create_requirement_spec") {
      return Boolean(taskBrief?.requestedOutputs.length) && !trustedKinds.has("requirement_spec");
    }
    if (nonRepeatableFrontStageToolIds.has(tool.id) && typeof tool.producedArtifactKind === "string" &&
        trustedKinds.has(tool.producedArtifactKind as ArtifactRecord["kind"])) return false;
    return tool.requiredArtifactKinds.every((kind) => trustedKinds.has(kind as ArtifactRecord["kind"]));
  }
  if (tool.id === "ppt_director.plan_or_repair") {
    return taskBriefAllowsAny(taskBrief, pptDesignAndDeliveryOutputs) &&
      (trustedKinds.has("ppt_draft") || trustedKinds.has("ppt_design_draft") || trustedKinds.has("pptx_artifact"));
  }
  if (tool.id === "video_director.plan_or_repair") {
    return taskBriefAllowsAny(taskBrief, videoProductionOutputs) && [
      "creative_theme_generate", "video_script_generate", "storyboard_generate", "video_segment_plan",
      "video_segment_generate", "concat_only_assemble",
    ].some((kind) => trustedKinds.has(kind as ArtifactRecord["kind"]));
  }
  if (tool.id === "delivery_critic.review") {
    return taskBriefAllowsAny(taskBrief, reviewableOutputs) && [
      "ppt_design_draft", "image_prompts", "pptx_artifact", "creative_theme_generate",
      "video_script_generate", "storyboard_generate", "video_segment_generate", "concat_only_assemble",
      "final_delivery",
    ].some((kind) => presentKinds.has(kind as ArtifactRecord["kind"]));
  }
  return false;
}

const pptDesignAndDeliveryOutputs: readonly TaskRequestedOutput[] = [
  "ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt_full_assets", "ppt", "package",
];
const videoProductionOutputs: readonly TaskRequestedOutput[] = [
  "storyboard", "asset_brief", "video_assets", "video_segment_plan", "video_narration", "video_shot", "video", "package",
];
const reviewableOutputs: readonly TaskRequestedOutput[] = [
  ...pptDesignAndDeliveryOutputs, ...videoProductionOutputs, "image",
];

function taskBriefAllowsAny(taskBrief: TaskBrief | undefined, outputs: readonly TaskRequestedOutput[]) {
  return Boolean(taskBrief && outputs.some((output) =>
    taskBrief.requestedOutputs.includes(output) && !taskBrief.excludedOutputs.includes(output)));
}
