import type { ToolObservation } from "@/server/capabilities/tool-observation";
import type { AgentToolReviewTargetRef } from "./agent-tool-invocation";
import type { JsonSchemaObject, ToolDefinition } from "./tool-types";

export const agentToolIds = [
  "ppt_director.plan_or_repair",
  "video_director.plan_or_repair",
  "delivery_critic.review",
] as const;

export type AgentToolId = (typeof agentToolIds)[number];

export type AgentToolTransportName =
  | "ppt_director_plan_or_repair"
  | "video_director_plan_or_repair"
  | "delivery_critic_review";

export type AgentToolProfileId = "ppt_director" | "video_director" | "delivery_critic";

export type AgentToolContractRef = {
  id: string;
  version: string;
};

export type AgentToolDefinition = Omit<
  ToolDefinition,
  "id" | "adapterKind" | "capabilityId" | "producedArtifactKind" | "sideEffectLevel" | "requiresHumanGate"
> & {
  id: AgentToolId;
  transportName: AgentToolTransportName;
  adapterKind: "agent";
  capabilityId?: never;
  producedArtifactKind?: never;
  sideEffectLevel: "none";
  requiresHumanGate: false;
  agentProfileId: AgentToolProfileId;
  inputContract: AgentToolContractRef;
  outputContract: AgentToolContractRef;
  executionSideEffectLevel: "none";
  resultPersistencePolicy: "report_artifact";
  persistenceSideEffectLevel: "artifact_write";
  contractReady: boolean;
  executorReady: boolean;
  mainAgentExecutable: boolean;
  modelVisible: boolean;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
};

export type AgentToolExecutionSucceededResult = {
  status: "succeeded";
  toolId: AgentToolId;
  invocationId: string;
  structuredOutput: Record<string, unknown>;
  assistantSummary: string;
  artifactCreated: false;
};

export type AgentToolReviewBinding = {
  projectId: string;
  intentEpoch: number;
  sourceMessageId: string;
  invocationId: string;
  agentProfileId: AgentToolProfileId;
  executorSource: "unverified_injected";
  productionEligible: false;
  reviewTargetRef: AgentToolReviewTargetRef;
  rubricRef: { id: string; version: string; digest: string };
  generatorInvocationId: string;
  inputHash: string;
  actionDigest: string;
};

export type AgentToolPolicyOutcome = {
  gateId: "video_director_candidate" | "video_course_anchor_critic";
  passed: boolean;
  eligibleForDownstreamGuard: boolean;
  reviewOutcome:
    | "candidate_ready_for_critic"
    | "eligible_for_downstream_guard"
    | "rework_required"
    | "blocked"
    | "inconclusive";
  reasonCodes: string[];
  forbiddenNextToolIntents: string[];
  reviewBinding?: AgentToolReviewBinding;
};

export type AgentToolRoutedSucceededResult = AgentToolExecutionSucceededResult & {
  policyOutcome?: AgentToolPolicyOutcome;
};

export type AgentToolExecutionFailedResult = {
  status: "needs_input" | "failed" | "inconclusive";
  toolId: AgentToolId;
  invocationId: string;
  observation: ToolObservation;
  artifactCreated: false;
  errorCategory?: string;
};

export type AgentToolExecutionResult = AgentToolExecutionSucceededResult | AgentToolExecutionFailedResult;

export type AgentToolRoutedExecutionResult = AgentToolRoutedSucceededResult | AgentToolExecutionFailedResult;

export type AgentToolExecutor<TInvocation = unknown> = (
  invocation: TInvocation,
  definition: AgentToolDefinition,
) => Promise<AgentToolExecutionResult>;

export function isAgentToolResultEligibleForProductionGuard(result: {
  status: string;
  policyOutcome?: AgentToolPolicyOutcome;
}): boolean {
  return result.status === "succeeded" &&
    result.policyOutcome?.passed === true &&
    result.policyOutcome.eligibleForDownstreamGuard === true &&
    Boolean(result.policyOutcome.reviewBinding?.productionEligible);
}
