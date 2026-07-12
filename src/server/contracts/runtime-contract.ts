import { getPublishedNodeContractByCapabilityId } from "./node-contract-registry";
import type { ToolDefinition } from "@/server/tools/tool-types";

export type ContractEnforcement = "must" | "should" | "may";

export type RuntimeContractRule = {
  ruleId: string;
  enforcement: ContractEnforcement;
  description: string;
  source: "tool_definition" | "published_node_contract";
};

export type RuntimeContract = {
  id: string;
  version: string;
  toolId: string;
  capabilityId: string;
  requiredArtifactKinds: string[];
  outputArtifactKind?: string;
  outputNodeKey?: string;
  hardRules: RuntimeContractRule[];
  advisoryRules: RuntimeContractRule[];
};

export function resolveRuntimeContract(tool: ToolDefinition): RuntimeContract {
  const capabilityId = tool.capabilityId ?? "unknown";
  const published = findPublishedContract(capabilityId);
  const hardRules: RuntimeContractRule[] = [
    ...tool.requiredArtifactKinds.map((kind) => ({
      ruleId: `required_input:${kind}`,
      enforcement: "must" as const,
      description: `Requires an approved ${kind} artifact from this project.`,
      source: "tool_definition" as const,
    })),
    ...(tool.producedArtifactKind
      ? [{
          ruleId: "output_kind",
          enforcement: "must" as const,
          description: `Output kind must be ${tool.producedArtifactKind}.`,
          source: "tool_definition" as const,
        }, {
          ruleId: "output_node",
          enforcement: "must" as const,
          description: `Output node must be ${tool.producedArtifactKind}.`,
          source: "tool_definition" as const,
        }]
      : []),
    ...(tool.adapterKind === "provider"
      ? [{
          ruleId: "artifact_truth",
          enforcement: "must" as const,
          description: "Provider output must include persisted, non-placeholder artifact truth.",
          source: "tool_definition" as const,
        }, {
          ruleId: "provider_quality_gate",
          enforcement: "must" as const,
          description: "Provider output must pass its deterministic quality gate.",
          source: "tool_definition" as const,
        }]
      : []),
  ];

  // Legacy published contracts contain prose only. Until a deterministic validator
  // is assigned, those rules can guide critique but cannot block execution.
  const advisoryRules = published
    ? [
        ...published.constraints.map((description, index) => advisoryRule(`constraint:${index}`, description)),
        ...published.forbidden.map((description, index) => advisoryRule(`forbidden:${index}`, description)),
        ...published.qualityGates.map((description, index) => advisoryRule(`quality_gate:${index}`, description)),
      ]
    : [];

  return {
    id: published?.id ? `tool:${tool.id}+node:${published.id}` : `tool:${tool.id}`,
    version: published?.version ? `tool-v1+${published.version}` : "tool-v1",
    toolId: tool.id,
    capabilityId,
    requiredArtifactKinds: [...tool.requiredArtifactKinds],
    outputArtifactKind: tool.producedArtifactKind,
    outputNodeKey: tool.producedArtifactKind,
    hardRules,
    advisoryRules,
  };
}

function advisoryRule(ruleId: string, description: string): RuntimeContractRule {
  return {
    ruleId,
    enforcement: "should",
    description,
    source: "published_node_contract",
  };
}

function findPublishedContract(capabilityId: string) {
  try {
    return getPublishedNodeContractByCapabilityId(capabilityId);
  } catch {
    return undefined;
  }
}
