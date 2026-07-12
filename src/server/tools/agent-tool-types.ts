import type { ToolObservation } from "@/server/capabilities/tool-observation";
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

export type AgentToolExecutionFailedResult = {
  status: "needs_input" | "failed" | "inconclusive";
  toolId: AgentToolId;
  invocationId: string;
  observation: ToolObservation;
  artifactCreated: false;
  errorCategory?: string;
};

export type AgentToolExecutionResult = AgentToolExecutionSucceededResult | AgentToolExecutionFailedResult;

export type AgentToolExecutor<TInvocation = unknown> = (
  invocation: TInvocation,
  definition: AgentToolDefinition,
) => Promise<AgentToolExecutionResult>;
