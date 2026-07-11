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
};

export type ChatMessage = {
  id: string;
  speaker: "teacher" | "assistant";
  title?: string;
  body: string;
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
  deliveryPlan?: ChatDeliveryPlan;
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

export type ChatDeliveryPlanStepStatus = "pending" | "awaiting_confirmation" | "running" | "succeeded" | "failed";

export type ChatDeliveryPlanStep = {
  id: string;
  title: string;
  teacherDescription: string;
  status: ChatDeliveryPlanStepStatus;
  statusLabel: string;
  requiresConfirmation: boolean;
};

export type ChatDeliveryPlan = {
  id: string;
  actionId?: string;
  title: string;
  summary: string;
  steps: ChatDeliveryPlanStep[];
};

export type WorkbenchSendMessageOptions = {
  confirmedActionId?: string;
  actionId?: string;
  idempotencyKey?: string;
  responseStyle?: XiaoKuResponseStyle;
};

export type WorkbenchSnapshot = {
  project: ProjectItem;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  turnJobs: ConversationTurnJob[];
  activeArtifactKey: string;
};

export type WorkbenchDataSource = {
  listProjects: (view?: ProjectLifecycleState) => Promise<ProjectItem[]>;
  createProject: () => Promise<WorkbenchSnapshot>;
  mutateProjectLifecycle: (projectId: string, mutation: ProjectLifecycleMutation) => Promise<{ changed: boolean; project: ProjectItem }>;
  getProjectSnapshot: (projectId: string) => Promise<WorkbenchSnapshot>;
  sendMessage: (projectId: string, body: string, reference: string | null, options?: WorkbenchSendMessageOptions) => Promise<WorkbenchSnapshot>;
  setMessageReaction?: (projectId: string, messageId: string, value: ChatMessage["reaction"] | null) => Promise<WorkbenchSnapshot>;
  approveArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  regenerateArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  generateRealAsset: (projectId: string, artifactId: string, assetKind: RealAssetKind, options?: WorkbenchSendMessageOptions) => Promise<WorkbenchSnapshot>;
};

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

export type StepDefinition = {
  key: ArtifactKind;
  label: string;
  Icon: LucideIcon;
};

