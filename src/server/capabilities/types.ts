export type CapabilityId =
  | "requirement_spec"
  | "lesson_plan"
  | "ppt_outline"
  | "ppt_design"
  | "ppt_sample_assets"
  | "ppt_key_samples"
  | "ppt_full_assets"
  | "ppt_full_deck"
  | "ppt_page_repair"
  | "coze_ppt"
  | "image_asset"
  | "intro_video"
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
  | "final_package";

export type ProviderMode = "internal" | "external" | "package";

export type CapabilityDefinition = {
  id: CapabilityId;
  userLabel: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  upstreamCapabilities: CapabilityId[];
  artifactKind: string;
  requiresConfirmation: boolean;
  providerMode: ProviderMode;
  failureRecovery: {
    retryable: boolean;
    userMessage: string;
  };
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
      providerStatus: "real";
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
      errorCategory: "provider" | "network" | "validation" | "permission" | "timeout" | "parse" | "missing_field" | "unknown";
      reasonCode?: string;
      reasonDetails?: string[];
      runtimeRun?: {
        runId: string;
        runtimeKind: "openai";
        status: "failed";
      };
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
  runtimeKind: "openai";
  artifactRefs?: string[];
  failure?: import("@/server/conversation/main-agent-failure").MainAgentFailure;
};
