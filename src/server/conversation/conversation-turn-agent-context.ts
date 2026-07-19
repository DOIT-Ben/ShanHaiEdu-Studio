import { buildCapabilityAvailability, resolveRuntimeProviderAvailability } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { readActiveToolObservationsFromMessages } from "@/server/capabilities/tool-observation";
import { countSubmittedExternalProviderCalls, readAgentHarnessBudgetEventsFromMessages } from "./agent-harness-budget";
import { buildAgentWorldState } from "./agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "./conversation-context-builder";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { discloseStandardTaskBudget } from "@/server/guards/action-policy";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";

import { commitPreAgentControlTurn } from "./conversation-turn-control";
import { commitConversationTurnTaskState } from "./conversation-turn-task-state";
import {
  createStandardIntentGrant,
  ensureStandardTaskBudgetDisclosure,
  resolveActiveIntentGrant,
  resolveActiveTaskBrief,
} from "./conversation-turn-task-intake";
import type {
  ConversationTurnExecutionInput,
  LoadedConversationTurnState,
  MessageTurnResponse,
} from "./conversation-turn-types";
import { buildSemanticContextSnapshot, type SemanticContextSnapshot } from "./context-semantic-snapshot";
import type { DialogueCheckpoint } from "./dialogue-checkpoint";
import { createMainAgentToolLoopOptions } from "./main-agent-tool-loop-config";
import { rebindMainAgentReActCheckpointAuthorization, type MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import {
  readAgentObservationsFromMessages,
  readLatestRunCheckpointFromMessages,
} from "./react-control";
import {
  withPendingDecisionStatus,
  type IntentGrant,
  type PendingDecision,
  type TaskBrief,
} from "./task-contract";

export type PreparedConversationAgentTurn = {
  kind: "agent";
  project: LoadedConversationTurnState["project"];
  triggerMessage: ConversationTurnExecutionInput["triggerMessage"];
  turnJobId: string | null;
  taskBrief?: TaskBrief;
  intentGrant?: IntentGrant;
  taskAggregate: Awaited<ReturnType<ConversationTurnExecutionInput["controlPlaneStore"]["getTaskAggregate"]>>;
  precomputedTurn?: Awaited<ReturnType<ConversationTurnExecutionInput["agent"]["respond"]>>;
  availableArtifactKinds: string[];
  projectContext: { grade: string | null; subject: string | null; topic: string | null };
  conversationContext: ReturnType<typeof contextPackageToMainAgentConversationContext>;
  agentToolLoop?: ReturnType<typeof createMainAgentToolLoopOptions>;
  onProgress: LoadedConversationTurnState["onProgress"];
};

export async function prepareConversationAgentTurn(
  input: ConversationTurnExecutionInput,
  state: LoadedConversationTurnState,
  answeredDialogueCheckpoint?: DialogueCheckpoint,
): Promise<{ kind: "control"; response: MessageTurnResponse } | PreparedConversationAgentTurn> {
  const turnJobs = await input.service.getConversationTurnJobs(input.projectId);
  const turnJobId = turnJobs.find((job) => job.teacherMessageId === input.triggerMessage.id)?.id ?? null;
  const taskIntake = state.queuedTaskBrief
    ? { taskBrief: state.queuedTaskBrief }
    : answeredDialogueCheckpoint && state.previousTaskBrief
      ? { taskBrief: state.previousTaskBrief }
      : await resolveActiveTaskBrief({
          messages: state.messages,
          message: input.triggerMessage,
          project: state.project,
          agent: input.agent,
          activeTask: state.previousTaskBrief,
          onProgress: state.onProgress,
          turnJobId,
        });
  if (taskIntake.control) {
    return {
      kind: "control",
      response: await commitPreAgentControlTurn({
        service: input.service,
        project: state.project,
        messages: state.messages,
        pendingDecision: state.pendingDecision,
        previousSnapshot: state.previousSnapshot?.snapshot,
        triggerMessage: input.triggerMessage,
        control: taskIntake.control,
        replacementProposal: taskIntake.replacementProposal,
        previousTaskBrief: state.previousTaskBrief,
        controlPlaneStore: input.controlPlaneStore,
      }),
    };
  }

  const taskBrief = taskIntake.taskBrief ?? (state.confirmedActionId ? state.previousTaskBrief : undefined);
  state.progressTaskRef.current = taskBrief;
  let intentGrant = resolveIntentGrant(state, taskBrief);
  const confirmedPendingDecision = state.pendingDecision?.actionId === state.confirmedActionId
    ? state.pendingDecision
    : undefined;
  if (taskBrief && intentGrant && confirmedPendingDecision) {
    intentGrant = applyConfirmedPendingDecision(intentGrant, taskBrief, confirmedPendingDecision);
  }
  let taskAggregate: PreparedConversationAgentTurn["taskAggregate"] = null;
  let taskEventSequence = 0;
  if (taskBrief && intentGrant) {
    const committed = await commitConversationTurnTaskState({
      service: input.service,
      controlPlaneStore: input.controlPlaneStore,
      projectId: input.projectId,
      triggerMessage: input.triggerMessage,
      taskBrief,
      intentGrant,
      confirmedPendingDecision,
      previousSnapshot: state.previousSnapshot?.snapshot,
    });
    taskAggregate = committed.taskAggregate;
    taskEventSequence = committed.taskEventSequence;
    input.triggerMessage = committed.triggerMessage;
    const triggerIndex = state.messages.findIndex((message) => message.id === input.triggerMessage.id);
    if (triggerIndex >= 0) state.messages[triggerIndex] = input.triggerMessage;
  }
  return buildAgentContext(input, state, {
    taskBrief,
    intentGrant,
    taskAggregate,
    taskEventSequence,
    answeredDialogueCheckpoint,
    confirmedPendingDecision,
    turnJobs,
    turnJobId,
    precomputedTurn: taskIntake.precomputedTurn,
  });
}

function resolveIntentGrant(state: LoadedConversationTurnState, taskBrief?: TaskBrief) {
  if (!taskBrief) return undefined;
  return ensureStandardTaskBudgetDisclosure(
    (state.previousAggregate?.taskBrief.taskId === taskBrief.taskId ? state.previousAggregate.intentGrant : undefined)
      ?? resolveActiveIntentGrant(state.messages, taskBrief)
      ?? createStandardIntentGrant(taskBrief),
    taskBrief,
  );
}

async function buildAgentContext(
  input: ConversationTurnExecutionInput,
  state: LoadedConversationTurnState,
  task: {
    taskBrief?: TaskBrief;
    intentGrant?: IntentGrant;
    taskAggregate: PreparedConversationAgentTurn["taskAggregate"];
    taskEventSequence: number;
    answeredDialogueCheckpoint?: DialogueCheckpoint;
    confirmedPendingDecision?: PendingDecision;
    turnJobs: Awaited<ReturnType<ConversationTurnExecutionInput["service"]["getConversationTurnJobs"]>>;
    turnJobId: string | null;
    precomputedTurn?: PreparedConversationAgentTurn["precomputedTurn"];
  },
): Promise<PreparedConversationAgentTurn> {
  const artifacts = await input.service.getArtifacts(input.projectId);
  const generationJobs = await input.service.getGenerationJobs(input.projectId);
  const availableArtifactKinds = artifacts
    .filter((artifact) => isArtifactTrustedForDownstream(artifact) &&
      (!task.taskBrief || isArtifactBoundToTask(artifact, task.taskBrief)))
    .map((artifact) => artifact.kind);
  const toolObservations = readActiveToolObservationsFromMessages(state.messages);
  const agentObservations = readAgentObservationsForCurrentIntent(state.messages, state.project.intentEpoch ?? 0);
  const agentToolReports = readAgentToolReportsFromMessages(state.messages);
  const runCheckpoint = readLatestRunCheckpointFromMessages(state.messages);
  const budgetEvents = readBudgetEventsForCurrentIntent(state.messages, state.project.intentEpoch ?? 0);
  const semanticSnapshot = await persistCurrentSemanticSnapshot(input, state, task, artifacts, agentObservations);
  const contextPackage = buildConversationContextPackage({
    project: state.project,
    messages: state.messages,
    artifacts,
    taskBrief: task.taskBrief,
  });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
    taskBrief: task.taskBrief,
  });
  const agentWorldState = buildAgentWorldState({
    project: state.project,
    taskBrief: task.taskBrief ?? null,
    taskPlanRevision: task.taskAggregate?.plan.revision ?? null,
    artifacts,
    generationJobs,
    turnJobs: task.turnJobs,
    pendingDecision: task.confirmedPendingDecision ? null : state.pendingDecision ?? null,
    toolObservations,
    agentObservations,
    agentToolReports,
    runCheckpoint,
  });
  const resumeCheckpoint = resolveResumeCheckpoint(input, task);
  const agentToolLoop = task.taskBrief ? createMainAgentToolLoopOptions({
    service: input.service,
    runtime: input.runtime,
    project: state.project,
    triggerMessage: input.triggerMessage,
    artifacts,
    identity: input.executionIdentity,
    fence: input.executionFence,
    executor: input.agentToolExecutor,
    intentGrant: task.intentGrant,
    taskBrief: task.taskBrief,
    externalProviderCallsUsed: countSubmittedExternalProviderCalls(budgetEvents),
    planRevision: task.taskAggregate?.plan.revision,
    resumeCheckpoint,
    controlPlaneStore: input.controlPlaneStore,
    businessSkillRuntime: input.businessSkillRuntime,
    businessSkillRuntimeMode: input.businessSkillRuntimeMode,
  }) : undefined;
  return {
    kind: "agent",
    project: state.project,
    triggerMessage: input.triggerMessage,
    turnJobId: task.turnJobId,
    taskBrief: task.taskBrief,
    intentGrant: task.intentGrant,
    taskAggregate: task.taskAggregate,
    precomputedTurn: task.precomputedTurn,
    availableArtifactKinds,
    projectContext: {
      grade: state.project.grade,
      subject: state.project.subject,
      topic: state.project.lessonTopic,
    },
    conversationContext: contextPackageToMainAgentConversationContext(
      contextPackage,
      agentWorldState,
      capabilityAvailability,
      semanticSnapshot,
    ),
    agentToolLoop,
    onProgress: state.onProgress,
  };
}

async function persistCurrentSemanticSnapshot(
  input: ConversationTurnExecutionInput,
  state: LoadedConversationTurnState,
  task: {
    taskBrief?: TaskBrief;
    taskAggregate: PreparedConversationAgentTurn["taskAggregate"];
    taskEventSequence: number;
    answeredDialogueCheckpoint?: DialogueCheckpoint;
    confirmedPendingDecision?: PendingDecision;
  },
  artifacts: Awaited<ReturnType<ConversationTurnExecutionInput["service"]["getArtifacts"]>>,
  agentObservations: ReturnType<typeof readAgentObservationsFromMessages>,
): Promise<SemanticContextSnapshot | undefined> {
  if (!task.taskBrief || !task.taskAggregate) return undefined;
  const snapshot = buildSemanticContextSnapshot({
    taskBrief: task.taskBrief,
    plan: task.taskAggregate.plan,
    pendingDecision: task.answeredDialogueCheckpoint
      ?? (task.confirmedPendingDecision
        ? withPendingDecisionStatus(task.confirmedPendingDecision, "confirmed")
        : state.pendingDecision)
      ?? null,
    trustedArtifactRefs: artifacts
      .filter((artifact) => isArtifactTrustedForDownstream(artifact) && isArtifactBoundToTask(artifact, task.taskBrief!))
      .map((artifact) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
        digest: hashArtifactDraft({
          nodeKey: artifact.nodeKey,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          markdownContent: artifact.markdownContent,
          structuredContent: artifact.structuredContent,
        }),
        taskId: task.taskBrief!.taskId,
        taskBriefDigest: task.taskBrief!.digest,
        intentEpoch: task.taskBrief!.intentEpoch,
        bindingSource: artifact.taskBriefDigest
          ? "tool_execution" as const
          : artifact.origin === "teacher_input"
            ? "current_intent_teacher_input" as const
            : "current_intent_compatibility" as const,
      })),
    observationRefs: agentObservations.map((observation) => ({
      observationId: observation.observationId,
      reasonCodes: observation.reasonCodes,
      intentEpoch: task.taskBrief!.intentEpoch,
    })),
    recentMessages: state.messages.map((message) => ({ role: message.role, content: message.content })),
  });
  await input.controlPlaneStore.saveSemanticSnapshot(snapshot, task.taskEventSequence);
  return snapshot;
}

function resolveResumeCheckpoint(
  input: ConversationTurnExecutionInput,
  task: {
    taskBrief?: TaskBrief;
    intentGrant?: IntentGrant;
    taskAggregate: PreparedConversationAgentTurn["taskAggregate"];
    answeredDialogueCheckpoint?: DialogueCheckpoint;
    confirmedPendingDecision?: PendingDecision;
  },
) {
  const checkpoint = task.taskAggregate?.checkpoint;
  const shouldResume = checkpoint?.schemaVersion === "react-checkpoint.v1" &&
    (task.taskBrief?.sourceMessageId === input.triggerMessage.id || Boolean(task.answeredDialogueCheckpoint) ||
      Boolean(task.confirmedPendingDecision));
  if (!shouldResume) return undefined;
  return task.confirmedPendingDecision && task.intentGrant
    ? rebindMainAgentReActCheckpointAuthorization(checkpoint as MainAgentReActCheckpoint, {
        standardWorkAuthorized: task.intentGrant.standardWorkAuthorized,
        budgetPolicyVersion: task.intentGrant.budgetPolicyVersion,
        maxCostCredits: task.intentGrant.maxCostCredits,
        maxExternalProviderCalls: task.intentGrant.maxExternalProviderCalls,
      })
    : checkpoint;
}

function readAgentObservationsForCurrentIntent(
  messages: LoadedConversationTurnState["messages"],
  intentEpoch: number,
) {
  return readAgentObservationsFromMessages(messages.slice(findCurrentIntentBoundary(messages, intentEpoch)));
}

function readBudgetEventsForCurrentIntent(messages: LoadedConversationTurnState["messages"], intentEpoch: number) {
  return readAgentHarnessBudgetEventsFromMessages(messages.slice(findCurrentIntentBoundary(messages, intentEpoch)));
}

function findCurrentIntentBoundary(messages: LoadedConversationTurnState["messages"], intentEpoch: number) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const impact = messages[index].metadata.conversationControlImpact;
    if (!impact || typeof impact !== "object" || Array.isArray(impact)) continue;
    const record = impact as Record<string, unknown>;
    if (record.nextIntentEpoch === intentEpoch && record.previousIntentEpoch !== record.nextIntentEpoch) return index;
  }
  return 0;
}

function applyConfirmedPendingDecision(
  grant: IntentGrant,
  taskBrief: TaskBrief,
  decision: PendingDecision,
): IntentGrant {
  if (decision.kind === "authorization") {
    return ensureStandardTaskBudgetDisclosure({ ...grant, standardWorkAuthorized: true }, taskBrief);
  }
  if (decision.kind === "budget_disclosure") return discloseStandardTaskBudget(grant, taskBrief);
  if (decision.kind === "budget_upgrade") {
    return {
      ...grant,
      budgetPolicyVersion: decision.budgetPolicyVersion,
      maxCostCredits: decision.maxCostCredits,
      maxExternalProviderCalls: decision.maxExternalProviderCalls,
    };
  }
  return grant;
}
