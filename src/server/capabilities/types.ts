export type CapabilityId =
  | "requirement_spec"
  | "lesson_plan"
  | "ppt_outline"
  | "coze_ppt"
  | "image_asset"
  | "intro_video"
  | "final_package";

export type ProviderMode = "internal" | "external" | "package";

export type DeterministicFallbackPolicy = "allowed" | "blocked" | "draft_only";

export type CapabilityDefinition = {
  id: CapabilityId;
  userLabel: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  upstreamCapabilities: CapabilityId[];
  artifactKind: string;
  workflowNodeKey: string;
  requiresConfirmation: boolean;
  providerMode: ProviderMode;
  deterministicFallback: DeterministicFallbackPolicy;
  failureRecovery: {
    retryable: boolean;
    userMessage: string;
  };
};

export type CapabilityToolPlan = {
  planId: string;
  capabilityId: CapabilityId;
  reasonForUser: string;
  internalReason: string;
  inputDraft: Record<string, unknown>;
  missingInputs: string[];
  upstreamPlan: CapabilityToolPlan[];
  nextSuggestedCapabilities: CapabilityId[];
  requiresConfirmation: boolean;
  expectedArtifactKind: string;
};

export type DeliveryPlanStepStatus = "pending" | "awaiting_confirmation" | "running" | "succeeded" | "failed";

export type DeliveryPlanStep = {
  id: CapabilityId;
  capabilityId: CapabilityId;
  artifactKind: string;
  title: string;
  teacherDescription: string;
  status: DeliveryPlanStepStatus;
  requiresConfirmation: boolean;
};

export type DeliveryPlan = {
  id: string;
  title: string;
  summary: string;
  currentStepId: CapabilityId;
  steps: DeliveryPlanStep[];
};

export type SaveArtifactDraft = {
  nodeKey: string;
  kind: string;
  title: string;
  summary: string;
  markdownContent?: string;
  structuredContent?: Record<string, unknown>;
};

export type CapabilityRunResult =
  | {
      status: "succeeded";
      artifactDraft: SaveArtifactDraft;
      assistantSummary: string;
      providerStatus: "real" | "deterministic_draft";
    }
  | {
      status: "needs_input";
      missingInputs: string[];
      assistantPrompt: string;
    }
  | {
      status: "failed";
      userMessage: string;
      retryable: boolean;
      errorCategory: "provider" | "validation" | "permission" | "timeout" | "unknown";
    };

export type QuickReply = {
  label: string;
  prompt: string;
  recommended?: boolean;
};

export type RecommendedOption = {
  slot?: string;
  label: string;
  value: string;
  recommended?: boolean;
};

export type MainAgentState =
  | "chatting"
  | "exploring"
  | "collecting_inputs"
  | "awaiting_confirmation"
  | "planning_tools"
  | "running_tool"
  | "needs_input"
  | "failed_retryable"
  | "failed_blocked"
  | "succeeded"
  | "continuing_workflow";

export type MainAgentTurn = {
  assistantMessage: {
    title?: string;
    body: string;
  };
  state: MainAgentState;
  quickReplies: QuickReply[];
  recommendedOptions: RecommendedOption[];
  toolPlan?: CapabilityToolPlan;
  deliveryPlan?: DeliveryPlan;
  shouldRunToolNow: boolean;
  runtimeKind: "openai" | "deterministic";
  artifactRefs?: string[];
};
