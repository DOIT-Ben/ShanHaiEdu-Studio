import type { LucideIcon } from "lucide-react";
import type { RealAssetKind } from "@/lib/artifact-real-assets";

export type ArtifactStatus = "not_started" | "in_progress" | "needs_review" | "approved" | "blocked" | "stale";

export type ArtifactKind =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_outline"
  | "intro_video_plan"
  | "ppt_draft"
  | "image_prompts"
  | "video_storyboard"
  | "final_delivery"
  | "final_delivery_checklist";

export type ProjectStatus = "active" | "review" | "blocked" | "done";

export type ProjectItem = {
  id: string;
  title: string;
  meta: string;
  status: ProjectStatus;
  currentStep: string;
  updatedAt: string;
};

export type ArtifactActionState = {
  canCopy: boolean;
  canUseAsInput: boolean;
  canOpenDetail: boolean;
  canConfirm: boolean;
  canRegenerate: boolean;
};

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
};

export type ChatMessage = {
  id: string;
  speaker: "teacher" | "assistant";
  title?: string;
  body: string;
  tone?: "normal" | "focus" | "warning" | "error";
};

export type WorkbenchSnapshot = {
  project: ProjectItem;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  activeArtifactKey: string;
};

export type WorkbenchDataSource = {
  listProjects: () => Promise<ProjectItem[]>;
  createProject: () => Promise<WorkbenchSnapshot>;
  getProjectSnapshot: (projectId: string) => Promise<WorkbenchSnapshot>;
  sendMessage: (projectId: string, body: string, reference: string | null) => Promise<WorkbenchSnapshot>;
  approveArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  regenerateArtifact: (projectId: string, artifactKey: string) => Promise<WorkbenchSnapshot>;
  generateRealAsset: (projectId: string, artifactId: string, assetKind: RealAssetKind) => Promise<WorkbenchSnapshot>;
};

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

export type StepDefinition = {
  key: ArtifactKind;
  label: string;
  Icon: LucideIcon;
};

