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

export type ArtifactKind =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "interactive_courseware_spec"
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
  | "video_narration_generate"
  | "concat_only_assemble"
  | "image_prompts"
  | "video_storyboard"
  | "final_delivery";

export type ArtifactStatus = "not_started" | "in_progress" | "needs_review" | "approved" | "blocked" | "stale" | "failed";

export type ProjectRecord = {
  id: string;
  title: string;
  status: ProjectStatus;
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
  lifecycleState: ProjectLifecycleState;
  lifecycleVersion: number;
  intentEpoch?: number;
  generationIntensity?: import("@/server/generation-intensity/generation-intensity-policy").GenerationIntensity;
  intensityVersion?: number;
  generationIntensitySuggestion?: {
    target: import("@/server/generation-intensity/generation-intensity-policy").GenerationIntensity;
    reason: string;
    signature: string;
  } | null;
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
  parts: import("@/lib/conversation-message-contract").MessagePart[];
  artifactRefs: string[];
  metadata: Record<string, unknown>;
  reaction?: MessageReactionValue;
  createdAt: string;
};

export type ArtifactRecord = {
  id: string;
  projectId: string;
  taskId?: string | null;
  taskBriefDigest?: string | null;
  intentEpoch?: number | null;
  planRevision?: number | null;
  origin?: ArtifactOrigin;
  nodeKey: ArtifactKind;
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

export type ArtifactOrigin = "teacher_input" | "tool_result" | "system_candidate" | "legacy";

export type GenerationJobKind = "pptx" | "image" | "audio" | "video";

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
  providerResultJson?: string | null;
  countsAsProviderSubmission?: boolean;
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
  generationIntensity?: import("@/server/generation-intensity/generation-intensity-policy").GenerationIntensity;
  intensityVersion?: number;
  lockedBy: string | null;
  lockedUntil: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failureCategory: string | null;
  failureRetryability: import("@/server/conversation/main-agent-failure").MainAgentFailureRetryability | null;
  failureEvidenceDigest: string | null;
  recoveryEvidenceDigest: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ProjectSnapshot = {
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  artifacts: ArtifactRecord[];
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
  parts?: import("@/lib/conversation-message-contract").MessagePart[];
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
};

export type SetMessageReactionInput = {
  messageId: string;
  value: MessageReactionValue | null;
};

export type SaveArtifactInput = {
  nodeKey: ArtifactKind;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  summary: string;
  markdownContent: string;
  structuredContent?: Record<string, unknown>;
  origin?: ArtifactOrigin;
  validationReport?: import("@/server/quality/quality-types").ValidationReport;
};

export type SaveInteractiveCoursewareSpecInput = {
  spec: import("@/server/activities/interactive-courseware-spec").InteractiveCoursewareSpec;
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

export type CreateGenerationJobInput = {
  kind: GenerationJobKind;
  sourceArtifactId: string;
  unitId?: string;
  maxAttempts?: number;
  capabilityId?: string;
  idempotencyKey?: string;
  inputSnapshot?: Record<string, unknown>;
  sourceArtifactIds?: string[];
  createStagedArtifactCommit?: boolean;
  countsAsProviderSubmission?: boolean;
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

export type CompleteGenerationUnitInput = {
  providerResultJson: string;
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
  preemptiveControl?: {
    kind: "pause" | "cancel" | "redirect";
    reasonCode: "teacher_requested_pause" | "teacher_requested_cancel" | "teacher_requested_redirect";
    advanceIntentEpoch: boolean;
    userMessage: string;
  };
};

export type FinishConversationTurnInput = {
  assistantMessageId?: string;
  status?: Extract<ConversationTurnJobStatus, "succeeded" | "blocked">;
  errorCode?: string;
  errorMessage?: string;
  taskTerminal?: {
    taskId: string;
    intentEpoch: number;
    taskBriefDigest: string;
    status: "completed" | "paused_recovery";
    checkpoint: Record<string, unknown> | null;
  };
};

export type FailConversationTurnInput = {
  assistantMessageId?: string;
  errorCode?: string;
  errorMessage: string;
  failureCategory?: string;
  retryability?: import("@/server/conversation/main-agent-failure").MainAgentFailureRetryability;
  failureEvidenceDigest?: string;
};

export type RecoverConversationTurnInput = {
  recoveryEvidenceDigest: string;
  allowLegacyTurnFailed?: boolean;
};

export type RecoverConversationTurnAfterProviderHealthInput = {
  projectId: string;
  jobId: string;
  teacherMessageId: string;
  taskId: string;
  intentEpoch: number;
  expectedErrorCode: string;
  recoveryEvidenceDigest: string;
};

export type RecoverConversationTurnAfterContractRepairInput = {
  projectId: string;
  jobId: string;
  teacherMessageId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  idempotencyKey: string;
  failureObservationId: string;
  expectedFailureSignature: string;
  repairEvidenceDigest: string;
};
