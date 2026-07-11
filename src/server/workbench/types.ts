export type ProjectStatus = "active" | "review" | "blocked" | "done";

export type ProjectLifecycleState = "active" | "archived" | "trash";

export type ProjectLifecycleAction = "rename" | "archive" | "trash" | "restore";

export type ProjectLifecycleMutation = {
  action: ProjectLifecycleAction;
  expectedLifecycleVersion: number;
  title?: string;
};

export type MessageRole = "teacher" | "assistant" | "system";
export type MessageReactionValue = "helpful" | "unhelpful";

export type WorkflowNodeKey =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_draft"
  | "ppt_design_draft"
  | "pptx_artifact"
  | "intro_video_plan"
  | "knowledge_anchor_extract"
  | "creative_theme_generate"
  | "video_script_generate"
  | "storyboard_generate"
  | "asset_brief_generate"
  | "asset_image_generate"
  | "video_segment_plan"
  | "video_segment_generate"
  | "concat_only_assemble"
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
  lifecycleState: ProjectLifecycleState;
  lifecycleVersion: number;
  archivedAt: string | null;
  deletedAt: string | null;
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
  reaction?: MessageReactionValue;
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

export type ConversationTurnJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "blocked";

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

export type ConversationTurnJobRecord = {
  id: string;
  projectId: string;
  teacherMessageId: string;
  assistantMessageId: string | null;
  status: ConversationTurnJobStatus;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  lockedBy: string | null;
  lockedUntil: string | null;
  errorCode: string | null;
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
  turnJobs: ConversationTurnJobRecord[];
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

export type SetMessageReactionInput = {
  messageId: string;
  value: MessageReactionValue | null;
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

export type EnqueueConversationTurnInput = {
  teacherMessageId: string;
  idempotencyKey?: string;
  maxAttempts?: number;
};

export type EnqueueMessageAndConversationTurnInput = AddMessageInput & {
  idempotencyKey?: string;
  maxAttempts?: number;
};

export type FinishConversationTurnInput = {
  assistantMessageId?: string;
  status?: Extract<ConversationTurnJobStatus, "succeeded" | "blocked">;
  errorCode?: string;
  errorMessage?: string;
};

export type FailConversationTurnInput = {
  assistantMessageId?: string;
  errorCode?: string;
  errorMessage: string;
};
