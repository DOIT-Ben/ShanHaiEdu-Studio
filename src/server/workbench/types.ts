export type ProjectStatus = "active" | "review" | "blocked" | "done";

export type MessageRole = "teacher" | "assistant" | "system";

export type WorkflowNodeKey =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_draft"
  | "ppt_design_draft"
  | "pptx_artifact"
  | "intro_video_plan"
  | "image_prompts"
  | "video_storyboard"
  | "final_delivery";

export type WorkflowNodeStatus = "not_started" | "in_progress" | "needs_review" | "approved" | "blocked" | "stale" | "failed";

export type ArtifactKind = WorkflowNodeKey;

export type ArtifactStatus = WorkflowNodeStatus;

export type ProjectRecord = {
  id: string;
  title: string;
  status: ProjectStatus;
  currentNodeKey: WorkflowNodeKey;
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageRecord = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  artifactRefs: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowNodeRecord = {
  id: string;
  projectId: string;
  key: WorkflowNodeKey;
  title: string;
  status: WorkflowNodeStatus;
  order: number;
  upstreamNodeKeys: WorkflowNodeKey[];
  approvedArtifactId: string | null;
  staleReason: string | null;
  updatedAt: string;
};

export type ArtifactRecord = {
  id: string;
  projectId: string;
  nodeKey: WorkflowNodeKey;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  summary: string;
  markdownContent: string;
  structuredContent: Record<string, unknown>;
  version: number;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentRunRecord = {
  id: string;
  projectId: string;
  nodeKey: WorkflowNodeKey;
  status: string;
  runtime: string;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type AgentRunStatus = "running" | "succeeded" | "failed";

export type GenerationJobKind = "pptx" | "image" | "video";

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationJobRecord = {
  id: string;
  projectId: string;
  kind: GenerationJobKind;
  sourceArtifactId: string;
  status: GenerationJobStatus;
  attempts: number;
  maxAttempts: number;
  resultArtifactId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ProjectSnapshot = {
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  nodes: WorkflowNodeRecord[];
  artifacts: ArtifactRecord[];
  agentRuns: AgentRunRecord[];
  generationJobs: GenerationJobRecord[];
};

export type CreateProjectInput = {
  title: string;
  ownerUserId?: string;
  grade?: string;
  subject?: string;
  textbookVersion?: string;
  lessonTopic?: string;
};

export type AddMessageInput = {
  role: MessageRole;
  content: string;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type SaveArtifactInput = {
  nodeKey: WorkflowNodeKey;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  summary: string;
  markdownContent: string;
  structuredContent?: Record<string, unknown>;
};

export type RegenerateArtifactInput = {
  title?: string;
  expectedLatestVersion?: number;
  summary: string;
  markdownContent: string;
  structuredContent?: Record<string, unknown>;
};

export type StartAgentRunInput = {
  nodeKey: WorkflowNodeKey;
  runtime: string;
};

export type FinishAgentRunInput = {
  status: Exclude<AgentRunStatus, "running">;
  errorMessage?: string;
};

export type CreateGenerationJobInput = {
  kind: GenerationJobKind;
  sourceArtifactId: string;
  maxAttempts?: number;
};

export type FinishGenerationJobInput = {
  resultArtifactId: string;
};

export type FailGenerationJobInput = {
  errorMessage: string;
};
