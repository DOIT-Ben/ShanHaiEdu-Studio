import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { resolveProviderLedgerValueBag } from "@/server/provider-ledger/provider-ledger-adapter";
import {
  buildResolvedShotVideoRequest,
  type ResolvedShotVideoRequest,
} from "@/server/video-generation/video-generation-run";
import { resolveEvolinkShotReferences } from "@/server/video-generation/evolink-reference-upload";
import {
  resolveStoryboardShotDurations,
  validateStoryboardManifest,
  type StoryboardManifest,
} from "@/server/video-quality/video-production-contract";
import type { ArtifactRecord } from "@/server/workbench/types";

export type ProviderVideoShotRequestInput = {
  toolInput?: Record<string, unknown>;
  storyboard: ArtifactRecord;
  assetImages: ArtifactRecord;
};

export async function resolveDefaultVideoShotRequest(
  input: ProviderVideoShotRequestInput,
): Promise<ResolvedShotVideoRequest> {
  const shotIds = input.toolInput?.shotIds;
  if (!Array.isArray(shotIds) || shotIds.length !== 1 || typeof shotIds[0] !== "string" || !/^shot_[a-z0-9_-]+$/i.test(shotIds[0])) {
    throw new Error("video_provider_single_shot_required");
  }
  const manifestValue = input.storyboard.structuredContent.videoStoryboardManifest;
  if (!isRecord(manifestValue)) throw new Error("video_storyboard_manifest_missing");
  const manifest = manifestValue as StoryboardManifest;
  const validation = validateStoryboardManifest(manifest);
  if (!validation.valid) throw new Error(`video_storyboard_manifest_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  const shot = manifest.shots.find((candidate) => candidate.shotId === shotIds[0]);
  if (!shot) throw new Error("video_provider_shot_out_of_range");
  const durationSeconds = resolveStoryboardShotDurations(manifest).get(shot.shotId);
  if (!durationSeconds) throw new Error("video_provider_shot_duration_missing");
  const prompt = `${shot.modelPrompt.trim()}\n\nNegative constraints: ${shot.negativePrompt.trim()}`;
  if (shot.referencePolicy === "none") return buildResolvedShotVideoRequest({ shotId: shot.shotId, prompt, durationTargetRange: shot.durationTargetRange, durationSeconds });
  if (shot.referenceAssetIds.length !== 1) throw new Error("video_provider_reference_count_unsupported");

  const reference = manifest.references.find((candidate) => candidate.assetId === shot.referenceAssetIds[0]);
  if (!reference || !reference.applicableShotIds.includes(shot.shotId)) throw new Error("video_provider_reference_binding_invalid");
  const storage = isRecord(input.assetImages.structuredContent.storage) ? input.assetImages.structuredContent.storage : null;
  const imageAsset = storage && isRecord(storage.imageAsset) ? storage.imageAsset : null;
  const localOutput = typeof imageAsset?.localOutput === "string" ? imageAsset.localOutput : "";
  const localPath = resolveLocalArtifactOutput(localOutput);
  const sha256 = typeof imageAsset?.sha256 === "string" ? imageAsset.sha256.toLowerCase() : "";
  if (!localPath || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("video_provider_reference_file_invalid");
  const providerValues = resolveProviderLedgerValueBag({ capability: "video_generation" });
  const apiKey = providerValues.get("EVOLINK_API_KEY") || "";
  const referenceEvidence = await resolveEvolinkShotReferences({
    shotId: shot.shotId,
    apiKey,
    filesBaseUrl: providerValues.get("EVOLINK_FILES_BASE_URL"),
    references: [{
      assetId: reference.assetId,
      assetDomain: "video",
      sha256,
      applicableShotIds: [...reference.applicableShotIds],
      purpose: reference.purpose,
      localPath,
    }],
  });
  return buildResolvedShotVideoRequest({ shotId: shot.shotId, prompt, durationTargetRange: shot.durationTargetRange, durationSeconds, referenceEvidence });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
