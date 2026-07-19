import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { getToolDefinition } from "@/server/tools/tool-registry";

export type ToolResultMode = "artifact_required" | "observation_only";
export type ToolResultContract = {
  resultMode: ToolResultMode;
  artifactKind: string | null;
  capabilityId: string | null;
  requiresGenerationEvidence: boolean;
  expectedGenerationKind: string | null;
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string | null;
};

export const TOOL_INVOCATION_AUDIT_VERSION = "tool-invocation-audit.v2" as const;

export function resolveServerToolResultMode(
  toolName: string,
  request: Record<string, unknown>,
): ToolResultMode {
  return resolveServerToolResultContract(toolName, request).resultMode;
}

export function resolveServerToolResultContract(
  toolName: string,
  request: Record<string, unknown>,
): ToolResultContract {
  const definition = resolveServerToolDefinition(toolName);
  if (definition.adapterKind === "agent") {
    if (definition.id === "delivery_critic.review" &&
        (request.domain === "ppt" || request.domain === "video")) {
      return {
        resultMode: "artifact_required", artifactKind: null, capabilityId: null, requiresGenerationEvidence: false,
        expectedGenerationKind: null, requiredArtifactKinds: [], primarySourceArtifactKind: null,
      };
    }
    return {
      resultMode: "observation_only", artifactKind: null, capabilityId: null, requiresGenerationEvidence: false,
      expectedGenerationKind: null, requiredArtifactKinds: [], primarySourceArtifactKind: null,
    };
  }
  return {
    resultMode: definition.producedArtifactKind ? "artifact_required" : "observation_only",
    artifactKind: definition.producedArtifactKind ?? null,
    capabilityId: definition.capabilityId ?? null,
    requiresGenerationEvidence: definition.adapterKind === "provider",
    expectedGenerationKind: definition.adapterKind === "provider"
      ? generationKindForArtifact(definition.producedArtifactKind)
      : null,
    requiredArtifactKinds: [...definition.requiredArtifactKinds],
    primarySourceArtifactKind: definition.adapterKind === "provider"
      ? definition.primarySourceArtifactKind ?? null
      : null,
  };
}

function generationKindForArtifact(artifactKind: string | undefined) {
  if (artifactKind === "pptx_artifact") return "pptx";
  if (artifactKind === "video_narration_generate") return "audio";
  if (artifactKind === "video_segment_generate") return "video";
  return "image";
}

export function createToolInvocationAuditPayload(resultMode: ToolResultMode) {
  return {
    schemaVersion: TOOL_INVOCATION_AUDIT_VERSION,
    resultMode,
  } as const;
}

export function readToolResultModeFromAuditPayload(payloadJson: string): ToolResultMode | null {
  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const source = payload as Record<string, unknown>;
    if (Object.keys(source).length !== 2 ||
        source.schemaVersion !== TOOL_INVOCATION_AUDIT_VERSION ||
        (source.resultMode !== "artifact_required" && source.resultMode !== "observation_only")) {
      return null;
    }
    return source.resultMode;
  } catch {
    return null;
  }
}

export function resolveServerToolDefinition(toolName: string) {
  try {
    return getToolDefinition(toolName);
  } catch {
    return resolveMainAgentToolDefinition(toolName);
  }
}
