import type { AgentRuntime } from "@/server/agent-runtime/types";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { readActiveToolObservationsFromMessages } from "@/server/capabilities/tool-observation";
import type { MainAgentTurn } from "@/server/capabilities/types";
import { countSubmittedExternalProviderCalls, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  clearRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  readAgentObservationsFromMessages,
  readLatestRunCheckpointFromMessages,
} from "@/server/conversation/react-control";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import {
  discloseStandardTaskBudget,
  STANDARD_BUDGET_POLICY_VERSION,
} from "@/server/guards/action-policy";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import { analyzePptRevisionImpact } from "@/server/ppt-quality/ppt-impact-analysis";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, ProjectExecutionFence, ProjectRecord } from "@/server/workbench/types";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import type { MainAgentTaskIntakeDecision, MainConversationAgent } from "./main-conversation-agent";
import { createMainAgentToolLoopOptions } from "./main-agent-tool-loop-config";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { hasValidTaskBrief, isPendingDecision, withPendingDecisionStatus, type IntentGrant, type PendingDecision, type TaskBrief } from "./task-contract";
import { createTaskBriefFromProposal } from "./task-intake";
import { resolvePreAgentControl, type PreAgentControlDecision } from "./turn-intake-control";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { MainAgentProgressEvent, MainAgentProgressSink } from "./main-agent-stream-projection";
import { createControlPlaneStore } from "./control-plane-store";
import { commitConversationTurnTaskState } from "./conversation-turn-task-state";
import {
  createConfiguredBusinessToolSkillRuntime,
  type BusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import { buildSemanticContextSnapshot, type SemanticContextSnapshot } from "./context-semantic-snapshot";
import { collectPersistentTeacherMessageParts } from "@/lib/teacher-agent-events";
import { answerDialogueCheckpoint, isDialogueCheckpoint, type DialogueCheckpoint } from "./dialogue-checkpoint";
import { rebindMainAgentReActCheckpointAuthorization, type MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import { runWithProviderCallTraceBinding } from "@/server/provider-ledger/provider-call-trace";
import {
  appendPendingDecisionPrompt,
  isPendingDecisionCancellation,
  isPendingDecisionConfirmation,
  persistPendingDecisionStatus,
  resolveCurrentPendingDecision,
} from "./pending-decision-lifecycle";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

async function resolveActiveTaskBrief(input: {
  messages: ConversationMessageRecord[];
  message: ConversationMessageRecord;
  project: ProjectRecord;
  agent: MainConversationAgent;
  forceProposal?: boolean;
  onProgress?: MainAgentProgressSink;
  activeTask?: TaskBrief;
  turnJobId: string | null;
}): Promise<{
  taskBrief?: TaskBrief;
  precomputedTurn?: MainAgentTurn;
  control?: PreAgentControlDecision;
  replacementProposal?: Parameters<typeof createTaskBriefFromProposal>[0]["proposal"];
}> {
  const { messages, message, project } = input;
  const messageTaskBrief = message.metadata.taskBrief;
  if (!input.forceProposal && isTaskBrief(messageTaskBrief) &&
      messageTaskBrief.projectId === project.id &&
      messageTaskBrief.intentEpoch === (project.intentEpoch ?? 0) &&
      messageTaskBrief.sourceMessageId === message.id) {
    return { taskBrief: messageTaskBrief };
  }
  if (!input.forceProposal && (isTaskControlMessage(message.content) || typeof message.metadata.confirmedActionId === "string")) {
    for (const candidate of [...messages].reverse()) {
      const brief = candidate.metadata.taskBrief;
      if (isTaskBrief(brief) && brief.projectId === project.id && brief.intentEpoch === (project.intentEpoch ?? 0)) {
        return { taskBrief: brief };
      }
    }
    return {};
  }

  let decision: MainAgentTaskIntakeDecision;
  if (input.agent.intakeTask) {
    decision = await runWithProviderCallTraceBinding({ projectId: project.id, taskId: input.activeTask?.taskId,
      teacherMessageId: message.id, turnJobId: input.turnJobId, intentEpoch: project.intentEpoch ?? 0, phase: "intake" }, () => input.agent.intakeTask!({
      userMessage: message.content,
      responseStyle: message.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
      generationIntensity: project.generationIntensity ?? "standard",
      projectContext: {
        grade: project.grade,
        subject: project.subject,
        topic: project.lessonTopic,
      },
      activeTask: input.activeTask,
      recentMessages: messages.map((candidate) => ({ role: candidate.role, content: candidate.content })).slice(-8),
      onProgress: input.onProgress,
    }));
  } else {
    throw new Error("Main Agent structured task intake is required.");
  }

  if (decision.kind === "control") {
    return { control: decision.control, replacementProposal: decision.replacementProposal };
  }
  if (decision.kind !== "task") {
    return { ...(decision.turn ? { precomputedTurn: decision.turn } : {}) };
  }
  const projectConstraints = [project.grade, project.subject, project.lessonTopic]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const taskBrief = createTaskBriefFromProposal({
    proposal: {
      ...decision.proposal,
      goal: message.content.trim(),
      constraints: [...new Set([...decision.proposal.constraints, ...projectConstraints])],
    },
    taskId: `task:${message.id}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: message.id,
    context: {
      grade: project.grade,
      subject: project.subject,
      textbookVersion: project.textbookVersion,
      lessonTopic: project.lessonTopic,
    },
  });
  return { taskBrief };
}

function isTaskControlMessage(content: string) {
  const normalized = content.trim();
  if (/^(继续|确定|确认|开始|暂停|恢复|取消|确认开始|继续下一步|继续推进|按这个计划推进|确认需求并生成大纲)(?:[，,].*)?[。.!！]?$/.test(normalized)) return true;
  return /^(?:继续|恢复|接着)(?:刚才|之前|当前|上次|这个|该)(?!.*(?:新的|改成|改做|换成|转为|只做|不要做|不做)).{0,80}$/.test(normalized);
}

function createStandardIntentGrant(brief: TaskBrief): IntentGrant {
  return discloseStandardTaskBudget({
    schemaVersion: "intent-grant.v1", taskId: brief.taskId, projectId: brief.projectId, intentEpoch: brief.intentEpoch,
    standardWorkAuthorized: true, intensity: brief.generationIntensity, budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
    maxCostCredits: null, maxExternalProviderCalls: null, requiredCheckpoints: [], expiresAt: null,
  }, brief);
}

function ensureStandardTaskBudgetDisclosure(grant: IntentGrant, brief: TaskBrief): IntentGrant {
  if (!grant.standardWorkAuthorized || grant.maxCostCredits !== null) return grant;
  const needsTaskScopedDisclosure =
    (grant.budgetPolicyVersion === STANDARD_BUDGET_POLICY_VERSION && grant.maxExternalProviderCalls === null) ||
    (grant.budgetPolicyVersion === "v1-standard" && grant.maxExternalProviderCalls === 3);
  return needsTaskScopedDisclosure
    ? discloseStandardTaskBudget({
        ...grant,
        budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
        maxExternalProviderCalls: null,
      }, brief)
    : grant;
}

function isTaskBrief(value: unknown): value is TaskBrief {
  return typeof value === "object" && value !== null && (value as TaskBrief).schemaVersion === "task-brief.v1";
}

async function resolveQueuedTaskBriefBinding(input: {
  message: ConversationMessageRecord;
  project: ProjectRecord;
  controlPlaneStore: ControlPlaneStore;
}): Promise<TaskBrief | undefined> {
  const candidate = input.message.metadata.taskBrief;
  if (candidate === undefined) return undefined;
  if (!isTaskBrief(candidate) || !hasValidTaskBrief(candidate) || candidate.projectId !== input.project.id ||
      candidate.intentEpoch !== (input.project.intentEpoch ?? 0) || candidate.sourceMessageId !== input.message.id) {
    throw new Error("queued_task_brief_binding_invalid");
  }
  const aggregate = await input.controlPlaneStore.getTaskAggregate(candidate.projectId, candidate.intentEpoch);
  if (!aggregate || aggregate.taskBrief.taskId !== candidate.taskId || aggregate.taskBrief.digest !== candidate.digest ||
      !["active", "paused_recovery"].includes(aggregate.status)) {
    throw new Error("queued_task_brief_binding_invalid");
  }
  return candidate;
}

function findTaskBriefForIntent(messages: ConversationMessageRecord[], projectId: string, intentEpoch: number) {
  for (const candidate of [...messages].reverse()) {
    const brief = candidate.metadata.taskBrief;
    if (isTaskBrief(brief) && brief.projectId === projectId && brief.intentEpoch === intentEpoch) return brief;
  }
  return undefined;
}

function isIntentGrant(value: unknown): value is IntentGrant {
  return typeof value === "object" && value !== null &&
    (value as IntentGrant).schemaVersion === "intent-grant.v1" &&
    typeof (value as IntentGrant).standardWorkAuthorized === "boolean";
}

function resolveActiveIntentGrant(messages: ConversationMessageRecord[], brief: TaskBrief): IntentGrant | undefined {
  for (const message of [...messages].reverse()) {
    const grant = message.metadata.intentGrant;
    if (!isIntentGrant(grant) || grant.projectId !== brief.projectId || grant.taskId !== brief.taskId || grant.intentEpoch !== brief.intentEpoch) continue;
    return {
      ...grant,
      maxExternalProviderCalls: typeof grant.maxExternalProviderCalls === "number" ? grant.maxExternalProviderCalls : null,
    };
  }
  return undefined;
}

export type ConversationTurnInput = {
  role?: "teacher" | "assistant" | "system";
  content: string;
  reference?: string;
  artifactRefs?: string[];
  confirmedActionId?: string;
};

export type ExecuteQueuedConversationTurnInput = {
  teacherMessageId: string;
};

export type MessageTurnResponse = {
  message: ConversationMessageRecord;
  assistantMessage?: ConversationMessageRecord;
  agentTurn?: MainAgentTurn;
  artifact?: ArtifactRecord;
  result?: unknown;
};

export type ConversationTurnServiceOptions = {
  service: WorkbenchService;
  runtime: AgentRuntime;
  agent: MainConversationAgent;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionFence?: ProjectExecutionFence;
  generationIntensityOverride?: GenerationIntensity;
  controlPlaneStore?: ControlPlaneStore;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode?: "optional" | "required";
};

export function createConversationTurnService(options: ConversationTurnServiceOptions) {
  const controlPlaneStore = options.controlPlaneStore ?? createControlPlaneStore();
  const businessSkillRuntime = options.businessSkillRuntime ?? createConfiguredBusinessToolSkillRuntime();
  const businessSkillRuntimeMode = options.businessSkillRuntimeMode ??
    (process.env.SHANHAI_SKILL_RUNTIME_MODE?.trim().toLowerCase() === "required" ? "required" : "optional");

  return {
    async createTurn(projectId: string, input: ConversationTurnInput): Promise<MessageTurnResponse> {
      const teacherContent = input.content.trim();
      const reference = input.reference?.trim() ?? "";
      const content = reference ? `${teacherContent}\n\n引用：${reference}` : teacherContent;
      const message = await options.service.addMessage(projectId, {
        role: input.role === "assistant" || input.role === "system" ? input.role : "teacher",
        content,
        artifactRefs: input.artifactRefs ?? [],
        metadata: input.confirmedActionId ? { confirmedActionId: input.confirmedActionId } : undefined,
      });

      if (message.role !== "teacher") {
        return { message };
      }

      return executeTeacherMessageTurn({
        service: options.service,
        runtime: options.runtime,
        agent: options.agent,
        projectId,
        teacherContent: content,
        confirmedActionId: input.confirmedActionId,
        triggerMessage: message,
        agentToolExecutor: options.agentToolExecutor,
        executionIdentity: options.executionIdentity,
        executionFence: options.executionFence,
        generationIntensityOverride: options.generationIntensityOverride,
        controlPlaneStore,
        businessSkillRuntime,
        businessSkillRuntimeMode,
        executionSource: "new_message",
      });
    },

    async executeQueuedTurn(projectId: string, input: ExecuteQueuedConversationTurnInput): Promise<MessageTurnResponse> {
      const messages = await options.service.getMessages(projectId);
      const message = messages.find((item) => item.id === input.teacherMessageId);
      if (!message || message.role !== "teacher") {
        throw new Error(`Teacher message not found: ${input.teacherMessageId}`);
      }

      return executeTeacherMessageTurn({
        service: options.service,
        runtime: options.runtime,
        agent: options.agent,
        projectId,
        teacherContent: message.content,
        confirmedActionId: typeof message.metadata.confirmedActionId === "string" ? message.metadata.confirmedActionId : undefined,
        triggerMessage: message,
        agentToolExecutor: options.agentToolExecutor,
        executionIdentity: options.executionIdentity,
        executionFence: options.executionFence,
        generationIntensityOverride: options.generationIntensityOverride,
        controlPlaneStore,
        businessSkillRuntime,
        businessSkillRuntimeMode,
        executionSource: "queued_message",
      });
    },
  };
}

async function executeTeacherMessageTurn(input: {
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
}): Promise<MessageTurnResponse> {
  const teacherContent = input.teacherContent;
  const submittedActionId = input.confirmedActionId?.trim() || undefined;
  const storedProject = await input.service.getProject(input.projectId);
  const project = input.generationIntensityOverride
    ? { ...storedProject, generationIntensity: input.generationIntensityOverride }
    : storedProject;
  const messages = await input.service.getMessages(input.projectId);
  const queuedTaskBrief = input.executionSource === "queued_message"
    ? await resolveQueuedTaskBriefBinding({
        message: input.triggerMessage,
        project,
        controlPlaneStore: input.controlPlaneStore,
      })
    : undefined;
  let progressTaskBrief = queuedTaskBrief;
  const onProgress = createMainAgentProgressWriter({
    projectId: input.projectId,
    teacherMessageId: input.triggerMessage.id,
    projectIntentEpoch: project.intentEpoch ?? 0,
    controlPlaneStore: input.controlPlaneStore,
    getTaskBrief: () => progressTaskBrief,
  });
  const previousIntentEpoch = project.intentEpoch ?? 0;
  const previousTaskBrief = findTaskBriefForIntent(messages, project.id, previousIntentEpoch);
  const previousAggregate = previousTaskBrief
    ? await input.controlPlaneStore.getTaskAggregate(project.id, previousIntentEpoch)
    : null;
  const previousSnapshot = previousAggregate && previousTaskBrief
    ? await input.controlPlaneStore.getLatestSemanticSnapshot({
        projectId: project.id,
        taskId: previousTaskBrief.taskId,
        intentEpoch: previousIntentEpoch,
        maxPlanRevision: previousAggregate.plan.revision,
      })
    : null;
  const pendingDecision = resolveCurrentPendingDecision({
    value: previousSnapshot?.snapshot.pendingDecision,
    aggregateStatus: previousAggregate?.status,
    planId: previousAggregate?.plan.planId,
    projectId: project.id,
    intentEpoch: previousIntentEpoch,
    taskId: previousTaskBrief?.taskId,
    actorUserId: resolveConversationActorUserId(input.service, input.projectId, input.executionIdentity),
  });
  const confirmedActionId = boundConfirmedActionId(teacherContent, submittedActionId, pendingDecision);
  if (submittedActionId && pendingDecision?.actionId !== submittedActionId) {
    return commitRejectedPendingDecisionTurn({
      service: input.service,
      projectId: input.projectId,
      triggerMessage: input.triggerMessage,
      pendingDecision,
    });
  }
  const canceledPendingAction = Boolean(
    submittedActionId && pendingDecision?.actionId === submittedActionId &&
    isPendingDecisionCancellation(teacherContent),
  );
  if (canceledPendingAction) {
    return commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      pendingDecision,
      previousSnapshot: previousSnapshot?.snapshot,
      triggerMessage: input.triggerMessage,
      control: {
        kind: "cancel",
        reasonCode: "teacher_requested_cancel",
        advanceIntentEpoch: true,
        userMessage: teacherContent,
      },
      previousTaskBrief,
      controlPlaneStore: input.controlPlaneStore,
    });
  }
  const editedPendingAction = Boolean(
    submittedActionId && pendingDecision?.actionId === submittedActionId && !confirmedActionId,
  );
  if (editedPendingAction) {
    return commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      pendingDecision,
      previousSnapshot: previousSnapshot?.snapshot,
      triggerMessage: input.triggerMessage,
      control: {
        kind: "redirect",
        reasonCode: "teacher_requested_redirect",
        advanceIntentEpoch: true,
        userMessage: teacherContent,
      },
      previousTaskBrief,
      controlPlaneStore: input.controlPlaneStore,
    });
  }
  const preAgentControl = queuedTaskBrief ? undefined : resolvePreAgentControl(teacherContent, {
    hasActiveTask: Boolean(previousTaskBrief),
    hasPendingPlan: Boolean(pendingDecision),
    allowRedirect: "imperative",
  });
  if (preAgentControl) {
    const controlResult = await commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      pendingDecision,
      previousSnapshot: previousSnapshot?.snapshot,
      triggerMessage: input.triggerMessage,
      control: preAgentControl,
      previousTaskBrief,
      controlPlaneStore: input.controlPlaneStore,
    });
    if (preAgentControl.kind === "redirect") {
      return executeTeacherMessageTurn({
        ...input,
        triggerMessage: controlResult.message,
      });
    }
    return controlResult;
  }
  let answeredDialogueCheckpoint: DialogueCheckpoint | undefined;
  if (previousTaskBrief) {
    const pendingDialogue = previousSnapshot?.snapshot.pendingDecision;
    if (previousAggregate?.status === "paused_recovery" && isDialogueCheckpoint(pendingDialogue) && pendingDialogue.status === "pending") {
      answeredDialogueCheckpoint = answerDialogueCheckpoint(pendingDialogue, {
        responseMessageId: input.triggerMessage.id,
        responseText: teacherContent,
      });
    }
  }
  const turnJobs = await input.service.getConversationTurnJobs(input.projectId);
  const turnJobId = turnJobs.find((job) => job.teacherMessageId === input.triggerMessage.id)?.id ?? null;
  const taskIntake = queuedTaskBrief
    ? { taskBrief: queuedTaskBrief }
    : answeredDialogueCheckpoint && previousTaskBrief
      ? { taskBrief: previousTaskBrief }
    : await resolveActiveTaskBrief({
        messages,
        message: input.triggerMessage,
        project,
        agent: input.agent,
        activeTask: previousTaskBrief,
        onProgress,
        turnJobId,
      });
  if (taskIntake.control) {
    return commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      pendingDecision,
      previousSnapshot: previousSnapshot?.snapshot,
      triggerMessage: input.triggerMessage,
      control: taskIntake.control,
      replacementProposal: taskIntake.replacementProposal,
      previousTaskBrief,
      controlPlaneStore: input.controlPlaneStore,
    });
  }
  const taskBrief = taskIntake.taskBrief ?? (confirmedActionId ? previousTaskBrief : undefined);
  progressTaskBrief = taskBrief;
  let intentGrant = taskBrief
    ? ensureStandardTaskBudgetDisclosure(
        (previousAggregate?.taskBrief.taskId === taskBrief.taskId ? previousAggregate.intentGrant : undefined)
          ?? resolveActiveIntentGrant(messages, taskBrief)
          ?? createStandardIntentGrant(taskBrief),
        taskBrief,
      )
    : undefined;
  const confirmedPendingDecision = pendingDecision?.actionId === confirmedActionId ? pendingDecision : undefined;
  if (taskBrief && intentGrant && confirmedPendingDecision) {
    intentGrant = applyConfirmedPendingDecision(intentGrant, taskBrief, confirmedPendingDecision);
  }
  let taskAggregate: Awaited<ReturnType<ControlPlaneStore["getTaskAggregate"]>> = null;
  let taskEventSequence = 0;
  if (taskBrief) {
    const committedTaskState = await commitConversationTurnTaskState({
      service: input.service,
      controlPlaneStore: input.controlPlaneStore,
      projectId: input.projectId,
      triggerMessage: input.triggerMessage,
      taskBrief,
      intentGrant: intentGrant!,
      confirmedPendingDecision,
      previousSnapshot: previousSnapshot?.snapshot,
    });
    taskAggregate = committedTaskState.taskAggregate;
    taskEventSequence = committedTaskState.taskEventSequence;
    input.triggerMessage = committedTaskState.triggerMessage;
    const triggerMessageIndex = messages.findIndex((message) => message.id === input.triggerMessage.id);
    if (triggerMessageIndex >= 0) messages[triggerMessageIndex] = input.triggerMessage;
  }
  const artifacts = await input.service.getArtifacts(input.projectId);
  const generationJobs = await input.service.getGenerationJobs(input.projectId);
  const availableArtifactKinds = artifacts
    .filter((artifact) => isArtifactTrustedForDownstream(artifact) && (!taskBrief || isArtifactBoundToTask(artifact, taskBrief)))
    .map((artifact) => artifact.kind);
  const toolObservations = readActiveToolObservationsFromMessages(messages);
  const agentObservations = readAgentObservationsForCurrentIntent(messages, project.intentEpoch ?? 0);
  const agentToolReports = readAgentToolReportsFromMessages(messages);
  const runCheckpoint = readLatestRunCheckpointFromMessages(messages);
  const budgetEvents = readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0);
  const externalProviderCallsUsed = countExternalProviderCalls(budgetEvents);
  let semanticSnapshot: SemanticContextSnapshot | undefined;
  if (taskBrief && taskAggregate) {
    semanticSnapshot = buildSemanticContextSnapshot({
      taskBrief,
      plan: taskAggregate.plan,
      pendingDecision: answeredDialogueCheckpoint
        ?? (confirmedPendingDecision ? withPendingDecisionStatus(confirmedPendingDecision, "confirmed") : pendingDecision)
        ?? null,
      trustedArtifactRefs: artifacts
        .filter((artifact) => isArtifactTrustedForDownstream(artifact) && isArtifactBoundToTask(artifact, taskBrief))
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
          taskId: taskBrief.taskId,
          taskBriefDigest: taskBrief.digest,
          intentEpoch: taskBrief.intentEpoch,
          bindingSource: artifact.taskBriefDigest
            ? "tool_execution" as const
            : artifact.origin === "teacher_input" ? "current_intent_teacher_input" as const : "current_intent_compatibility" as const,
        })),
      observationRefs: agentObservations.map((observation) => ({
        observationId: observation.observationId,
        reasonCodes: observation.reasonCodes,
        intentEpoch: taskBrief.intentEpoch,
      })),
      recentMessages: messages.map((message) => ({ role: message.role, content: message.content })),
    });
    await input.controlPlaneStore.saveSemanticSnapshot(semanticSnapshot, taskEventSequence);
  }
  const contextPackage = buildConversationContextPackage({ project, messages, artifacts, taskBrief });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
    taskBrief,
  });
  const agentWorldState = buildAgentWorldState({
    project,
    taskBrief: taskBrief ?? null,
    taskPlanRevision: taskAggregate?.plan.revision ?? null,
    artifacts,
    generationJobs,
    turnJobs,
    pendingDecision: confirmedPendingDecision ? null : pendingDecision ?? null,
    toolObservations,
    agentObservations,
    agentToolReports,
    runCheckpoint,
  });
  const resumeCheckpoint = taskAggregate?.checkpoint?.schemaVersion === "react-checkpoint.v1" &&
    (taskBrief?.sourceMessageId === input.triggerMessage.id || Boolean(answeredDialogueCheckpoint) || Boolean(confirmedPendingDecision))
    ? confirmedPendingDecision && intentGrant
      ? rebindMainAgentReActCheckpointAuthorization(taskAggregate.checkpoint as MainAgentReActCheckpoint, {
          standardWorkAuthorized: intentGrant.standardWorkAuthorized,
          budgetPolicyVersion: intentGrant.budgetPolicyVersion,
          maxCostCredits: intentGrant.maxCostCredits,
          maxExternalProviderCalls: intentGrant.maxExternalProviderCalls,
        })
      : taskAggregate.checkpoint
    : undefined;
  const nativeToolLoop = taskBrief ? createMainAgentToolLoopOptions({
    service: input.service,
    runtime: input.runtime,
    project,
    triggerMessage: input.triggerMessage,
    artifacts,
    identity: input.executionIdentity,
    fence: input.executionFence,
    executor: input.agentToolExecutor,
    intentGrant,
    taskBrief,
    externalProviderCallsUsed,
    planRevision: taskAggregate?.plan.revision,
    resumeCheckpoint,
    controlPlaneStore: input.controlPlaneStore,
    businessSkillRuntime: input.businessSkillRuntime,
    businessSkillRuntimeMode: input.businessSkillRuntimeMode,
  }) : undefined;
  const rawAgentResponse = taskIntake.precomputedTurn ?? await runWithProviderCallTraceBinding({ projectId: project.id,
    taskId: taskBrief?.taskId, teacherMessageId: input.triggerMessage.id, turnJobId,
    intentEpoch: taskBrief?.intentEpoch ?? project.intentEpoch ?? 0, phase: "initial" }, async () => await input.agent.respond({
    userMessage: teacherContent,
    responseStyle: input.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: project.generationIntensity,
    taskBrief,
    intentGrant,
    availableArtifactKinds,
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, semanticSnapshot),
    agentToolLoop: nativeToolLoop,
    onProgress,
  }));
  if (nativeToolLoop) {
    input.triggerMessage = (await input.service.getMessages(input.projectId))
      .find((message) => message.id === input.triggerMessage.id) ?? input.triggerMessage;
    if (taskBrief) {
      taskAggregate = await input.controlPlaneStore.getTaskAggregate(input.projectId, taskBrief.intentEpoch)
        ?? taskAggregate;
    }
  }
  const agentTurn = rawAgentResponse;
  let runtimeFailureMetadata: Record<string, unknown> | undefined;
  if (agentTurn.failure) {
    const failureObservation = createAgentObservation({
      projectId: input.projectId,
      source: "tool",
      status: "failed",
      actionKey: `main_agent_runtime:${input.triggerMessage.id}`,
      inputHash: hashRunInput({
        taskId: taskBrief?.taskId ?? null,
        taskBriefDigest: taskBrief?.digest ?? null,
        intentEpoch: project.intentEpoch ?? 0,
        sourceMessageId: input.triggerMessage.id,
      }),
      reasonCodes: [agentTurn.failure.reasonCode],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: "main_agent_runtime",
      minimalNextAction: "pause",
      teacherSafeSummary: agentTurn.failure.summary,
    });
    runtimeFailureMetadata = appendAgentObservationMetadata({
      ...input.triggerMessage.metadata,
      mainAgentFailure: agentTurn.failure,
      recovery: {
        errorId: failureObservation.observationId,
        reasonCode: agentTurn.failure.reasonCode,
        summary: agentTurn.failure.summary,
        kind: "retry",
        label: "服务恢复后继续当前任务",
      },
    }, failureObservation);
    input.triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...input.triggerMessage.metadata,
      ...runtimeFailureMetadata,
    });
    if (taskBrief) {
      if (intentGrant) {
        const committedFailure = await input.controlPlaneStore.commitRunFailure({
          taskBrief,
          intentGrant,
          observation: {
            observationId: failureObservation.observationId,
            status: failureObservation.status,
            reasonCodes: failureObservation.reasonCodes,
            payload: structuredClone(failureObservation) as unknown as Record<string, unknown>,
          },
          event: {
            eventId: crypto.randomUUID(),
            projectId: input.projectId,
            taskId: taskBrief.taskId,
            runId: `turn:${input.triggerMessage.id}`,
            intentEpoch: taskBrief.intentEpoch,
            kind: "run_failed",
            visibility: "internal",
            occurredAt: new Date().toISOString(),
            payload: {
              reasonCode: agentTurn.failure.reasonCode,
              retryability: agentTurn.failure.retryability,
              category: agentTurn.failure.category,
              observationId: failureObservation.observationId,
              taskBriefDigest: taskBrief.digest,
            },
          },
        });
        taskAggregate = committedFailure.aggregate;
      }
    }
  }
  const persistentTimeline = collectPersistentTeacherMessageParts(
    await input.controlPlaneStore.listEvents(input.projectId),
    `turn:${input.triggerMessage.id}`,
  );
  const persistedPendingDecision = isPendingDecision(input.triggerMessage.metadata.pendingDecision)
    ? input.triggerMessage.metadata.pendingDecision
    : undefined;
  const assistantMetadata = mergeMessageMetadata(
    runtimeFailureMetadata,
    persistedPendingDecision ? { pendingDecision: persistedPendingDecision } : undefined,
    persistentTimeline.length ? { agentTimeline: persistentTimeline } : undefined,
    isDialogueCheckpoint(input.triggerMessage.metadata.dialogueCheckpoint)
      ? { dialogueCheckpoint: input.triggerMessage.metadata.dialogueCheckpoint }
      : undefined,
  );
  const assistantMessage = await input.service.addMessage(input.projectId, {
    role: "assistant",
    content: appendPendingDecisionPrompt(
      formatAssistantContent(agentTurn.assistantMessage),
      persistedPendingDecision,
    ),
    metadata: assistantMetadata,
  });
  return { message: input.triggerMessage, assistantMessage, agentTurn };
}

async function commitRejectedPendingDecisionTurn(input: {
  service: WorkbenchService;
  projectId: string;
  triggerMessage: ConversationMessageRecord;
  pendingDecision?: PendingDecision;
}): Promise<MessageTurnResponse> {
  const content = "这个确认已失效或不属于当前任务。我没有执行任何操作；请使用当前确认选项，或直接说明新的要求。";
  const triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
    ...input.triggerMessage.metadata,
    pendingDecisionRejection: {
      reasonCode: "pending_decision_action_mismatch",
      persistedBeforeAgent: true,
    },
  });
  const assistantMessage = await input.service.addMessage(input.projectId, {
    role: "assistant",
    content,
    metadata: input.pendingDecision ? { pendingDecision: input.pendingDecision } : undefined,
  });
  return {
    message: triggerMessage,
    assistantMessage,
    agentTurn: {
      assistantMessage: { body: content },
      state: input.pendingDecision ? "awaiting_confirmation" : "chatting",
      quickReplies: [],
      recommendedOptions: [],
      runtimeKind: "openai",
    },
  };
}

function createMainAgentProgressWriter(input: {
  projectId: string;
  teacherMessageId: string;
  projectIntentEpoch: number;
  controlPlaneStore: ControlPlaneStore;
  getTaskBrief: () => TaskBrief | undefined;
}): MainAgentProgressSink {
  const runId = `turn:${input.teacherMessageId}`;
  let toolSequence = 0;
  const activeToolActivityIds = new Map<string, {
    activityId: string;
    startedAt: string;
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  }>();
  let pendingText = "";
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let writeChain = Promise.resolve();
  const enqueue = (progress: MainAgentProgressEvent) => {
    writeChain = writeChain.then(async () => {
      try {
        const taskBrief = input.getTaskBrief();
        const scope = {
          projectId: input.projectId,
          taskId: taskBrief?.taskId ?? `conversation-turn:${input.teacherMessageId}`,
          runId,
          intentEpoch: taskBrief?.intentEpoch ?? input.projectIntentEpoch,
        };
        const event = progressEventToAgentEvent(progress, scope, activeToolActivityIds, () => ++toolSequence);
        if (event) await input.controlPlaneStore.appendEvent(event);
      } catch {
        // Progress projection must never become a second execution or failure path.
      }
    });
  };

  const flushText = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!pendingText) return;
    const delta = pendingText;
    pendingText = "";
    enqueue({ type: "text_delta", delta });
  };

  return async (progress) => {
    if (progress.type === "text_delta") {
      pendingText += progress.delta;
      if (pendingText.length >= 256) flushText();
      else if (!flushTimer) flushTimer = setTimeout(flushText, 100);
      return;
    }
    flushText();
    enqueue(progress);
    await writeChain;
  };
}

function progressEventToAgentEvent(
  progress: MainAgentProgressEvent,
  scope: { projectId: string; taskId: string; runId: string; intentEpoch: number },
  activeToolActivityIds: Map<string, {
    activityId: string;
    startedAt: string;
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  }>,
  nextToolSequence: () => number,
): Parameters<ControlPlaneStore["appendEvent"]>[0] | null {
  const base = {
    eventId: crypto.randomUUID(),
    ...scope,
    occurredAt: new Date().toISOString(),
  };
  if (progress.type === "response_started") {
    return {
      ...base,
      kind: "text_started",
      visibility: "teacher",
      payload: { status: "running" },
    };
  }
  if (progress.type === "text_delta") {
    return {
      ...base,
      kind: "text_delta",
      visibility: "teacher",
      payload: { text: progress.delta },
    };
  }
  if (progress.type === "step_started") {
    const activityId = `${scope.runId}:tool:${nextToolSequence()}`;
    activeToolActivityIds.set(progress.toolName, {
      activityId,
      startedAt: base.occurredAt,
      ...(progress.purpose ? { purpose: progress.purpose } : {}),
      ...(progress.inputSummary?.length ? { inputSummary: [...progress.inputSummary] } : {}),
      ...(progress.expectedOutput ? { expectedOutput: progress.expectedOutput } : {}),
    });
    return {
      ...base,
      kind: "tool_started",
      visibility: "teacher",
      payload: {
        activityId,
        label: `正在${capabilityTeacherLabel(progress.toolName)}`,
        status: "running",
        ...(progress.purpose ? { purpose: progress.purpose } : {}),
        ...(progress.inputSummary?.length ? { inputSummary: [...progress.inputSummary] } : {}),
        ...(progress.expectedOutput ? { expectedOutput: progress.expectedOutput } : {}),
        startedAt: base.occurredAt,
      },
    };
  }
  if (progress.type === "step_observed") {
    const active = activeToolActivityIds.get(progress.toolName);
    const activityId = active?.activityId ?? `${scope.runId}:tool:${nextToolSequence()}`;
    activeToolActivityIds.delete(progress.toolName);
    const status = progress.status === "succeeded" ? "succeeded"
      : progress.status === "needs_input" ? "blocked"
      : progress.status;
    return {
      ...base,
      kind: "tool_observed",
      visibility: "teacher",
      payload: {
        activityId,
        label: toolObservationLabel(progress.toolName, progress.status, progress.summary),
        status,
        ...(progress.observationId ? { observationId: progress.observationId } : {}),
        ...(progress.reasonCodes[0] ? { reasonCode: progress.reasonCodes[0] } : {}),
        ...(progress.nextAction ? { nextAction: progress.nextAction } : {}),
        ...(progress.artifactRefs?.length ? { artifactRefs: structuredClone(progress.artifactRefs) } : {}),
        ...(progress.summary ? { observationSummary: progress.summary } : {}),
        ...(active?.purpose ? { purpose: active.purpose } : {}),
        ...(active?.inputSummary?.length ? { inputSummary: [...active.inputSummary] } : {}),
        ...(active?.expectedOutput ? { expectedOutput: active.expectedOutput } : {}),
        ...(active?.startedAt ? {
          startedAt: active.startedAt,
          finishedAt: base.occurredAt,
          durationMs: Math.max(0, Date.parse(base.occurredAt) - Date.parse(active.startedAt)),
        } : {}),
      },
    };
  }
  if (progress.type === "response_completed") {
    return {
      ...base,
      kind: "activity_updated",
      visibility: "internal",
      payload: {
        activityId: `${scope.runId}:response-metrics`,
        label: "Main Agent response metrics",
        status: "completed",
        usage: progress.usage,
        telemetry: progress.telemetry,
      },
    };
  }
  return {
    ...base,
    kind: "activity_updated",
    visibility: "teacher",
    payload: {
      activityId: `${scope.runId}:response`,
      label: progress.summary,
      status: "failed",
    },
  };
}

export function capabilityTeacherLabel(toolName: string) {
  try {
    return resolveMainAgentToolDefinition(toolName).label;
  } catch {
    return getCapabilityDefinitions().find((definition) => definition.id === toolName)?.userLabel
      ?? "执行当前步骤";
  }
}

function toolObservationLabel(
  toolName: string,
  status: Extract<MainAgentProgressEvent, { type: "step_observed" }>["status"],
  summary?: string,
) {
  if (summary?.trim()) return summary.trim();
  const label = capabilityTeacherLabel(toolName);
  if (status === "succeeded") return `${label}已完成，正在判断下一步`;
  if (status === "repair" || status === "inconclusive") return `${label}需要调整，正在重新规划`;
  if (status === "needs_input" || status === "blocked") return `${label}暂时无法继续`;
  return `${label}未完成，已保存失败位置`;
}

async function commitPreAgentControlTurn(input: {
  service: WorkbenchService;
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  pendingDecision?: PendingDecision;
  previousSnapshot?: SemanticContextSnapshot;
  triggerMessage: ConversationMessageRecord;
  control: PreAgentControlDecision;
  replacementProposal?: Parameters<typeof createTaskBriefFromProposal>[0]["proposal"];
  previousTaskBrief?: TaskBrief;
  controlPlaneStore: ControlPlaneStore;
}): Promise<MessageTurnResponse> {
  const previousIntentEpoch = input.project.intentEpoch ?? 0;
  const pendingStatus = input.control.kind === "pause"
    ? "paused"
    : input.control.kind === "cancel" ? "canceled" : "superseded";
  const aggregateStatus = input.control.kind === "pause" ? "paused_recovery" : pendingStatus;

  const nextIntentEpoch = input.control.advanceIntentEpoch
    ? await input.service.advanceProjectIntentEpoch(input.project.id, previousIntentEpoch)
    : previousIntentEpoch;
  const controlArtifacts = input.control.kind === "redirect"
    ? await input.service.getArtifacts(input.project.id)
    : [];
  const domainImpact = input.control.kind === "redirect"
    ? resolveDomainRevisionImpact(input.control.userMessage, controlArtifacts)
    : null;
  const impactScope = input.control.kind === "redirect"
    ? domainImpact?.nextAction === "repair_unit" ? "unit" : "upstream"
    : "task";
  const controlReasonCode = input.control.kind === "redirect" && !input.pendingDecision
    ? "teacher_redirected_without_pending_decision"
    : input.control.reasonCode;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "teacher_revision",
    status: input.control.kind === "redirect" ? "repair" : "needs_input",
    actionKey: `${input.control.kind}:${input.previousTaskBrief?.taskId ?? "active-task"}`,
    inputHash: hashRunInput({
      control: input.control.kind,
      previousIntentEpoch,
      nextIntentEpoch,
      userMessage: input.control.userMessage,
    }),
    reasonCodes: [controlReasonCode],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "turn_intake_control",
    minimalNextAction: input.control.kind === "redirect" ? "repair_upstream" : "pause",
    teacherSafeSummary: controlAcknowledgement(input.control.kind),
  });
  const retainedTaskBrief = input.control.kind === "redirect" ? undefined : input.previousTaskBrief;
  const retainedIntentGrant = retainedTaskBrief
    ? ensureStandardTaskBudgetDisclosure(
        resolveActiveIntentGrant(input.messages, retainedTaskBrief) ?? createStandardIntentGrant(retainedTaskBrief),
        retainedTaskBrief,
      )
    : undefined;
  let metadata: Record<string, unknown> = appendAgentObservationMetadata({
    ...input.triggerMessage.metadata,
    ...(retainedTaskBrief ? { taskBrief: retainedTaskBrief } : {}),
    ...(retainedIntentGrant ? { intentGrant: retainedIntentGrant } : {}),
    conversationControlImpact: {
      decisionKind: input.control.kind,
      reasonCode: controlReasonCode,
      previousIntentEpoch,
      nextIntentEpoch,
      persistedBeforeAgent: true,
      impactScope,
      preservedArtifacts: true,
      supersededDecisionIds: input.pendingDecision ? [input.pendingDecision.decisionId] : [],
      domainImpact,
    },
  }, observation);
  if (input.control.kind === "pause") {
    metadata = appendRunCheckpointMetadata(metadata, createRunCheckpoint({
      projectId: input.project.id,
      planVersion: nextIntentEpoch,
      reason: "teacher_requested_pause",
      actionKey: observation.actionKey,
      inputHash: observation.inputHash,
      observationRefs: [observation.observationId],
    }));
  } else {
    metadata = clearRunCheckpointMetadata(metadata);
  }

  let triggerMessage = await input.service.updateMessageMetadata(
    input.project.id,
    input.triggerMessage.id,
    metadata,
  );

  if (input.previousTaskBrief) {
    const previousIntentGrant = ensureStandardTaskBudgetDisclosure(
      resolveActiveIntentGrant(input.messages, input.previousTaskBrief) ?? createStandardIntentGrant(input.previousTaskBrief),
      input.previousTaskBrief,
    );
    const previousAggregate = await input.controlPlaneStore.getTaskAggregate(input.project.id, previousIntentEpoch);
    const checkpoint = input.control.kind === "pause" && metadata.agentRunCheckpoint && typeof metadata.agentRunCheckpoint === "object"
      ? metadata.agentRunCheckpoint as Record<string, unknown>
      : previousAggregate?.checkpoint ?? null;
    const updatedAggregate = await input.controlPlaneStore.upsertTaskAggregate({
      taskBrief: input.previousTaskBrief,
      intentGrant: previousIntentGrant,
      plan: previousAggregate ? { ...previousAggregate.plan, status: aggregateStatus } : {
        planId: input.pendingDecision?.planId ?? `plan:${input.previousTaskBrief.taskId}`,
        revision: 0,
        status: aggregateStatus,
      },
      status: aggregateStatus,
      checkpoint,
    });
    await input.controlPlaneStore.appendEvent({
      eventId: crypto.randomUUID(),
      projectId: input.project.id,
      taskId: input.previousTaskBrief.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: previousIntentEpoch,
      kind: "task_updated",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { control: input.control.kind, observationId: observation.observationId },
    });
    if (input.pendingDecision && input.control.kind !== "pause") {
      await persistPendingDecisionStatus({
        service: input.service,
        controlPlaneStore: input.controlPlaneStore,
        projectId: input.project.id,
        triggerMessage,
        taskBrief: input.previousTaskBrief,
        aggregate: updatedAggregate,
        previousSnapshot: input.previousSnapshot,
        decision: input.pendingDecision,
        status: input.control.kind === "cancel" ? "canceled" : "superseded",
      });
    }
  }

  if (input.control.kind === "redirect") {
    if (input.replacementProposal) {
      const projectConstraints = [input.project.grade, input.project.subject, input.project.lessonTopic]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim());
      const nextTaskBrief = createTaskBriefFromProposal({
        proposal: {
          ...input.replacementProposal,
          goal: input.control.userMessage.trim(),
          constraints: [...new Set([...input.replacementProposal.constraints, ...projectConstraints])],
        },
        taskId: `task:${input.triggerMessage.id}`,
        projectId: input.project.id,
        intentEpoch: nextIntentEpoch,
        generationIntensity: input.project.generationIntensity ?? "standard",
        sourceMessageId: input.triggerMessage.id,
        context: {
          grade: input.project.grade,
          subject: input.project.subject,
          textbookVersion: input.project.textbookVersion,
          lessonTopic: input.project.lessonTopic,
        },
      });
      const nextIntentGrant = createStandardIntentGrant(nextTaskBrief);
      metadata = {
        ...triggerMessage.metadata,
        taskBrief: nextTaskBrief,
        intentGrant: nextIntentGrant,
      };
      triggerMessage = await input.service.updateMessageMetadata(
        input.project.id,
        input.triggerMessage.id,
        metadata,
      );
      await input.controlPlaneStore.upsertTaskAggregate({
        taskBrief: nextTaskBrief,
        intentGrant: nextIntentGrant,
        plan: {
          planId: `plan:${nextTaskBrief.taskId}`,
          revision: 0,
          status: "active",
        },
        status: "active",
        checkpoint: null,
      });
      await input.controlPlaneStore.appendEvent({
        eventId: crypto.randomUUID(),
        projectId: input.project.id,
        taskId: nextTaskBrief.taskId,
        runId: `turn:${input.triggerMessage.id}`,
        intentEpoch: nextIntentEpoch,
        kind: "task_created",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: {
          control: input.control.kind,
          controlObservationId: observation.observationId,
          taskBriefDigest: nextTaskBrief.digest,
        },
      });
    }
  }

  const content = controlAcknowledgement(input.control.kind);
  const assistantMessage = await input.service.addMessage(input.project.id, {
    role: "assistant",
    content,
    metadata: {
      conversationControlDecision: {
        kind: input.control.kind,
        reasonCode: controlReasonCode,
        persistedBeforeAgent: true,
      },
    },
  });
  const agentTurn: MainAgentTurn = {
    assistantMessage: { body: content },
    state: input.control.kind === "redirect" ? "collecting_inputs" : "chatting",
    quickReplies: [],
    recommendedOptions: [],
    runtimeKind: "openai",
  };
  return {
    message: triggerMessage,
    assistantMessage,
    agentTurn,
  };
}

function controlAcknowledgement(kind: PreAgentControlDecision["kind"]) {
  if (kind === "pause") return "已暂停当前任务，并保存了恢复位置。";
  if (kind === "cancel") return "已取消当前任务，旧结果不会继续提升。";
  return "已保存新的任务方向，旧计划不会继续执行。";
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function mergeMessageMetadata(...metadataItems: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  const merged = metadataItems.reduce<Record<string, unknown>>((result, metadata) => {
    if (!metadata) return result;
    return { ...result, ...metadata };
  }, {});

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveConversationActorUserId(
  service: WorkbenchService,
  projectId: string,
  identity?: ExecutionIdentitySnapshot,
) {
  return identity?.actorUserId ?? service.getExecutionIdentity()?.actorUserId ?? `local-project:${projectId}`;
}

function resolveDomainRevisionImpact(teacherMessage: string, artifacts: ArtifactRecord[]) {
  const pageMatch = teacherMessage.match(/第\s*(\d{1,3})\s*页/);
  if (!pageMatch) return null;
  const pageId = `page_${pageMatch[1].padStart(2, "0")}`;
  const designArtifact = [...artifacts].reverse().find((artifact) => artifact.kind === "ppt_design_draft");
  const packageValue = designArtifact?.structuredContent.pptDesignPackage;
  if (!isPptDesignPackageShape(packageValue)) {
    return {
      nextAction: "pause" as const,
      requestedPageIds: [pageId],
      reasonCodes: ["ppt_design_package_missing_for_exact_impact"],
    };
  }
  try {
    return analyzePptRevisionImpact(packageValue, { kind: "page_text_layout", pageId });
  } catch {
    return {
      nextAction: "pause" as const,
      requestedPageIds: [pageId],
      reasonCodes: ["ppt_page_locator_not_found"],
    };
  }
}

function isPptDesignPackageShape(value: unknown): value is PptDesignPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.pageSpecs) && Array.isArray(record.objectives) && Array.isArray(record.evidenceBindings)
    && Boolean(record.samplePlan) && typeof record.samplePlan === "object";
}

function readAgentObservationsForCurrentIntent(messages: ConversationMessageRecord[], intentEpoch: number) {
  return readAgentObservationsFromMessages(messages.slice(findCurrentIntentBoundary(messages, intentEpoch)));
}

function readBudgetEventsForCurrentIntent(messages: ConversationMessageRecord[], intentEpoch: number) {
  return readAgentHarnessBudgetEventsFromMessages(messages.slice(findCurrentIntentBoundary(messages, intentEpoch)));
}

function findCurrentIntentBoundary(messages: ConversationMessageRecord[], intentEpoch: number) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const impact = messages[index].metadata.conversationControlImpact;
    if (!impact || typeof impact !== "object" || Array.isArray(impact)) continue;
    const record = impact as Record<string, unknown>;
    if (record.nextIntentEpoch === intentEpoch && record.previousIntentEpoch !== record.nextIntentEpoch) {
      return index;
    }
  }
  return 0;
}

function countExternalProviderCalls(events: ReturnType<typeof readAgentHarnessBudgetEventsFromMessages>) {
  return countSubmittedExternalProviderCalls(events);
}

function boundConfirmedActionId(
  teacherContent: string,
  confirmedActionId: string | undefined,
  decision: PendingDecision | undefined,
) {
  const actionId = confirmedActionId?.trim();
  if (!actionId) return undefined;
  return decision?.actionId === actionId && isPendingDecisionConfirmation(teacherContent) ? actionId : undefined;
}

function applyConfirmedPendingDecision(grant: IntentGrant, taskBrief: TaskBrief, decision: PendingDecision): IntentGrant {
  if (decision.kind === "authorization") {
    return ensureStandardTaskBudgetDisclosure({ ...grant, standardWorkAuthorized: true }, taskBrief);
  }
  if (decision.kind === "budget_disclosure") {
    return discloseStandardTaskBudget(grant, taskBrief);
  }
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

function toMainAgentProjectContext(project: ProjectRecord) {
  return {
    grade: project.grade,
    subject: project.subject,
    topic: project.lessonTopic,
  };
}
