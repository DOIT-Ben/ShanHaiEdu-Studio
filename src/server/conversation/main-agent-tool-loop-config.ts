import { resolveStandardTaskBudget } from "@/server/guards/task-budget-policy";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

import { createControlPlaneStore } from "./control-plane-store";
import type { MainConversationAgentInput } from "./main-conversation-agent";
import { restoreMainAgentReActCheckpoint, type MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import { describeTeacherVisibleToolCall } from "./main-agent-tool-description";
import { createMainAgentToolLoopCheckpointHandlers } from "./main-agent-tool-loop-checkpoints";
import { createMainAgentToolDispatch } from "./main-agent-tool-loop-dispatch";
import { appendMainAgentToolExposureTrace, readMainAgentToolExposureTrace } from "./main-agent-tool-loop-metadata";
import { createMainAgentToolQualification } from "./main-agent-tool-qualification";
import type {
  CreateMainAgentToolLoopOptionsInput,
  MainAgentToolLoopContext,
  MainAgentToolLoopState,
} from "./main-agent-tool-loop-types";
import { evaluateTaskCompletionContract } from "./task-completion-contract";

export type { CreateMainAgentToolLoopOptionsInput } from "./main-agent-tool-loop-types";

export function createMainAgentToolLoopOptions(
  input: CreateMainAgentToolLoopOptionsInput,
): MainConversationAgentInput["agentToolLoop"] | undefined {
  const controlPlaneStore = input.controlPlaneStore ?? createControlPlaneStore();
  if (!input.identity || !input.fence) return undefined;
  const qualification = createMainAgentToolQualification(input);
  const initialDefinitions = qualification.qualifiedDefinitions();
  if (!input.taskBrief && initialDefinitions.length === 0) return undefined;
  const state: MainAgentToolLoopState = {
    definitions: initialDefinitions,
    currentMetadata: structuredClone(input.triggerMessage.metadata),
    externalProviderCallsUsed: input.externalProviderCallsUsed ?? 0,
    currentPlanRevision: input.planRevision ?? 0,
    toolExposureSequence: readMainAgentToolExposureTrace(input.triggerMessage.metadata).length,
  };
  const context: MainAgentToolLoopContext = {
    input,
    controlPlaneStore,
    state,
    taskArtifacts: qualification.taskArtifacts,
    qualifiedDefinitions: qualification.qualifiedDefinitions,
  };
  const taskBudget = input.taskBrief ? resolveStandardTaskBudget(input.taskBrief) : undefined;
  const resumeCheckpoint = input.resumeCheckpoint
    ? restoreMainAgentReActCheckpoint(input.resumeCheckpoint as MainAgentReActCheckpoint)
    : undefined;
  const refreshTools = () => exposeQualifiedTools(context);
  const checkpointHandlers = createMainAgentToolLoopCheckpointHandlers(context);
  return {
    tools: state.definitions.map(toolDefinitionToOpenAiFunctionTool),
    allowedToolNames: state.definitions.map((tool) => tool.transportName),
    prepareTools: refreshTools,
    refreshTools,
    describeToolCall: (call) => describeTeacherVisibleToolCall({
      toolName: call.toolName,
      definitions: state.definitions,
      taskBrief: input.taskBrief,
      artifacts: context.taskArtifacts(),
    }),
    validateCompletion: () => evaluateTaskCompletionContract(input.taskBrief, input.artifacts),
    maxToolRounds: taskBudget?.maxToolRounds ?? 8,
    maxToolRoundsPerSegment: input.taskBrief && input.intentGrant ? 8 : undefined,
    resumeCheckpoint,
    getCheckpointSeed: () => ({
      projectId: input.project.id,
      taskId: input.taskBrief?.taskId ?? null,
      taskBriefDigest: input.taskBrief?.digest ?? null,
      intentEpoch: input.project.intentEpoch ?? null,
      planRevision: state.currentPlanRevision,
      generationIntensity: input.project.generationIntensity ?? null,
      authorization: {
        standardWorkAuthorized: input.intentGrant?.standardWorkAuthorized ?? false,
        budgetPolicyVersion: input.intentGrant?.budgetPolicyVersion ?? null,
        maxCostCredits: input.intentGrant?.maxCostCredits ?? null,
        maxExternalProviderCalls: input.intentGrant?.maxExternalProviderCalls ?? null,
      },
    }),
    ...checkpointHandlers,
    dispatch: createMainAgentToolDispatch(context),
  };
}

async function exposeQualifiedTools(context: MainAgentToolLoopContext) {
  const { input, state } = context;
  state.definitions = context.qualifiedDefinitions();
  state.currentMetadata = appendMainAgentToolExposureTrace(state.currentMetadata, {
    sequence: ++state.toolExposureSequence,
    event: "tools_exposed",
    intentEpoch: input.project.intentEpoch ?? 0,
    allowedToolNames: state.definitions.map((tool) => tool.transportName),
  });
  await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, state.currentMetadata);
  return {
    tools: state.definitions.map(toolDefinitionToOpenAiFunctionTool),
    allowedToolNames: state.definitions.map((tool) => tool.transportName),
  };
}
