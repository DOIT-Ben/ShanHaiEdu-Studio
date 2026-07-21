import type { CapabilityDefinition, CapabilityId } from "./types";
import type { ArtifactRecord } from "../workbench/types";
import { isArtifactTrustedForDownstream } from "../quality/artifact-quality-state";
import { isArtifactBoundToTask } from "../quality/artifact-truth-boundary";
import type { TaskBrief } from "../conversation/task-contract";
import { isCapabilityInTaskScope } from "../conversation/task-output-scope";
import { resolveModelGatewayConfig } from "../model-gateway-config";

export type CapabilityAvailabilityStatus =
  | "available"
  | "needs_approved_inputs"
  | "provider_unavailable"
  | "blocked";

export type CapabilityAvailabilityEntry = {
  capabilityId: CapabilityId;
  status: CapabilityAvailabilityStatus;
  requiresConfirmation: boolean;
  missingApprovedInputs: CapabilityId[];
  reasonForModel: string;
  reasonForUser: string;
};

export type BuildCapabilityAvailabilityInput = {
  capabilityDefinitions: CapabilityDefinition[];
  artifacts: ArtifactRecord[];
  providerAvailability?: Partial<Record<CapabilityId, boolean>>;
  taskBrief?: TaskBrief;
};

export function resolveRuntimeProviderAvailability(env: Partial<NodeJS.ProcessEnv> = process.env): Partial<Record<CapabilityId, boolean>> {
  if (env.NODE_ENV === "test" && env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS !== "1") return {};

  return {
    ...(hasCozePptProvider(env) ? { coze_ppt: true as const } : {}),
    ...(hasImageProvider(env) ? { image_asset: true as const } : {}),
    ...(hasImageProvider(env) ? { ppt_sample_assets: true as const } : {}),
    ...(hasImageProvider(env) ? { ppt_full_assets: true as const } : {}),
    ...(hasImageProvider(env) ? { ppt_image_slides: true as const } : {}),
    ...(hasVideoProvider(env) ? { video_segment_generate: true as const } : {}),
    ...(hasVideoNarrationProvider(env) ? { video_narration_generate: true as const } : {}),
  };
}

export function buildCapabilityAvailability(input: BuildCapabilityAvailabilityInput): CapabilityAvailabilityEntry[] {
  const definitionsById = new Map(input.capabilityDefinitions.map((definition) => [definition.id, definition]));

  return input.capabilityDefinitions.map((definition) => {
    if (input.taskBrief && !isCapabilityInTaskScope(definition.id, input.taskBrief)) {
      return buildEntry({
        definition,
        status: "blocked",
        missingApprovedInputs: [],
        reasonForModel: `status=blocked; capability=${definition.id}; reason=task_scope_mismatch`,
        reasonForUser: "这一步不在本轮已明确的交付范围内，我不会自动扩张任务。",
      });
    }
    const missingApprovedInputs = definition.upstreamCapabilities.filter((upstreamCapabilityId) => {
      const upstreamDefinition = definitionsById.get(upstreamCapabilityId);
      return !upstreamDefinition || !hasApprovedArtifactForCapability(input.artifacts, upstreamDefinition, input.taskBrief);
    });

    if (missingApprovedInputs.length > 0) {
      return buildEntry({
        definition,
        status: "needs_approved_inputs",
        missingApprovedInputs,
        reasonForModel: `status=needs_approved_inputs; capability=${definition.id}; missingApprovedInputs=${missingApprovedInputs.join(",")}`,
        reasonForUser: buildMissingApprovedInputsReason(definition, missingApprovedInputs, definitionsById),
      });
    }

    if (definition.providerMode === "external" && input.providerAvailability?.[definition.id] !== true) {
      const status = "provider_unavailable";
      return buildEntry({
        definition,
        status,
        missingApprovedInputs,
        reasonForModel: `status=${status}; capability=${definition.id}; providerMode=${definition.providerMode}`,
        reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
      });
    }

    return buildEntry({
      definition,
      status: "available",
      missingApprovedInputs,
      reasonForModel: `status=available; capability=${definition.id}; upstreamApproved=true`,
      reasonForUser: definition.requiresConfirmation ? "前置成果已确认，可以继续，执行前仍需教师确认。" : "前置成果已确认，可以继续。",
    });
  });
}

function buildMissingApprovedInputsReason(
  definition: CapabilityDefinition,
  missingApprovedInputs: CapabilityId[],
  definitionsById: Map<CapabilityId, CapabilityDefinition>,
): string {
  if (definition.id === "video_script_generate") {
    return "可以只做视频脚本，但现在还缺少已确认的导入创意主题。请补充这节课的年级、课题和希望采用的导入情境；我会据此规划最短前置步骤，不会继续生成 PPT 或最终视频。";
  }

  const missingLabels = missingApprovedInputs.map((capabilityId) => {
    const label = definitionsById.get(capabilityId)?.userLabel ?? "前置内容";
    return label.replace(/^(整理|生成|提取|规划|只拼接)/, "");
  });
  return `要继续${definition.userLabel}，还缺少已确认的${missingLabels.join("、")}。请先补充或确认这些内容，再继续当前任务。`;
}

function hasApprovedArtifactForCapability(
  artifacts: ArtifactRecord[],
  definition: CapabilityDefinition,
  taskBrief?: TaskBrief,
): boolean {
  return artifacts.some(
    (artifact) =>
      isArtifactTrustedForDownstream(artifact) &&
      (!taskBrief || isArtifactBoundToTask(artifact, taskBrief)) &&
      artifact.kind === definition.artifactKind,
  );
}

function hasCozePptProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  const channel = env.COZE_PPT_CHANNEL?.trim().toLowerCase();
  return channel === "cli" || env.COZE_PPT_USE_CLI === "1";
}

function hasImageProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  return hasGatewayCapability("image", env);
}

function hasVideoProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  return hasGatewayCapability("video", env);
}

function hasVideoNarrationProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  return hasGatewayCapability("tts", env);
}

function hasGatewayCapability(
  capability: "image" | "video" | "tts",
  env: Partial<NodeJS.ProcessEnv>,
): boolean {
  try {
    resolveModelGatewayConfig(capability, env as NodeJS.ProcessEnv);
    return true;
  } catch {
    return false;
  }
}

function buildEntry(input: {
  definition: CapabilityDefinition;
  status: CapabilityAvailabilityStatus;
  missingApprovedInputs: CapabilityId[];
  reasonForModel: string;
  reasonForUser: string;
}): CapabilityAvailabilityEntry {
  return {
    capabilityId: input.definition.id,
    status: input.status,
    requiresConfirmation: input.definition.requiresConfirmation,
    missingApprovedInputs: input.missingApprovedInputs,
    reasonForModel: input.reasonForModel,
    reasonForUser: input.reasonForUser,
  };
}
