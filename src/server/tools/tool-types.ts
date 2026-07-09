import type { CapabilityId } from "@/server/capabilities/types";

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
