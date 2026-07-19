import type { AgentRuntime } from "@/server/agent-runtime/types";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import type { BusinessToolSkillRuntime } from "@/server/skills/business-tool-skill-runtime";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type {
  ArtifactRecord,
  ConversationMessageRecord,
  ExecutionIdentitySnapshot,
  ProjectExecutionFence,
  ProjectRecord,
} from "@/server/workbench/types";

import type { createControlPlaneStore } from "./control-plane-store";
import type { DialogueCheckpoint } from "./dialogue-checkpoint";
import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import type { IntentGrant, PendingDecision, TaskBrief } from "./task-contract";

export type CreateMainAgentToolLoopOptionsInput = {
  service: ReturnType<typeof createWorkbenchService>;
  project: ProjectRecord;
  triggerMessage: ConversationMessageRecord;
  artifacts: ArtifactRecord[];
  identity?: ExecutionIdentitySnapshot;
  fence?: ProjectExecutionFence;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  intentGrant?: IntentGrant;
  taskBrief?: TaskBrief;
  planRevision?: number;
  externalProviderCallsUsed?: number;
  businessToolRouter?: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  runtime?: AgentRuntime;
  controlPlaneStore?: ReturnType<typeof createControlPlaneStore>;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode?: "optional" | "required";
  resumeCheckpoint?: MainAgentReActCheckpoint | Record<string, unknown> | null;
};

export type MainAgentToolLoopState = {
  definitions: MainAgentToolDefinition[];
  currentMetadata: Record<string, unknown>;
  externalProviderCallsUsed: number;
  currentPlanRevision: number;
  latestPptDirectorPlan?: PptDirectorPlanBinding;
  activeDialogueCheckpoint?: DialogueCheckpoint;
  activeHumanGateDecision?: PendingDecision;
  toolExposureSequence: number;
};

export type MainAgentToolLoopContext = {
  input: CreateMainAgentToolLoopOptionsInput;
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  state: MainAgentToolLoopState;
  taskArtifacts: () => ArtifactRecord[];
  qualifiedDefinitions: () => MainAgentToolDefinition[];
};

export type MainAgentToolLoopCall = {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type MainAgentToolLoopDispatch = (
  call: MainAgentToolLoopCall,
) => Promise<MainAgentReActDispatchResult>;
