export type AgentRuntimeTask =
  | "requirement_spec"
  | "textbook_evidence"
  | "lesson_plan"
  | "ppt_outline"
  | "ppt_design"
  | "intro_video_plan"
  | "knowledge_anchor_extract"
  | "creative_theme_generate"
  | "video_script_generate"
  | "storyboard_generate"
  | "asset_brief_generate"
  | "video_segment_plan"
  | "concat_only_assemble"
  | "final_delivery_checklist";

export type AgentRuntimeKind = "openai";

export type AgentRunStatus = "succeeded" | "failed";

export type AgentRuntimeFailureCategory =
  | "provider"
  | "network"
  | "timeout"
  | "parse"
  | "missing_field"
  | "validation"
  | "unknown";

export type AgentRuntimeFailure = {
  category: AgentRuntimeFailureCategory;
  retryable: boolean;
  reasonCode?: string;
  details?: string[];
};

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
  artifactId?: string;
  kind?: string;
  version?: number;
  digest?: string;
  nodeKey: string;
  title: string;
  summary: string;
  markdown: string;
};

export type BusinessSkillArtifactContract = {
  artifactType: string;
  contractVersion: string;
};

export type BusinessSkillContext = {
  skillName: string;
  skillVersion: string;
  displayName: string;
  responsibility: string;
  semanticSlice: {
    schemaVersion: "business-tool-skill-slice.v1";
    bindingMode: "formal_contract" | "guidance_only";
    artifactContractAuthority: "skill" | "tool";
    toolName: string;
    responsibility: string;
    contracts: {
      tool: { consumes: string[]; produces: string[] };
      skill?: {
        consumes: BusinessSkillArtifactContract[];
        produces: BusinessSkillArtifactContract[];
      };
    };
    guidance: Array<{ sourcePath: string; content: string }>;
  };
  provenance: {
    schemaVersion: "business-tool-skill-provenance.v1";
    entrypointSha256: string;
    references: Array<{ sourcePath: string; sha256: string }>;
    bindingPolicyDigest: string;
  };
};

export type AgentRuntimeInput = {
  projectId: string;
  runId: string;
  sourceMessageId?: string;
  task: AgentRuntimeTask;
  userMessage: string;
  taskInput?: Record<string, unknown>;
  projectContext: AgentProjectContext;
  approvedArtifacts: ApprovedArtifactInput[];
  businessSkillContext?: BusinessSkillContext;
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
  generationMode: "model_generated";
  isReadyForTeacherReview: boolean;
  structuredContent?: Record<string, unknown>;
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
  failure?: AgentRuntimeFailure;
  assistantMessage: AgentAssistantMessage;
  nextSuggestedAction: AgentNextSuggestedAction;
};

export type AgentRuntimeResult = AgentRuntimeSucceededResult | AgentRuntimeFailedResult;

export interface AgentRuntime {
  run(input: AgentRuntimeInput): Promise<AgentRuntimeResult>;
}
