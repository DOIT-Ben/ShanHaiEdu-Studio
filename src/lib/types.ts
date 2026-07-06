import type { LucideIcon } from "lucide-react";

export type ArtifactStatus = "not_started" | "in_progress" | "needs_review" | "approved" | "blocked" | "stale";

export type ArtifactKind =
  | "textbook_evidence"
  | "lesson_plan"
  | "intro_video_plan"
  | "ppt_draft"
  | "image_prompts"
  | "video_storyboard"
  | "final_delivery";

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
};

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

export type StepDefinition = {
  key: ArtifactKind;
  label: string;
  Icon: LucideIcon;
};

