import type { LucideIcon } from "lucide-react";
import type { RealAssetKind } from "@/lib/artifact-real-assets";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";

export type ArtifactStatus = "not_started" | "in_progress" | "needs_review" | "approved" | "blocked" | "stale";

export type ArtifactKind =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_outline"
  | "intro_video_plan"
  | "ppt_draft"
  | "ppt_design_draft"
  | "pptx_artifact"
  | "image_prompts"
  | "video_storyboard"
  | "knowledge_anchor_extract"
  | "creative_theme_generate"
  | "video_script_generate"
  | "storyboard_generate"
  | "asset_brief_generate"
  | "asset_image_generate"
  | "video_segment_plan"
  | "video_segment_generate"
  | "video_narration_generate"
  | "concat_only_assemble"
  | "final_delivery"
  | "final_delivery_checklist";

export type ProjectStatus = "active" | "review" | "blocked" | "done";

export type ProjectLifecycleState = "active" | "archived" | "trash";

export type ProjectLifecycleAction = "rename" | "archive" | "trash" | "restore";

export type ProjectLifecycleMutation = {
  action: ProjectLifecycleAction;
  expectedLifecycleVersion: number;
  title?: string;
};

export type GenerationIntensity = "standard" | "enhanced" | "deep" | "extreme";

export type ProjectItem = {
  id: string;
  title: string;
  meta: string;
  status: ProjectStatus;
  currentStep: string;
  updatedAt: string;
  lifecycleState: ProjectLifecycleState;
  lifecycleVersion: number;
  archivedAt: string | null;
  deletedAt: string | null;
  generationIntensity?: GenerationIntensity;
  intensityVersion?: number;
  generationIntensitySuggestion?: { target: GenerationIntensity; reason: string; signature: string } | null;
};

export type ArtifactActionState = {
  canCopy: boolean;
  canUseAsInput: boolean;
  canOpenDetail: boolean;
  canConfirm: boolean;
  canRegenerate: boolean;
};

export type ArtifactRouteGenerationActions = Partial<Record<"coze_ppt" | "image_asset" | "video_segment_generate", { actionId: string }>>;

export type ArtifactItem = {
  key: string;
  artifactId?: string;
  nodeKey?: ArtifactKind;
  version?: number;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  summary: string;
  updatedAt: string;
  reusable: boolean;
  sourceTitles: string[];
  previewFields: { label: string; value: string }[];
  actions: ArtifactActionState;
  content: Record<string, string | string[]>;
  realAssetDownloads?: RealAssetKind[];
  routeGenerationActions?: ArtifactRouteGenerationActions;
  pptSampleReview?: {
    candidateDigest: string;
    pageIds: string[];
    overviewKinds: Array<"scene_and_primary_props" | "micro_assets" | "assembled_samples">;
    reviewStatus: "awaiting_dvp_review" | "failed" | "passed";
    qa?: PptSampleReviewSubmission["qa"];
  };
  pptFullDeckReview?: {
    candidateDigest: string;
    pageIds: string[];
    reviewStatus: "awaiting_delivery_review" | "failed" | "passed";
    qa?: PptFullDeckReviewSubmission["qa"];
  };
};

export type PptSampleReviewSubmission = {
  candidateDigest: string;
  reviewSource: "teacher" | "critic";
  reviewerMessageId?: string | null;
  qa: Array<{
    pageId: string;
    design: "passed" | "failed";
    visual: "passed" | "failed";
    provenance: "passed" | "failed";
    findings: string[];
  }>;
};

export type PptFullDeckReviewSubmission = {
  candidateDigest: string;
  reviewSource: "teacher" | "critic";
  reviewerMessageId?: string | null;
  qa: Array<{
    pageId: string;
    design: "passed" | "failed";
    visual: "passed" | "failed";
    provenance: "passed" | "failed";
    readability: "passed" | "failed";
    findings: string[];
  }>;
};

export type ChatMessage = {
  id: string;
  speaker: "teacher" | "assistant";
  turnSourceMessageId?: string;
  projectionKind?: "agent-activity" | "agent-response";
  title?: string;
  body: string;
  parts?: import("@/lib/conversation-message-contract").MessagePart[];
  timeLabel?: string;
  tone?: "normal" | "focus" | "warning" | "error";
  turnStatus?: ConversationTurnJobStatus;
  turnStatusLabel?: string;
  artifactRefs?: string[];
  quickReplies?: {
    label: string;
    prompt: string;
    actionId?: string;
    recommended?: boolean;
  }[];
  reaction?: "helpful" | "unhelpful";
};

export type ConversationTurnJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "blocked";

export type ConversationTurnJob = {
  id: string;
  projectId: string;
  teacherMessageId: string;
  assistantMessageId: string | null;
  status: ConversationTurnJobStatus;
  statusLabel: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchSendMessageOptions = {
  confirmedActionId?: string;
  actionId?: string;
  idempotencyKey?: string;
  responseStyle?: XiaoKuResponseStyle;
};

export type ConversationMessageSubmission = {
  body: string;
  reference: string | null;
  artifactRefs: string[];
  confirmedActionId?: string;
  idempotencyKey?: string;
  responseStyle?: XiaoKuResponseStyle;
};

export type WorkbenchSnapshot = {
  project: ProjectItem;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  turnJobs: ConversationTurnJob[];
  activeArtifactKey: string;
  agentEventSequence: number;
};

export type WorkbenchDataSource = {
  listProjects: (view?: ProjectLifecycleState) => Promise<ProjectItem[]>;
  createProject: () => Promise<WorkbenchSnapshot>;
  mutateProjectLifecycle: (projectId: string, mutation: ProjectLifecycleMutation) => Promise<{ changed: boolean; project: ProjectItem }>;
  updateGenerationIntensity: (projectId: string, intensity: GenerationIntensity, expectedVersion: number, confirmationActionId?: string) => Promise<{ project: ProjectItem; confirmationRequired?: boolean; actionId?: string }>;
  getProjectSnapshot: (projectId: string) => Promise<WorkbenchSnapshot>;
  submitConversationMessage: (projectId: string, submission: ConversationMessageSubmission) => Promise<WorkbenchSnapshot>;
  recoverConversationTurn: (projectId: string, checkpointId: string) => Promise<WorkbenchSnapshot>;
  sendMessage: (projectId: string, body: string, reference: string | null, options?: WorkbenchSendMessageOptions) => Promise<WorkbenchSnapshot>;
  setMessageReaction?: (projectId: string, messageId: string, value: ChatMessage["reaction"] | null) => Promise<WorkbenchSnapshot>;
  approveArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  submitPptSampleReview: (projectId: string, artifactKey: string, review: PptSampleReviewSubmission) => Promise<WorkbenchSnapshot>;
  submitPptFullDeckReview: (projectId: string, artifactKey: string, review: PptFullDeckReviewSubmission) => Promise<WorkbenchSnapshot>;
  regenerateArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  generateRealAsset: (projectId: string, artifactId: string, assetKind: RealAssetKind, options?: WorkbenchSendMessageOptions) => Promise<WorkbenchSnapshot>;
};

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

export type StepDefinition = {
  key: ArtifactKind;
  label: string;
  Icon: LucideIcon;
};
