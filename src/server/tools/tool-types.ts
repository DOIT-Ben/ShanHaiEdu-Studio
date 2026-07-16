import type { CapabilityId } from "@/server/capabilities/types";
import type { SaveArtifactDraft } from "@/server/capabilities/types";
import type { ToolObservation } from "@/server/capabilities/tool-observation";
import type { AgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import type { ValidationReport } from "@/server/quality/quality-types";

export type ToolAdapterKind = "internal_capability" | "agent" | "provider" | "package" | "mcp";

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
  teacherDescription?: string;
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

export type ToolArtifactTruth = {
  created: boolean;
  persisted: boolean;
  persistenceScope?: "provider_local_file" | "workbench_artifact" | "none";
  providerPersisted?: boolean;
  workbenchPersisted?: boolean;
  placeholder: boolean;
  producedArtifactKind: string;
};

export type ToolQualityGateResult = {
  passed: boolean;
  gates: string[];
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
      provider?: string;
      artifactDraft: SaveArtifactDraft;
      artifactTruth?: ToolArtifactTruth;
      qualityGate?: ToolQualityGateResult;
      providerPayload?: Record<string, unknown>;
      assistantSummary: string;
      budgetEvent: AgentHarnessBudgetEvent;
      validationReport?: ValidationReport;
    }
  | {
      status: "needs_input";
      toolId: string;
      capabilityId: string;
      provider?: string;
      missingInputs: string[];
      assistantPrompt: string;
      observation: ToolObservation;
      artifactCreated: false;
      budgetEvent: AgentHarnessBudgetEvent;
      validationReport?: ValidationReport;
    }
  | {
      status: "failed" | "retryable_failed";
      toolId: string;
      capabilityId: string;
      provider?: string;
      observation: ToolObservation;
      artifactCreated: false;
      errorCategory?: string;
      reasonCode?: string;
      reasonDetails?: string[];
      budgetEvent: AgentHarnessBudgetEvent;
      validationReport?: ValidationReport;
    };

export type RoutedToolExecutionResult = ToolExecutionResult & {
  validationReport: ValidationReport;
};

export function isVerifiedProviderToolSuccess(
  result: ToolExecutionResult,
): result is Extract<ToolExecutionResult, { status: "succeeded" }> & {
  provider: string;
  artifactTruth: ToolArtifactTruth;
  qualityGate: ToolQualityGateResult;
  validationReport: ValidationReport;
} {
  return (
    result.status === "succeeded" &&
    typeof result.provider === "string" &&
    result.provider.length > 0 &&
    result.artifactTruth?.created === true &&
    result.artifactTruth.persisted === true &&
    result.artifactTruth.placeholder === false &&
    result.qualityGate?.passed === true &&
    result.validationReport?.overallStatus === "passed"
  );
}
