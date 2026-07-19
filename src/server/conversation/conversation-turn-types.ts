import type { AgentRuntime } from "@/server/agent-runtime/types";
import type { MainAgentTurn } from "@/server/capabilities/types";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { BusinessToolSkillRuntime } from "@/server/skills/business-tool-skill-runtime";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type {
  ArtifactRecord,
  ConversationMessageRecord,
  ExecutionIdentitySnapshot,
  ProjectExecutionFence,
  ProjectRecord,
} from "@/server/workbench/types";

import type { createControlPlaneStore } from "./control-plane-store";
import type { MainConversationAgent } from "./main-conversation-agent";
import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import type { PendingDecision, TaskBrief } from "./task-contract";

export type WorkbenchService = ReturnType<typeof createWorkbenchService>;
export type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

export type MessageTurnResponse = {
  message: ConversationMessageRecord;
  assistantMessage?: ConversationMessageRecord;
  agentTurn?: MainAgentTurn;
  artifact?: ArtifactRecord;
  result?: unknown;
};

export type ConversationTurnExecutionInput = {
  service: WorkbenchService;
  runtime: AgentRuntime;
  agent: MainConversationAgent;
  projectId: string;
  teacherContent: string;
  confirmedActionId?: string;
  triggerMessage: ConversationMessageRecord;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionFence?: ProjectExecutionFence;
  generationIntensityOverride?: GenerationIntensity;
  controlPlaneStore: ControlPlaneStore;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode: "optional" | "required";
  executionSource: "new_message" | "queued_message";
};

export type LoadedConversationTurnState = {
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  queuedTaskBrief?: TaskBrief;
  progressTaskRef: { current?: TaskBrief };
  onProgress: MainAgentProgressSink;
  previousIntentEpoch: number;
  previousTaskBrief?: TaskBrief;
  previousAggregate: Awaited<ReturnType<ControlPlaneStore["getTaskAggregate"]>>;
  previousSnapshot: Awaited<ReturnType<ControlPlaneStore["getLatestSemanticSnapshot"]>>;
  pendingDecision?: PendingDecision;
  confirmedActionId?: string;
  submittedActionId?: string;
};
