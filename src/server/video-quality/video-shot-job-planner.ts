import type { CreateGenerationJobInput } from "@/server/workbench/types";
import type { StoryboardManifest } from "./video-production-contract";

export function buildVideoShotGenerationJobs(input: {
  sourceArtifactId: string;
  manifest: StoryboardManifest;
}): CreateGenerationJobInput[] {
  return input.manifest.shots.map((shot) => ({
    kind: "video",
    sourceArtifactId: input.sourceArtifactId,
    unitId: shot.shotId,
    capabilityId: "video_segment_generate",
    idempotencyKey: `video-shot:${input.sourceArtifactId}:${shot.shotId}:${input.manifest.manifestDigest}`,
    inputSnapshot: {
      productionPath: input.manifest.intent.productionPath,
      storyboardDigest: input.manifest.manifestDigest,
      shot,
      references: input.manifest.references.filter((asset) => asset.applicableShotIds.includes(shot.shotId)),
    },
  }));
}
