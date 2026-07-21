import type { BusinessSkillContext } from "@/server/agent-runtime/types";
import type { CozePptGenerationResult } from "@/server/coze-ppt/coze-ppt-run";
import type { ImageGenerationResult } from "@/server/image-generation/image-generation-run";
import type { PptImageSlideBundle } from "@/server/ppt-image-slides/ppt-image-slide-types";
import type { PptAssetBatchLifecycle, PptAssetBatchRunResult } from "@/server/ppt-quality/ppt-asset-batch-run";
import type {
  ResolvedShotVideoRequest,
  VideoGenerationResult,
  VideoGenerationTaskLifecycle,
} from "@/server/video-generation/video-generation-run";
import type { VideoNarrationProviderResult } from "@/server/video-generation/video-narration-provider";
import type { VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

import type { ToolDefinition } from "./tool-types";

export type ProviderArtifactRef = {
  kind: string;
  artifactId: string;
  title?: string;
  summary?: string;
  markdownContent?: string;
  structuredContent?: Record<string, unknown>;
};

export type ProviderBusinessSkillInput = {
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  businessSkillContext?: BusinessSkillContext;
};

export type RunCozePptProvider = (
  input: { project: ProjectRecord; artifact: ArtifactRecord } & ProviderBusinessSkillInput,
) => Promise<CozePptGenerationResult>;

export type RunImageProvider = (
  input: { project: ProjectRecord; artifact: ArtifactRecord } & ProviderBusinessSkillInput,
) => Promise<ImageGenerationResult>;

export type RunPptAssetBatchProvider = (
  input: {
    artifact: ArtifactRecord;
    scope: "key_samples" | "full_production";
    lifecycle?: PptAssetBatchLifecycle;
  } & ProviderBusinessSkillInput,
) => Promise<PptAssetBatchRunResult>;

export type RunPptImageSlideProvider = (input: {
  project: ProjectRecord;
  designArtifact: ArtifactRecord;
}) => Promise<PptImageSlideBundle>;

export type RunVideoProvider = (
  input: {
    project: ProjectRecord;
    artifact: ArtifactRecord;
    upstreamArtifacts?: ArtifactRecord[];
    taskLifecycle?: VideoGenerationTaskLifecycle;
    shot?: ResolvedShotVideoRequest;
  } & ProviderBusinessSkillInput,
) => Promise<VideoGenerationResult>;

export type RunVideoNarrationProvider = (
  input: { script: VideoNarrationScript } & ProviderBusinessSkillInput,
) => Promise<VideoNarrationProviderResult>;

export type ResolveVideoShotProvider = (input: {
  toolInput?: Record<string, unknown>;
  storyboard: ArtifactRecord;
  assetImages: ArtifactRecord;
}) => Promise<ResolvedShotVideoRequest>;

export type ProviderToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  project?: ProjectRecord;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  artifactRefs: ProviderArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  sourceMessageId?: string;
  generationTaskLifecycle?: VideoGenerationTaskLifecycle;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
  businessSkillContext?: BusinessSkillContext;
  runCozePpt?: RunCozePptProvider;
  runImage?: RunImageProvider;
  runPptAssetBatch?: RunPptAssetBatchProvider;
  runPptImageSlides?: RunPptImageSlideProvider;
  runVideo?: RunVideoProvider;
  runVideoNarration?: RunVideoNarrationProvider;
  resolveVideoShot?: ResolveVideoShotProvider;
};
