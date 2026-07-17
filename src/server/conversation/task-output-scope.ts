import type { CapabilityId } from "@/server/capabilities/types";

import type { TaskBrief, TaskRequestedOutput } from "./task-contract";

type CapabilityScopePolicy = {
  targetOutputs: readonly TaskRequestedOutput[];
  directOutput?: TaskRequestedOutput;
  packageDomain?: TaskRequestedOutput;
};

const pptOutlineAndDeliveryOutputs: readonly TaskRequestedOutput[] = [
  "ppt_outline", "ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt_full_assets", "ppt", "package",
];
const pptDesignAndDeliveryOutputs: readonly TaskRequestedOutput[] = [
  "ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt_full_assets", "ppt", "package",
];
const videoScriptAndDeliveryOutputs: readonly TaskRequestedOutput[] = [
  "video_script", "storyboard", "asset_brief", "video_assets", "video_segment_plan", "video_narration", "video_shot", "video", "package",
];

const capabilityScopePolicies: Partial<Record<CapabilityId, CapabilityScopePolicy>> = {
  requirement_spec: policy(["requirement_spec", "package"], "requirement_spec", "requirement_spec"),
  lesson_plan: policy(["lesson_plan", "package"], "lesson_plan", "lesson_plan"),
  ppt_outline: policy(pptOutlineAndDeliveryOutputs, "ppt_outline", "ppt"),
  ppt_design: policy(pptDesignAndDeliveryOutputs, "ppt_design", "ppt"),
  coze_ppt: policy(["ppt", "package"], "ppt", "ppt"),
  ppt_sample_assets: policy(["ppt_sample_assets", "ppt_key_samples", "ppt_full_assets", "ppt", "package"], "ppt_sample_assets", "ppt"),
  ppt_key_samples: policy(["ppt_key_samples", "ppt_full_assets", "ppt", "package"], "ppt_key_samples", "ppt"),
  ppt_full_assets: policy(["ppt_full_assets", "ppt", "package"], "ppt_full_assets", "ppt"),
  ppt_full_deck: policy(["ppt", "package"], "ppt", "ppt"),
  ppt_page_repair: policy(["ppt"], "ppt"),
  image_asset: policy(["image", "package"], "image", "image"),
  knowledge_anchor_extract: policy(["knowledge_anchor", ...videoScriptAndDeliveryOutputs], "knowledge_anchor", "video"),
  creative_theme_generate: policy(["creative_theme", ...videoScriptAndDeliveryOutputs], "creative_theme", "video"),
  video_script_generate: policy(videoScriptAndDeliveryOutputs, "video_script", "video"),
  storyboard_generate: policy(["storyboard", "asset_brief", "video_assets", "video_segment_plan", "video_shot", "video", "package"], "storyboard", "video"),
  asset_brief_generate: policy(["asset_brief", "video_assets", "video_segment_plan", "video_shot", "video", "package"], "asset_brief", "video"),
  asset_image_generate: policy(["video_assets", "video_segment_plan", "video_shot", "video", "package"], "video_assets", "video"),
  video_segment_plan: policy(["video_segment_plan", "video_shot", "video", "package"], "video_segment_plan", "video"),
  video_narration_generate: policy(["video_narration", "video", "package"], "video_narration", "video"),
  video_segment_generate: policy(["video_shot", "video", "package"], "video_shot", "video"),
  concat_only_assemble: policy(["video", "package"], "video", "video"),
  final_package: policy(["package"], "package"),
};

const exclusionFamilies: Partial<Record<TaskRequestedOutput, readonly CapabilityId[]>> = {
  image: ["image_asset", "ppt_sample_assets", "ppt_full_assets", "asset_image_generate"],
  package: ["final_package"],
};

export function isCapabilityInTaskScope(capabilityId: string, taskBrief?: TaskBrief): boolean {
  if (!taskBrief) return false;
  const scope = capabilityScopePolicies[capabilityId as CapabilityId];
  if (!scope) return false;
  if (taskBrief.excludedOutputs.some((output) => exclusionFamilies[output]?.includes(capabilityId as CapabilityId))) return false;
  if (scope.directOutput && taskBrief.excludedOutputs.includes(scope.directOutput)) return false;
  if (scope.targetOutputs.some((output) => output !== "package" && taskBrief.requestedOutputs.includes(output))) return true;
  if (!scope.targetOutputs.includes("package") || !taskBrief.requestedOutputs.includes("package")) return false;
  return !scope.packageDomain || !taskBrief.excludedOutputs.includes(scope.packageDomain);
}

function policy(
  targetOutputs: readonly TaskRequestedOutput[],
  directOutput?: TaskRequestedOutput,
  packageDomain?: TaskRequestedOutput,
): CapabilityScopePolicy {
  return { targetOutputs, directOutput, packageDomain };
}
