export type AgentRuntimeTask =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_outline"
  | "intro_video_plan"
  | "final_delivery_checklist";

export type AgentRuntimeKind = "deterministic" | "openai";

export type AgentRunStatus = "succeeded" | "failed";

export type AgentProjectContext = {
  grade: string;
  subject: string;
  topic: string;
  lessonDurationMinutes?: number;
  textbookVersion?: string;
  teacherGoal?: string;
  requestedOutputs: string[];
};

export type ApprovedArtifactInput = {
  nodeKey: string;
  title: string;
  summary: string;
  markdown: string;
};

export type AgentRuntimeInput = {
  projectId: string;
  runId: string;
  task: AgentRuntimeTask;
  userMessage: string;
  projectContext: AgentProjectContext;
  approvedArtifacts: ApprovedArtifactInput[];
};

export type AgentAssistantMessage = {
  title: string;
  body: string;
};

export type AgentArtifactDraft = {
  nodeKey: AgentRuntimeTask;
  kind: AgentRuntimeTask;
  title: string;
  summary: string;
  markdown: string;
  contentType: "text/markdown";
  generationMode: "deterministic_draft" | "model_generated";
  isReadyForTeacherReview: boolean;
};

export type AgentNextSuggestedAction = {
  type: "review_artifact" | "revise_input" | "retry";
  label: string;
};

export type AgentRunMetadata = {
  runId: string;
  projectId: string;
  task: AgentRuntimeTask;
  runtimeKind: AgentRuntimeKind;
  status: AgentRunStatus;
};

export type AgentRuntimeSucceededResult = {
  status: "succeeded";
  run: AgentRunMetadata;
  assistantMessage: AgentAssistantMessage;
  artifactDraft: AgentArtifactDraft;
  nextSuggestedAction: AgentNextSuggestedAction;
};

export type AgentRuntimeFailedResult = {
  status: "failed";
  run: AgentRunMetadata;
  assistantMessage: AgentAssistantMessage;
  nextSuggestedAction: AgentNextSuggestedAction;
};

export type AgentRuntimeResult = AgentRuntimeSucceededResult | AgentRuntimeFailedResult;

export interface AgentRuntime {
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
