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
  intentEpoch?: number;
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

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "submission_unknown" | "quarantined";

export type VideoShotStatus = "planned" | "submitted" | "ready" | "needs_retake" | "failed";

export type ConversationTurnJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "blocked" | "quarantined";

export type ExecutionIdentitySnapshot = {
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  authSessionId: string | null;
};

export type ProjectExecutionFence = {
  projectId: string;
  holderId: string;
  fencingToken: number;
};

export type ProjectExecutionGuard = ProjectExecutionFence & {
  identity: ExecutionIdentitySnapshot;
};

export type GenerationJobRecord = {
  id: string;
  projectId: string;
  kind: GenerationJobKind;
  sourceArtifactId: string;
  unitId?: string | null;
  intentEpoch: number;
  inputHash: string | null;
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

export type VideoShotRecord = {
  id: string;
  projectId: string;
  sourceArtifactId: string;
  shotId: string;
  ordinal: number;
  inputHash: string;
  providerTaskId: string | null;
  selectedArtifactId: string | null;
  status: VideoShotStatus;
  qa: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpsertVideoShotsInput = {
  sourceArtifactId: string;
  shots: Array<{ shotId: string; ordinal: number; inputHash: string }>;
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
  actorUserId: string | null;
  actorAuthMode: string | null;
  authSessionId: string | null;
  fencingToken: number | null;
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
  videoShots: VideoShotRecord[];
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
  validationReport?: import("@/server/quality/quality-types").ValidationReport;
};

export type SubmitPptSampleReviewInput = {
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

export type SubmitPptFullDeckReviewInput = {
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
  evidence?: {
    artifactId: string;
    validationReportId: string;
    qualityDecisionId: string;
  };
};

export type CreateGenerationJobInput = {
  kind: GenerationJobKind;
  sourceArtifactId: string;
  unitId?: string;
  maxAttempts?: number;
  capabilityId?: string;
  idempotencyKey?: string;
  inputSnapshot?: Record<string, unknown>;
  sourceArtifactIds?: string[];
};

export type StageGenerationResultInput = Omit<SaveArtifactInput, "validationReport"> & {
  validationReport: import("@/server/quality/quality-types").ValidationReport;
};

export type GenerationResultCommitRecord = {
  artifact: ArtifactRecord;
  job: GenerationJobRecord;
};

export type FailGenerationJobInput = {
  errorMessage: string;
};

export type RecordGenerationProviderTaskInput = {
  providerTaskId: string;
};

export type EnqueueConversationTurnInput = {
  teacherMessageId: string;
  idempotencyKey?: string;
  maxAttempts?: number;
  executionIdentity?: ExecutionIdentitySnapshot;
};

export type EnqueueMessageAndConversationTurnInput = AddMessageInput & {
  idempotencyKey?: string;
  maxAttempts?: number;
  executionIdentity?: ExecutionIdentitySnapshot;
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
