import type { CapabilityId } from "@/server/capabilities/types";
import type { SaveArtifactDraft } from "@/server/capabilities/types";
import type { ToolObservation } from "@/server/capabilities/tool-observation";
import type { AgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";

export type ToolAdapterKind = "internal_capability" | "provider" | "mcp";

export type ToolSideEffectLevel = "none" | "artifact_write" | "external_call" | "file_write" | "package_write";

export type ToolFailurePolicy = {
  retryable: boolean;
  maxRetries: number;
  onFailure: "record_observation";
};

export type JsonSchemaObject = Record<string, unknown> & {
  type: "object";
  additionalProperties: false;
  properties?: Record<string, unknown>;
  required?: string[];
};

export type ToolDefinition = {
  id: string;
  label: string;
  description: string;
  adapterKind: ToolAdapterKind;
  capabilityId?: CapabilityId;
  providerToolId?: string;
  mcpServerId?: string;
  mcpToolName?: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  requiresHumanGate: boolean;
  sideEffectLevel: ToolSideEffectLevel;
  requiredArtifactKinds: string[];
  producedArtifactKind?: string;
  failurePolicy: ToolFailurePolicy;
  implemented: boolean;
  blockedReason?: string;
};

export type OpenAiFunctionToolSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  strict: true;
};

export type ToolExecutionResult =
  | {
      status: "succeeded";
      toolId: string;
      capabilityId: string;
      artifactDraft: SaveArtifactDraft;
      assistantSummary: string;
      budgetEvent: AgentHarnessBudgetEvent;
    }
  | {
      status: "needs_input";
      toolId: string;
      capabilityId: string;
      missingInputs: string[];
      assistantPrompt: string;
      artifactCreated: false;
      budgetEvent: AgentHarnessBudgetEvent;
    }
  | {
      status: "failed" | "retryable_failed";
      toolId: string;
      capabilityId: string;
      observation: ToolObservation;
      artifactCreated: false;
      errorCategory?: string;
      budgetEvent: AgentHarnessBudgetEvent;
    };
