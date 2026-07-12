import type { CapabilityDefinition, CapabilityId } from "./types";
import type { ArtifactRecord } from "../workbench/types";

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
};

export function resolveRuntimeProviderAvailability(env: Partial<NodeJS.ProcessEnv> = process.env): Partial<Record<CapabilityId, boolean>> {
  if (env.NODE_ENV === "test" && env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS !== "1") return {};

  return {
    ...(hasCozePptProvider(env) ? { coze_ppt: true as const } : {}),
    ...(hasImageProvider(env) ? { image_asset: true as const } : {}),
    ...(hasImageProvider(env) ? { ppt_sample_assets: true as const } : {}),
    ...(hasImageProvider(env) ? { ppt_full_assets: true as const } : {}),
    ...(hasVideoProvider(env) ? { video_segment_generate: true as const } : {}),
  };
}

export function buildCapabilityAvailability(input: BuildCapabilityAvailabilityInput): CapabilityAvailabilityEntry[] {
  const definitionsById = new Map(input.capabilityDefinitions.map((definition) => [definition.id, definition]));

  return input.capabilityDefinitions.map((definition) => {
    const missingApprovedInputs = definition.upstreamCapabilities.filter((upstreamCapabilityId) => {
      const upstreamDefinition = definitionsById.get(upstreamCapabilityId);
      return !upstreamDefinition || !hasApprovedArtifactForCapability(input.artifacts, upstreamDefinition);
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

    if (requiresUnavailableProvider(definition) && input.providerAvailability?.[definition.id] !== true) {
      const status = definition.providerMode === "external" ? "provider_unavailable" : "blocked";
      return buildEntry({
        definition,
        status,
        missingApprovedInputs,
        reasonForModel: `status=${status}; capability=${definition.id}; providerMode=${definition.providerMode}; deterministicFallback=${definition.deterministicFallback}`,
        reasonForUser: definition.providerMode === "external"
          ? "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。"
          : "这一步暂时不能执行，可以先继续完善已确认内容。",
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

function hasApprovedArtifactForCapability(artifacts: ArtifactRecord[], definition: CapabilityDefinition): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.status === "approved" &&
      artifact.isApproved === true &&
      (artifact.kind === definition.artifactKind || artifact.nodeKey === definition.workflowNodeKey),
  );
}

function requiresUnavailableProvider(definition: CapabilityDefinition): boolean {
  return definition.providerMode !== "internal" && definition.deterministicFallback === "blocked";
}

function hasCozePptProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  const channel = env.COZE_PPT_CHANNEL?.trim().toLowerCase();
  if (channel === "cli" || env.COZE_PPT_USE_CLI === "1") return true;
  const token = env.COZE_API_TOKEN?.trim();
  if (!token) return false;
  return Boolean(env.COZE_PPT_RUN_URL?.trim() || env.COZE_PPT_BOT_ID?.trim());
}

function hasImageProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  const channel = env.IMAGE_PROVIDER_CHANNEL?.trim() || "primary";
  const map = {
    primary: ["IMAGEGEN_MYSELF_PRIMARY_API_KEY", "IMAGEGEN_MYSELF_PRIMARY_BASE_URL"],
    free: ["IMAGEGEN_FREE_API_KEY", "IMAGEGEN_FREE_BASE_URL"],
    free_primary: ["IMAGEGEN_FREE_PRIMARY_API_KEY", "IMAGEGEN_FREE_PRIMARY_BASE_URL"],
    myself_fallback: ["IMAGEGEN_MYSELF_FALLBACK_API_KEY", "IMAGEGEN_MYSELF_FALLBACK_BASE_URL"],
  } as const;
  const [apiKeyName, baseUrlName] = map[channel as keyof typeof map] ?? map.primary;
  return Boolean(env[apiKeyName]?.trim() && env[baseUrlName]?.trim());
}

function hasVideoProvider(env: Partial<NodeJS.ProcessEnv>): boolean {
  const wantsEvolink = env.VIDEO_PROVIDER_MODE?.trim() === "evolink" || Boolean(env.EVOLINK_API_KEY?.trim() || env.EVOLINK_VIDEO_API_KEY?.trim());
  if (wantsEvolink) {
    return Boolean((env.EVOLINK_VIDEO_API_KEY?.trim() || env.EVOLINK_API_KEY?.trim()) && (env.EVOLINK_VIDEO_BASE_URL?.trim() || env.EVOLINK_BASE_URL?.trim() || "https://api.evolink.ai"));
  }
  return Boolean((env.OCTO_API_KEY?.trim() || env.NEWAPI_API_KEY?.trim()) && (env.OCTO_BASE_URL?.trim() || env.NEWAPI_BASE_URL?.trim()));
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
