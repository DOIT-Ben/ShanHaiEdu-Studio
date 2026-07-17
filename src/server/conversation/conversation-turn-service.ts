import type { AgentProjectContext, AgentRuntime } from "@/server/agent-runtime/types";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability, type CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { appendToolObservationMetadata, createToolObservation, readActiveToolObservationsFromMessages, readToolObservationsFromMetadata, type ToolObservation, type ToolObservationKind } from "@/server/capabilities/tool-observation";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { buildAgentHarnessBudgetEvent, countSubmittedExternalProviderCalls, evaluateAgentHarnessBudget, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import { isBoundActionConfirmation, normalizeExecutionPolicy, resolveConversationControl } from "@/server/conversation/conversation-control-resolver";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  clearRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  guardReActTransition,
  readAgentObservationsFromMetadata,
  readAgentObservationsFromMessages,
  readLatestRunCheckpointFromMessages,
  type AgentObservation,
} from "@/server/conversation/react-control";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import {
  actionRiskForTool,
  createPendingDecisionForAction,
  describeActionPolicyHumanGate,
  discloseStandardTaskBudget,
  evaluateActionPolicy,
  STANDARD_BUDGET_POLICY_VERSION,
} from "@/server/guards/action-policy";
import { resolveBudgetUpgrade, resolveStandardTaskBudget } from "@/server/guards/task-budget-policy";
import { resolveProjectSemanticScope } from "./project-semantic-scope";
import { evaluateToolPlan } from "@/server/guards/plan-guard";
import { routeToolCall } from "@/server/tools/tool-router";
import { executeThroughToolGateway } from "@/server/tools/tool-execution-gateway";
import { getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { isVerifiedProviderToolSuccess, type ToolExecutionResult } from "@/server/tools/tool-types";
import type { ValidationReport } from "@/server/quality/quality-types";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import { analyzePptRevisionImpact } from "@/server/ppt-quality/ppt-impact-analysis";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, ProjectExecutionFence, ProjectRecord, WorkflowNodeKey } from "@/server/workbench/types";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import {
  createDeterministicMainConversationAgent,
  type MainAgentTaskIntakeDecision,
  type MainConversationAgent,
  type MainConversationAgentInput,
} from "./main-conversation-agent";
import { createMainAgentToolLoopOptions } from "./main-agent-tool-loop-config";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { createExecutionEnvelope, createTaskBrief, hasValidTaskBrief, isPendingDecision, withPendingDecisionStatus, type IntentGrant, type PendingDecision, type TaskBrief } from "./task-contract";
import { createTaskBriefFromProposal, proposeDeterministicTaskBriefFixture } from "./task-intake";
import { resolvePreAgentControl, type PreAgentControlDecision } from "./turn-intake-control";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { MainAgentProgressEvent, MainAgentProgressSink } from "./main-agent-stream-projection";
import { createControlPlaneStore } from "./control-plane-store";
import {
  createConfiguredBusinessToolSkillRuntime,
  type BusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import { buildSemanticContextSnapshot, type SemanticContextSnapshot } from "./context-semantic-snapshot";
import { findRemainingRequestedOutputs } from "./task-completion-contract";
import { collectPersistentTeacherMessageParts } from "@/lib/teacher-agent-events";
import { answerDialogueCheckpoint, isDialogueCheckpoint, type DialogueCheckpoint } from "./dialogue-checkpoint";
import { rebindMainAgentReActCheckpointAuthorization, type MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

type PendingDeliveryPlanMetadata = {
  status: "pending" | "paused" | "confirmed" | "canceled" | "superseded";
  teacherRequest: string;
  toolPlan: CapabilityToolPlan;
  deliveryPlan?: DeliveryPlan;
  runtimeKind: MainAgentTurn["runtimeKind"];
  actionId?: string;
  taskBrief?: TaskBrief;
  intentGrant?: IntentGrant;
  pendingDecision?: PendingDecision;
  externalProviderCallsUsed?: number;
};

type PendingDeliveryPlanSnapshot = PendingDeliveryPlanMetadata & {
  messageId: string;
  messageMetadata: Record<string, unknown>;
};

async function resolveActiveTaskBrief(input: {
  messages: ConversationMessageRecord[];
  message: ConversationMessageRecord;
  project: ProjectRecord;
  agent: MainConversationAgent;
  requireStructuredIntake: boolean;
  forceProposal?: boolean;
  onProgress?: MainAgentProgressSink;
  activeTask?: TaskBrief;
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
    decision = await input.agent.intakeTask({
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
    });
  } else {
    if (input.requireStructuredIntake) {
      throw new Error("Native Main Agent control plane requires structured task intake.");
    }
    const proposal = proposeDeterministicTaskBriefFixture(message.content, project);
    decision = proposal ? { kind: "task", proposal } : { kind: "conversation" };
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

const toolRouterCapabilityIds = new Set<CapabilityId>(
  listToolDefinitions().flatMap((tool) => tool.capabilityId ? [tool.capabilityId] : []),
);
const MAX_AUTONOMOUS_BUSINESS_TOOL_ROUNDS = getCapabilityDefinitions().length + 5;
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
  agent?: MainConversationAgent;
  toolRouter?: typeof routeToolCall;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionFence?: ProjectExecutionFence;
  generationIntensityOverride?: GenerationIntensity;
  enableTaskGrantAutonomy?: boolean;
  enableNativeToolControlPlane?: boolean;
  controlPlaneStore?: ControlPlaneStore;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode?: "optional" | "required";
};

export function createConversationTurnService(options: ConversationTurnServiceOptions) {
  const agent = options.agent ?? createDeterministicMainConversationAgent();
  const toolRouter = options.toolRouter ?? routeToolCall;
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
        agent,
        toolRouter,
        projectId,
        teacherContent,
        reference,
        confirmedActionId: input.confirmedActionId,
        triggerMessage: message,
        agentToolExecutor: options.agentToolExecutor,
        executionIdentity: options.executionIdentity,
        executionFence: options.executionFence,
        generationIntensityOverride: options.generationIntensityOverride,
        enableTaskGrantAutonomy: options.enableTaskGrantAutonomy,
        enableNativeToolControlPlane: options.enableNativeToolControlPlane,
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
        agent,
        toolRouter,
        projectId,
        teacherContent: message.content,
        reference: "",
        confirmedActionId: typeof message.metadata.confirmedActionId === "string" ? message.metadata.confirmedActionId : undefined,
        triggerMessage: message,
        agentToolExecutor: options.agentToolExecutor,
        executionIdentity: options.executionIdentity,
        executionFence: options.executionFence,
        generationIntensityOverride: options.generationIntensityOverride,
        enableTaskGrantAutonomy: options.enableTaskGrantAutonomy,
        enableNativeToolControlPlane: options.enableNativeToolControlPlane,
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
  toolRouter: typeof routeToolCall;
  projectId: string;
  teacherContent: string;
  reference: string;
  confirmedActionId?: string;
  triggerMessage: ConversationMessageRecord;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionFence?: ProjectExecutionFence;
  generationIntensityOverride?: GenerationIntensity;
  enableTaskGrantAutonomy?: boolean;
  enableNativeToolControlPlane?: boolean;
  controlPlaneStore: ControlPlaneStore;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode: "optional" | "required";
  executionSource: "new_message" | "queued_message";
}): Promise<MessageTurnResponse> {
  const teacherContent = input.teacherContent;
  const reference = input.reference;
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
  const activePlans = findActiveDeliveryPlans(messages);
  const confirmedActionId = boundConfirmedActionId(teacherContent, submittedActionId, activePlans);
  const controlConfirmedActionId = submittedActionId && !activePlans.some((plan) => plan.actionId === submittedActionId)
    ? submittedActionId
    : confirmedActionId;
  const editedPendingAction = Boolean(
    submittedActionId &&
    !confirmedActionId &&
    activePlans.some((plan) => plan.actionId === submittedActionId),
  );
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
  if (editedPendingAction) {
    return commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      activePlans,
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
    hasPendingPlan: activePlans.length > 0,
    allowRedirect: "imperative",
  });
  if (preAgentControl) {
    const controlResult = await commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      activePlans,
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
    const previousAggregate = await input.controlPlaneStore.getTaskAggregate(project.id, previousIntentEpoch);
    const previousSnapshot = previousAggregate
      ? await input.controlPlaneStore.getLatestSemanticSnapshot({
          projectId: project.id,
          taskId: previousTaskBrief.taskId,
          intentEpoch: previousIntentEpoch,
          maxPlanRevision: previousAggregate.plan.revision,
        })
      : null;
    const pendingDialogue = previousSnapshot?.snapshot.pendingDecision;
    if (previousAggregate?.status === "paused_recovery" && isDialogueCheckpoint(pendingDialogue) && pendingDialogue.status === "pending") {
      answeredDialogueCheckpoint = answerDialogueCheckpoint(pendingDialogue, {
        responseMessageId: input.triggerMessage.id,
        responseText: teacherContent,
      });
    }
  }
  const taskIntake = queuedTaskBrief
    ? { taskBrief: queuedTaskBrief }
    : answeredDialogueCheckpoint && previousTaskBrief
      ? { taskBrief: previousTaskBrief }
    : await resolveActiveTaskBrief({
        messages,
        message: input.triggerMessage,
        project,
        agent: input.agent,
        requireStructuredIntake: input.enableNativeToolControlPlane === true,
        activeTask: previousTaskBrief,
        onProgress,
      });
  if (taskIntake.control) {
    return commitPreAgentControlTurn({
      service: input.service,
      project,
      messages,
      activePlans,
      triggerMessage: input.triggerMessage,
      control: taskIntake.control,
      replacementProposal: taskIntake.replacementProposal,
      previousTaskBrief,
      controlPlaneStore: input.controlPlaneStore,
    });
  }
  const pendingTaskContext = resolveActiveDeliveryPlan(activePlans, confirmedActionId);
  const taskBrief = taskIntake.taskBrief ?? pendingTaskContext?.taskBrief;
  progressTaskBrief = taskBrief;
  let intentGrant = taskBrief
    ? ensureStandardTaskBudgetDisclosure(
        resolveActiveIntentGrant(messages, taskBrief) ?? pendingTaskContext?.intentGrant ?? createStandardIntentGrant(taskBrief),
        taskBrief,
      )
    : undefined;
  const confirmedPendingDecision = pendingTaskContext && pendingTaskContext.actionId === confirmedActionId &&
    pendingTaskContext.pendingDecision?.status === "pending"
    ? pendingTaskContext.pendingDecision
    : undefined;
  if (taskBrief && intentGrant && confirmedPendingDecision) {
    intentGrant = applyConfirmedPendingDecision(intentGrant, taskBrief, confirmedPendingDecision);
  }
  let taskAggregate: Awaited<ReturnType<ControlPlaneStore["getTaskAggregate"]>> = null;
  let taskEventSequence = 0;
  if (taskBrief) {
    const existingAggregate = await input.controlPlaneStore.getTaskAggregate(taskBrief.projectId, taskBrief.intentEpoch);
    const resumesSameTask = existingAggregate?.status === "paused_recovery" &&
      existingAggregate.taskBrief.taskId === taskBrief.taskId &&
      existingAggregate.taskBrief.digest === taskBrief.digest;
    const resumesReActCheckpoint = resumesSameTask &&
      existingAggregate?.checkpoint?.schemaVersion === "react-checkpoint.v1";
    const nextPlan = existingAggregate ? {
      ...existingAggregate.plan,
      status: resumesSameTask ? "active" : existingAggregate.plan.status,
    } : {
      planId: activePlans[0]?.toolPlan.planId ?? `plan:${taskBrief.taskId}`,
      revision: 0,
      status: "active",
    };
    taskAggregate = resumesSameTask && !resumesReActCheckpoint
      ? await input.controlPlaneStore.resumeTaskAggregate({ taskBrief, intentGrant: intentGrant!, plan: nextPlan })
      : await input.controlPlaneStore.upsertTaskAggregate({
          taskBrief,
          intentGrant: intentGrant!,
          plan: nextPlan,
          status: resumesSameTask ? "active" : existingAggregate?.status ?? "active",
          checkpoint: existingAggregate?.checkpoint ?? null,
        });
    const taskEvent = await input.controlPlaneStore.appendEvent({
      eventId: crypto.randomUUID(),
      projectId: taskBrief.projectId,
      taskId: taskBrief.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: taskBrief.intentEpoch,
      kind: existingAggregate ? "task_updated" : "task_created",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: {
        taskBriefDigest: taskBrief.digest,
        planRevision: taskAggregate.plan.revision,
      },
    });
    taskEventSequence = taskEvent.sequence;
    if (!existingAggregate) {
      const scopeProjection = taskScopeTeacherProjection(taskBrief);
      const scopeOccurredAt = new Date().toISOString();
      const scopeEvent = await input.controlPlaneStore.appendEvent({
        eventId: crypto.randomUUID(),
        projectId: taskBrief.projectId,
        taskId: taskBrief.taskId,
        runId: `turn:${input.triggerMessage.id}`,
        intentEpoch: taskBrief.intentEpoch,
        kind: "activity_updated",
        visibility: "teacher",
        occurredAt: scopeOccurredAt,
        payload: {
          activityId: `turn:${input.triggerMessage.id}:task-scope`,
          label: "本轮目标已明确",
          status: "completed",
          purpose: taskBrief.goal,
          inputSummary: scopeProjection.inputSummary,
          expectedOutput: scopeProjection.expectedOutput,
          finishedAt: scopeOccurredAt,
        },
      });
      taskEventSequence = scopeEvent.sequence;
    }
    input.triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...input.triggerMessage.metadata,
      taskBrief,
      intentGrant,
    });
    const triggerMessageIndex = messages.findIndex((message) => message.id === input.triggerMessage.id);
    if (triggerMessageIndex >= 0) messages[triggerMessageIndex] = input.triggerMessage;
    if (input.enableNativeToolControlPlane === true && confirmedPendingDecision && pendingTaskContext) {
      await updatePendingPlanStatus(input.service, input.projectId, pendingTaskContext, "confirmed");
    }
  }
  const workflowNodes = await input.service.getNodes(input.projectId);
  const artifacts = await input.service.getArtifacts(input.projectId);
  const generationJobs = await input.service.getGenerationJobs(input.projectId);
  const turnJobs = await input.service.getConversationTurnJobs(input.projectId);
  const availableArtifactKinds = artifacts
    .filter((artifact) => isArtifactTrustedForDownstream(artifact) && (!taskBrief || isArtifactBoundToTask(artifact, taskBrief)))
    .map((artifact) => artifact.kind);

  const pendingPlan = input.enableNativeToolControlPlane === true && confirmedPendingDecision
    ? null
    : resolveActiveDeliveryPlan(activePlans, confirmedActionId);
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
      pendingDecision: answeredDialogueCheckpoint ?? (pendingPlan?.pendingDecision
        ? structuredClone(pendingPlan.pendingDecision) as unknown as Record<string, unknown>
        : null),
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
  const contextPackage = buildConversationContextPackage({ project, messages, workflowNodes, artifacts, taskBrief });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
    taskBrief,
  });
  if (activePlans.length > 1 && !confirmedActionId && isGenericContinuationRequest(teacherContent)) {
    const labels = activePlans.slice(0, 3).map((plan) => getCapabilityDefinition(plan.toolPlan.capabilityId).userLabel);
    const content = `当前有多个待处理方向：${labels.join("、")}。你想继续哪一个？`;
    const assistantMessage = await input.service.addMessage(input.projectId, {
      role: "assistant",
      content,
      metadata: { conversationControlDecision: { kind: "clarify_offer", reasonCode: "multiple_active_offers" } },
    });
    return {
      message: input.triggerMessage,
      assistantMessage,
      agentTurn: {
        assistantMessage: { body: content },
        state: "collecting_inputs",
        quickReplies: activePlans.slice(0, 3).map((plan, index) => ({
          label: labels[index],
          prompt: `继续${labels[index]}`,
          recommended: index === 0,
        })),
        recommendedOptions: [],
        shouldRunToolNow: false,
        runtimeKind: "deterministic",
      },
    };
  }
  const agentWorldState = buildAgentWorldState({
    project,
    taskBrief: taskBrief ?? null,
    taskPlanRevision: taskAggregate?.plan.revision ?? null,
    workflowNodes,
    artifacts,
    generationJobs,
    turnJobs,
    contextPackage,
    pendingPlan,
    toolObservations,
    agentObservations,
    agentToolReports,
    runCheckpoint,
  });

  const nativeToolControlPlaneOwnsTurn = input.enableNativeToolControlPlane === true;
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
  const nativeToolLoop = nativeToolControlPlaneOwnsTurn && taskBrief ? createMainAgentToolLoopOptions({
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
  const rawAgentResponse = taskIntake.precomputedTurn ?? await input.agent.respond({
    userMessage: teacherContent,
    toolControlPlane: nativeToolControlPlaneOwnsTurn ? "native" : "outer",
    responseStyle: input.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: project.generationIntensity,
    taskBrief,
    intentGrant: input.enableTaskGrantAutonomy ? intentGrant : undefined,
    availableArtifactKinds,
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan, semanticSnapshot),
    agentToolLoop: nativeToolLoop,
    onProgress,
  });
  if (nativeToolLoop) {
    input.triggerMessage = (await input.service.getMessages(input.projectId))
      .find((message) => message.id === input.triggerMessage.id) ?? input.triggerMessage;
    if (taskBrief) {
      taskAggregate = await input.controlPlaneStore.getTaskAggregate(input.projectId, taskBrief.intentEpoch)
        ?? taskAggregate;
    }
  }
  const rawAgentTurn = applyCapabilityAvailabilityToTurn(rawAgentResponse, capabilityAvailability);
  const controlResolution = resolveConversationControl({
    userMessage: teacherContent,
    pendingPlan,
    receivedConfirmedActionId: controlConfirmedActionId,
    receivedActorUserId: resolveConversationActorUserId(input.service, input.projectId, input.executionIdentity),
    agentTurn: rawAgentTurn,
    capabilityAvailability,
    intentGrant: input.enableTaskGrantAutonomy ? intentGrant : undefined,
    externalProviderCallsUsed,
  });
  const agentTurn = controlResolution.turn;
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
  const effectiveConfirmedActionId = confirmedActionId
    ?? (controlResolution.decision.usePendingActionId ? pendingPlan?.actionId : undefined);
  const confirmedBudgetDecision = pendingPlan?.actionId === effectiveConfirmedActionId &&
    (pendingPlan?.pendingDecision?.kind === "budget_disclosure" || pendingPlan?.pendingDecision?.kind === "budget_upgrade")
    ? pendingPlan.pendingDecision
    : undefined;
  if (confirmedBudgetDecision && intentGrant && taskBrief) {
    intentGrant = confirmedBudgetDecision.kind === "budget_disclosure"
      ? discloseStandardTaskBudget(intentGrant, taskBrief)
      : {
          ...intentGrant,
          budgetPolicyVersion: confirmedBudgetDecision.budgetPolicyVersion,
          maxCostCredits: confirmedBudgetDecision.maxCostCredits,
          maxExternalProviderCalls: confirmedBudgetDecision.maxExternalProviderCalls,
        };
    const messageMetadata = {
      ...input.triggerMessage.metadata,
      taskBrief,
      intentGrant,
    };
    await input.controlPlaneStore.commitIntentGrantWithMessage({
      taskBrief,
      intentGrant,
      messageId: input.triggerMessage.id,
      messageMetadata,
    });
    input.triggerMessage = { ...input.triggerMessage, metadata: messageMetadata };
    taskAggregate = taskAggregate ? { ...taskAggregate, intentGrant } : taskAggregate;
  }
  const effectivePendingPlan = pendingPlan && intentGrant
    ? { ...pendingPlan, intentGrant }
    : pendingPlan;

  if (controlResolution.decision.supersedePendingAction && pendingPlan && effectivePendingPlan) {
    await updatePendingPlanStatus(
      input.service,
      input.projectId,
      effectivePendingPlan,
      controlResolution.decision.pendingPlanStatus ?? "superseded",
    );
    const currentIntentEpoch = project.intentEpoch ?? 0;
    const planVersion = controlResolution.decision.advanceIntentEpoch
      ? await input.service.advanceProjectIntentEpoch(input.projectId, currentIntentEpoch)
      : currentIntentEpoch;
    const isPause = controlResolution.decision.kind === "pause_active_offer";
    const isCancel = controlResolution.decision.kind === "cancel_active_offer";
    const revisionObservation = createAgentObservation({
      projectId: input.projectId,
      source: "teacher_revision",
      status: isPause || isCancel ? "needs_input" : "repair",
      actionKey: `${controlResolution.decision.kind}:${pendingPlan.toolPlan.capabilityId}`,
      inputHash: hashRunInput({
        planId: pendingPlan.toolPlan.planId,
        previousIntentEpoch: currentIntentEpoch,
        planVersion,
        teacherContent,
      }),
      reasonCodes: [controlResolution.decision.reasonCode],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: pendingPlan.toolPlan.capabilityId,
      minimalNextAction: isPause || isCancel ? "pause" : "repair_upstream",
      teacherSafeSummary: isPause
        ? "已暂停刚才待执行的内容。"
        : isCancel ? "已取消刚才待执行的内容。" : "已按新的要求废止旧计划，后续内容会重新核对。",
    });
    const observationMetadata = appendAgentObservationMetadata(input.triggerMessage.metadata, revisionObservation);
    const checkpointMetadata = controlResolution.decision.createPauseCheckpoint
      ? appendRunCheckpointMetadata(observationMetadata, createRunCheckpoint({
          projectId: input.projectId,
          planVersion,
          reason: "teacher_requested_pause",
          actionKey: `${pendingPlan.toolPlan.capabilityId}:${pendingPlan.toolPlan.expectedArtifactKind ?? ""}`,
          inputHash: revisionObservation.inputHash,
          observationRefs: [revisionObservation.observationId],
        }))
      : clearRunCheckpointMetadata(observationMetadata);
    await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...checkpointMetadata,
      conversationControlImpact: createConversationControlImpact({
        decision: controlResolution.decision,
        previousIntentEpoch: currentIntentEpoch,
        nextIntentEpoch: planVersion,
        capabilityId: pendingPlan.toolPlan.capabilityId,
        sourceActionId: pendingPlan.actionId,
        teacherMessage: teacherContent,
        artifacts,
      }),
    });
  }

  if (nativeToolControlPlaneOwnsTurn && agentTurn.shouldRunToolNow && (agentTurn.toolPlan || pendingPlan?.toolPlan)) {
    const content = "当前任务编排状态需要重新同步，系统没有执行重复计划。";
    const observation = createAgentObservation({
      projectId: input.projectId,
      source: "tool",
      status: "blocked",
      actionKey: "legacy_outer_tool_plan",
      inputHash: hashRunInput({
        taskId: taskBrief?.taskId,
        intentEpoch: project.intentEpoch ?? 0,
        toolPlan: agentTurn.toolPlan ?? pendingPlan?.toolPlan,
      }),
      reasonCodes: ["single_orchestrator_violation", "legacy_outer_tool_plan_rejected"],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: "orchestrator_runtime",
      minimalNextAction: "repair_upstream",
      teacherSafeSummary: content,
    });
    input.triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...appendAgentObservationMetadata(input.triggerMessage.metadata, observation),
      orchestrationMode: "native_function_loop_only",
    });
    if (taskBrief) {
      await input.controlPlaneStore.appendEvent({
        eventId: crypto.randomUUID(),
        projectId: input.projectId,
        taskId: taskBrief.taskId,
        runId: `turn:${input.triggerMessage.id}`,
        intentEpoch: taskBrief.intentEpoch,
        kind: "run_failed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: { reasonCode: "single_orchestrator_violation", observationId: observation.observationId },
      });
    }
    const assistantMessage = await input.service.addMessage(input.projectId, {
      role: "assistant",
      content,
      metadata: { orchestrationMode: "native_function_loop_only" },
    });
    return {
      message: input.triggerMessage,
      assistantMessage,
      agentTurn: {
        ...agentTurn,
        assistantMessage: { body: content },
        state: "failed_blocked",
        shouldRunToolNow: false,
        toolPlan: undefined,
        deliveryPlan: undefined,
        artifactRefs: [],
      },
    };
  }

  if (agentTurn.shouldRunToolNow && (agentTurn.toolPlan || pendingPlan?.toolPlan)) {
    const executionPendingPlan = controlResolution.decision.supersedePendingAction ? null : effectivePendingPlan;
    return runPlannedArtifact({
      service: input.service,
      runtime: input.runtime,
      toolRouter: input.toolRouter,
      project,
      artifacts,
      pendingPlan: executionPendingPlan,
      plannedTurn: {
        ...agentTurn,
        toolPlan: enrichToolPlanWithTaskContext(
          agentTurn.toolPlan ?? executionPendingPlan?.toolPlan,
           taskBrief ?? executionPendingPlan?.taskBrief,
           intentGrant ?? executionPendingPlan?.intentGrant,
        ),
         deliveryPlan: agentTurn.deliveryPlan ?? executionPendingPlan?.deliveryPlan,
      },
      capabilityAvailability,
      budgetEvents,
      agentObservations,
      contextTokenEstimate: contextPackage.tokenEstimate,
      reference,
      confirmedActionId: effectiveConfirmedActionId,
      triggerMessage: input.triggerMessage,
      generationUserMessage: executionPendingPlan?.teacherRequest ?? teacherContent,
      agent: input.agent,
      agentToolExecutor: input.agentToolExecutor,
      executionIdentity: input.executionIdentity,
      executionFence: input.executionFence,
      enableTaskGrantAutonomy: input.enableTaskGrantAutonomy,
      enableNativeToolControlPlane: input.enableNativeToolControlPlane,
      controlPlaneStore: input.controlPlaneStore,
      businessSkillRuntime: input.businessSkillRuntime,
      businessSkillRuntimeMode: input.businessSkillRuntimeMode,
      intentGrant,
    });
  }
  const persistentTimeline = collectPersistentTeacherMessageParts(
    await input.controlPlaneStore.listEvents(input.projectId),
    `turn:${input.triggerMessage.id}`,
  );
  const persistedNativePendingPlan = parsePendingDeliveryPlanMetadata(input.triggerMessage.metadata.pendingDeliveryPlan);
  const assistantMetadata = mergeMessageMetadata(
      createPendingDeliveryPlanMetadata(
        agentTurn,
        controlResolution.decision.kind === "resume_paused_offer" && pendingPlan ? pendingPlan.teacherRequest : teacherContent,
        taskBrief,
        intentGrant,
        externalProviderCallsUsed,
      ) ?? (persistedNativePendingPlan ? { pendingDeliveryPlan: persistedNativePendingPlan } : undefined),
    createUnavailableCapabilityObservationMetadata(input.projectId, input.triggerMessage, agentTurn, capabilityAvailability),
    runtimeFailureMetadata,
    { conversationControlDecision: controlResolution.decision },
    persistentTimeline.length ? { agentTimeline: persistentTimeline } : undefined,
    isDialogueCheckpoint(input.triggerMessage.metadata.dialogueCheckpoint)
      ? { dialogueCheckpoint: input.triggerMessage.metadata.dialogueCheckpoint }
      : undefined,
  );
  const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.projectId, {
    role: "assistant",
    content: appendPendingDecisionNotice(
      formatAssistantContent(agentTurn.assistantMessage),
      agentTurn,
      project,
      intentGrant,
      externalProviderCallsUsed,
      taskBrief,
    ),
    metadata: assistantMetadata,
  });

  return { message: input.triggerMessage, assistantMessage, agentTurn };
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
    try {
      return getCapabilityDefinition(toolName as CapabilityId).userLabel;
    } catch {
      return "执行当前步骤";
    }
  }
}

const taskOutputTeacherLabels: Record<string, string> = {
  requirement_spec: "需求规格",
  lesson_plan: "公开课教案",
  ppt: "可编辑 PPTX",
  ppt_outline: "PPT 结构候选",
  video_script: "视频脚本",
  image: "图片资产",
  video: "视频成片",
  package: "完整材料包",
};

function taskScopeTeacherProjection(taskBrief: TaskBrief) {
  const requested = [...new Set(taskBrief.requestedOutputs.map(taskOutputTeacherLabel))];
  const excluded = [...new Set(taskBrief.excludedOutputs.map(taskOutputTeacherLabel))];
  const requestedLabel = requested.join("、") || "当前任务成果";
  return {
    inputSummary: [
      `交付范围：${requestedLabel}`,
      ...(excluded.length ? [`明确不包含：${excluded.join("、")}`] : []),
    ],
    expectedOutput: `可继续审阅的${requestedLabel}`,
  };
}

function taskOutputTeacherLabel(output: string) {
  return taskOutputTeacherLabels[output] ?? output;
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
  activePlans: PendingDeliveryPlanSnapshot[];
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
  for (const plan of input.activePlans) {
    await updatePendingPlanStatus(input.service, input.project.id, plan, pendingStatus);
  }

  const nextIntentEpoch = input.control.advanceIntentEpoch
    ? await input.service.advanceProjectIntentEpoch(input.project.id, previousIntentEpoch)
    : previousIntentEpoch;
  const nextProject = { ...input.project, intentEpoch: nextIntentEpoch };
  const controlArtifacts = input.control.kind === "redirect"
    ? await input.service.getArtifacts(input.project.id)
    : [];
  const domainImpact = input.control.kind === "redirect"
    ? resolveDomainRevisionImpact(input.control.userMessage, controlArtifacts)
    : null;
  const impactScope = input.control.kind === "redirect"
    ? domainImpact?.nextAction === "repair_unit" ? "unit" : "upstream"
    : "task";
  const controlReasonCode = input.control.kind === "redirect" && input.activePlans.length === 0
    ? "teacher_redirected_without_pending_plan"
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
      supersededPlanIds: input.activePlans.map((plan) => plan.toolPlan.planId),
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
    await input.controlPlaneStore.upsertTaskAggregate({
      taskBrief: input.previousTaskBrief,
      intentGrant: previousIntentGrant,
      plan: previousAggregate ? { ...previousAggregate.plan, status: aggregateStatus } : {
        planId: input.activePlans[0]?.toolPlan.planId ?? `plan:${input.previousTaskBrief.taskId}`,
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
    shouldRunToolNow: false,
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

function enrichToolPlanWithTaskContext(
  toolPlan: CapabilityToolPlan | undefined,
  taskBrief?: TaskBrief,
  intentGrant?: IntentGrant,
): CapabilityToolPlan | undefined {
  if (!toolPlan || !taskBrief || !intentGrant) return toolPlan;
  return {
    ...toolPlan,
    inputDraft: {
      ...toolPlan.inputDraft,
      taskBrief: structuredClone(taskBrief),
      intentGrant: structuredClone(intentGrant),
    },
  };
}

function applyCapabilityAvailabilityToTurn(
  agentTurn: MainAgentTurn,
  capabilityAvailability: CapabilityAvailabilityEntry[],
): MainAgentTurn {
  if (!agentTurn.toolPlan) return agentTurn;
  const availability = capabilityAvailability.find((entry) => entry.capabilityId === agentTurn.toolPlan?.capabilityId);
  if (!availability || availability.status === "available") return agentTurn;

  return {
    ...agentTurn,
    assistantMessage: { body: availability.reasonForUser },
    state: availability.status === "provider_unavailable" || availability.status === "blocked" ? "failed_blocked" : "collecting_inputs",
    toolPlan: {
      ...agentTurn.toolPlan,
      reasonForUser: availability.reasonForUser,
      internalReason: `${agentTurn.toolPlan.internalReason};capability_unavailable:${availability.status}`,
      requiresConfirmation: false,
    },
    shouldRunToolNow: false,
    artifactRefs: [],
  };
}

async function runPlannedArtifact(input: {
  service: WorkbenchService;
  runtime: AgentRuntime;
  toolRouter: typeof routeToolCall;
  project: ProjectRecord;
  artifacts: ArtifactRecord[];
  pendingPlan: PendingDeliveryPlanSnapshot | null;
  plannedTurn: MainAgentTurn;
  capabilityAvailability: CapabilityAvailabilityEntry[];
  budgetEvents: ReturnType<typeof readAgentHarnessBudgetEventsFromMessages>;
  agentObservations: AgentObservation[];
  contextTokenEstimate: number;
  reference: string;
  triggerMessage: ConversationMessageRecord;
  generationUserMessage: string;
  confirmedActionId?: string;
  agent: MainConversationAgent;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionFence?: ProjectExecutionFence;
  enableTaskGrantAutonomy?: boolean;
  enableNativeToolControlPlane?: boolean;
  controlPlaneStore: ControlPlaneStore;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode: "optional" | "required";
  intentGrant?: IntentGrant;
  autonomousToolRoundsUsed?: number;
}): Promise<MessageTurnResponse> {
  const generationUserMessage = input.generationUserMessage;
  const plannedTurn = input.plannedTurn;

  if (!plannedTurn.toolPlan) {
    const assistantPrompt = "我还没有拿到可以确认执行的备课任务。请先告诉我年级、学科、课题和想要的材料，我会先整理计划再让你确认。";
    const blockedTurn: MainAgentTurn = {
      assistantMessage: { body: assistantPrompt },
      state: "collecting_inputs",
      quickReplies: [
        { label: "做公开课课件", prompt: "我想做一节小学数学公开课课件。", recommended: true },
        { label: "补充年级课题", prompt: "五年级数学百分数，帮我做公开课 PPT 大纲。" },
      ],
      recommendedOptions: [],
      shouldRunToolNow: false,
      runtimeKind: plannedTurn.runtimeKind,
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: assistantPrompt,
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: blockedTurn };
  }

  const actionKey = buildToolActionKey(plannedTurn.toolPlan);
  const actionInputHash = buildReActActionInputHash(input, plannedTurn.toolPlan);

  const availability = input.capabilityAvailability.find((entry) => entry.capabilityId === plannedTurn.toolPlan?.capabilityId);
  if (availability && availability.status !== "available") {
    const assistantPrompt = availability.reasonForUser;
    const observationKind: ToolObservationKind = availability.status === "provider_unavailable" ? "provider_unavailable" : "blocked_by_policy";
    const observation = createToolObservation({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      kind: observationKind,
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: availability.reasonForModel,
    });
    const budgetEvent = buildAgentHarnessBudgetEvent({
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      status: "blocked",
      kind: observationKind,
    });
    const blockedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: observation.teacherSafeSummary },
      state: availability.status === "provider_unavailable" || availability.status === "blocked" ? "failed_blocked" : "collecting_inputs",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, observation),
        ...appendAgentObservationMetadata(undefined, createAgentObservationFromToolObservation({
          projectId: input.project.id,
          actionKey,
          inputHash: actionInputHash,
          observation,
          status: availability.status === "needs_approved_inputs" ? "needs_input" : "blocked",
        })),
        agentHarnessBudgetEvent: budgetEvent,
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: blockedTurn };
  }

  const planGuardResult = evaluateToolPlan({
    capabilityId: plannedTurn.toolPlan.capabilityId,
    toolRequiresConfirmation: plannedTurn.toolPlan.requiresConfirmation,
    hasHumanConfirmation: Boolean(input.confirmedActionId),
    expectedActionId: input.pendingPlan?.actionId,
    confirmedActionId: input.confirmedActionId,
    intentGrant: input.enableTaskGrantAutonomy ? input.intentGrant : undefined,
    externalProviderCallsUsed: countExternalProviderCalls(input.budgetEvents),
    expectedScope: {
      projectId: input.project.id,
      intentEpoch: input.project.intentEpoch ?? 0,
      intensity: input.project.generationIntensity ?? "standard",
    },
  });

  if (planGuardResult.status !== "allowed") {
    const assistantPrompt = "我还没有拿到这一步的有效确认，请先确认当前待执行任务后再继续。";
    const observation = createToolObservation({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      kind: "blocked_by_policy",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `plan_guard_blocked:${planGuardResult.status}`,
    });
    const budgetEvent = buildAgentHarnessBudgetEvent({
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      status: "blocked",
      kind: "blocked_by_policy",
    });
    const blockedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: observation.teacherSafeSummary },
      state: "collecting_inputs",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, observation),
        ...appendAgentObservationMetadata(undefined, createAgentObservationFromToolObservation({
          projectId: input.project.id,
          actionKey,
          inputHash: actionInputHash,
          observation,
          status: "needs_input",
        })),
        agentHarnessBudgetEvent: budgetEvent,
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: blockedTurn };
  }


  const reactDecision = guardReActTransition({
    projectId: input.project.id,
    planVersion: input.project.intentEpoch ?? 0,
    candidate: { actionKey, inputHash: actionInputHash, requestedNextAction: "continue" },
    latestObservation: input.agentObservations.at(-1),
    observationHistory: input.agentObservations,
  });
  if (!reactDecision.allowed && "checkpoint" in reactDecision) {
    const summary = reactDecision.nextAction === "ask_teacher"
      ? "同一步在相同输入下连续失败，我已暂停原样重试。请调整要求或材料后再继续。"
      : "当前处理已暂停，可以稍后从这里继续。";
    const observation = createAgentObservation({
      projectId: input.project.id,
      source: "budget",
      status: "needs_input",
      actionKey,
      inputHash: actionInputHash,
      reasonCodes: reactDecision.reasonCodes,
      reportRefs: [],
      targetLocators: [],
      responsibleStage: plannedTurn.toolPlan.capabilityId,
      minimalNextAction: reactDecision.nextAction,
      teacherSafeSummary: summary,
    });
    const metadata = appendRunCheckpointMetadata(
      appendAgentObservationMetadata(undefined, observation),
      reactDecision.checkpoint,
    );
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: summary,
      metadata,
    });
    return {
      message: input.triggerMessage,
      assistantMessage,
      agentTurn: {
        ...plannedTurn,
        assistantMessage: { body: summary },
        state: "failed_blocked",
        shouldRunToolNow: false,
        artifactRefs: [],
      },
    };
  }

  const budgetDecision = evaluateAgentHarnessBudget({
    capabilityId: plannedTurn.toolPlan.capabilityId,
    actionKey: buildToolActionKey(plannedTurn.toolPlan),
    events: input.budgetEvents,
    contextTokenEstimate: input.contextTokenEstimate,
    isSideEffectful: plannedTurn.toolPlan.requiresConfirmation,
    hasConfirmedHumanGate: Boolean(input.confirmedActionId),
    policy: {
      maxSameActionRepeat: Number.MAX_SAFE_INTEGER,
      maxRetryPerCapability: Number.MAX_SAFE_INTEGER,
    },
  });

  if (!budgetDecision.allowed) {
    const assistantPrompt = budgetDecision.teacherSafeSummary ?? "这一步已经多次没有完成，建议先调整材料或确认要求后再继续。";
    const observation = createToolObservation({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      kind: "retry_exhausted",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `budget_blocked:${budgetDecision.reason ?? "unknown"}`,
    });
    const budgetEvent = buildAgentHarnessBudgetEvent({
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      status: "blocked",
      kind: "retry_exhausted",
    });
    const blockedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: observation.teacherSafeSummary },
      state: "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const budgetPauseDecision = guardReActTransition({
      projectId: input.project.id,
      planVersion: input.project.intentEpoch ?? 0,
      candidate: { actionKey, inputHash: actionInputHash, requestedNextAction: "continue" },
      observationHistory: input.agentObservations,
      budgetExhausted: true,
    });
    if (budgetPauseDecision.allowed || !("checkpoint" in budgetPauseDecision)) {
      throw new Error("Budget exhaustion did not create a paused checkpoint.");
    }
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, observation),
        ...appendAgentObservationMetadata(undefined, createAgentObservationFromToolObservation({
          projectId: input.project.id,
          actionKey,
          inputHash: actionInputHash,
          observation,
          status: "blocked",
          reasonCodes: [budgetDecision.reason ?? "budget_exhausted"],
        })),
        ...appendRunCheckpointMetadata(undefined, budgetPauseDecision.checkpoint),
        agentHarnessBudgetEvent: budgetEvent,
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: blockedTurn };
  }

  const toolRouterResult = await runToolRouterCapability(input);
  if (toolRouterResult) return toolRouterResult;

  const result = await runCapabilityWithAgentRuntime({
    runtime: input.runtime,
    projectId: input.project.id,
    capabilityId: plannedTurn.toolPlan.capabilityId,
    userMessage: input.reference ? `${generationUserMessage}\n\n引用：${input.reference}` : generationUserMessage,
    projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
    sourceMessageId: input.triggerMessage.id,
  });

  if (result.status !== "succeeded") {
    const rawAssistantPrompt = result.status === "failed" ? result.userMessage : result.assistantPrompt;
    const observationKind = result.status === "needs_input" ? "blocked_by_policy" : capabilityRunFailureKindToObservationKind(result.errorCategory);
    const observation = createToolObservation({
      projectId: input.project.id,
      runId: result.status === "failed" ? result.runtimeRun?.runId : undefined,
      sourceMessageId: input.triggerMessage.id,
      inputDigest: actionInputHash,
      errorCategory: result.status === "failed" ? result.errorCategory : undefined,
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      kind: observationKind,
      teacherSafeSummary: rawAssistantPrompt,
      internalReasonSanitized: result.status === "failed" ? `capability_failed:${result.errorCategory}` : "capability_needs_input",
      retryPolicy: result.status === "failed"
        ? { retryable: result.retryable, nextAction: result.errorCategory === "validation" ? "fix_inputs" : "retry_later" }
        : { retryable: false, nextAction: "fix_inputs" },
    });
    const budgetEvent = buildAgentHarnessBudgetEvent({
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      status: result.status === "needs_input" ? "blocked" : result.retryable ? "retryable_failed" : "failed",
      kind: observationKind,
    });
    const failedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: observation.teacherSafeSummary },
      state: result.status === "needs_input" ? "needs_input" : result.retryable ? "failed_retryable" : "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const failureObservation = createAgentObservationFromToolObservation({
      projectId: input.project.id,
      actionKey,
      inputHash: actionInputHash,
      observation,
      status: result.status === "needs_input" ? "needs_input" : "failed",
      reasonCodes: [
        observation.kind,
        ...(result.status === "failed" ? [result.errorCategory] : []),
      ],
    });
    const failureMetadata = {
      ...appendToolObservationMetadata(undefined, observation),
      ...appendAgentObservationMetadata(undefined, failureObservation),
      agentHarnessBudgetEvent: budgetEvent,
    };
    if (plannedTurn.runtimeKind === "openai") {
      return replanAfterBusinessToolResult({
        input,
        reason: "tool_failed",
        actionKey,
        observationIds: [failureObservation.observationId],
        resultMetadata: failureMetadata,
        result,
      });
    }
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...failureMetadata,
        orchestrationMode: "single_tool_test_runtime",
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: failedTurn, result };
  }

  const artifact = await input.service.saveArtifact(input.project.id, {
    nodeKey: result.artifactDraft.nodeKey as WorkflowNodeKey,
    kind: result.artifactDraft.kind as ArtifactKind,
    title: result.artifactDraft.title,
    status: "needs_review",
    summary: result.artifactDraft.summary,
    markdownContent: result.artifactDraft.markdownContent ?? "",
    structuredContent: result.artifactDraft.structuredContent,
    origin: "tool_result",
  });
  const successObservation = createSucceededAgentObservation({
    projectId: input.project.id,
    actionKey,
    inputHash: actionInputHash,
    capabilityId: plannedTurn.toolPlan.capabilityId,
    artifactKind: artifact.kind,
    artifactId: artifact.id,
  });
  const successMetadata = mergeMessageMetadata(
    createToolSucceededBudgetMetadata(plannedTurn.toolPlan),
    clearRunCheckpointMetadata(appendAgentObservationMetadata(undefined, successObservation)),
  );
  if (plannedTurn.runtimeKind === "openai") {
    return replanAfterBusinessToolResult({
      input,
      reason: "tool_succeeded",
      actionKey,
      observationIds: [successObservation.observationId],
      resultMetadata: successMetadata ?? {},
      artifact,
      result,
    });
  }
  const succeededTurn: MainAgentTurn = {
    ...plannedTurn,
    assistantMessage: { body: result.assistantSummary },
    state: "succeeded",
    quickReplies: [],
    shouldRunToolNow: false,
    artifactRefs: [artifact.id],
  };
  if (input.pendingPlan) {
    await input.service.updateMessageMetadata(input.project.id, input.pendingPlan.messageId, {
      ...input.pendingPlan.messageMetadata,
      pendingDeliveryPlan: {
        ...input.pendingPlan,
        status: "confirmed",
        messageId: undefined,
        messageMetadata: undefined,
      },
    });
  }
  const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.project.id, {
    role: "assistant",
    content: result.assistantSummary,
    artifactRefs: [artifact.id],
    metadata: mergeMessageMetadata(
      createToolSucceededBudgetMetadata(plannedTurn.toolPlan),
      clearRunCheckpointMetadata(appendAgentObservationMetadata(undefined, createSucceededAgentObservation({
        projectId: input.project.id,
        actionKey,
        inputHash: actionInputHash,
        capabilityId: plannedTurn.toolPlan.capabilityId,
        artifactKind: artifact.kind,
        artifactId: artifact.id,
      }))),
      { orchestrationMode: "single_tool_test_runtime" },
    ),
  });

  return {
    message: input.triggerMessage,
    assistantMessage,
    agentTurn: succeededTurn,
    artifact,
  };
}

async function runToolRouterCapability(input: Parameters<typeof runPlannedArtifact>[0]): Promise<MessageTurnResponse | null> {
  const plannedTurn = input.plannedTurn;
  const toolPlan = plannedTurn.toolPlan;
  if (!toolPlan || !toolRouterCapabilityIds.has(toolPlan.capabilityId)) return null;
  const actionKey = buildToolActionKey(toolPlan);
  const actionInputHash = buildReActActionInputHash(input, toolPlan);

  const generationUserMessage = input.generationUserMessage;
  const userInstruction = input.reference ? `${generationUserMessage}\n\n引用：${input.reference}` : generationUserMessage;
  const approvedArtifacts = buildApprovedArtifactInputs(input.artifacts);
  const executionArtifacts = toolPlan.capabilityId === "ppt_page_repair"
    ? input.artifacts.filter((artifact) => isArtifactTrustedForDownstream(artifact) || isRepairablePptArtifact(artifact))
    : input.artifacts.filter(isArtifactTrustedForDownstream);
  const artifactRefs = buildProviderArtifactRefs(executionArtifacts);
  const pptDirectorPlan = toolPlan.capabilityId === "ppt_design"
    ? await resolvePersistedPptDirectorPlan(input)
    : undefined;
  const toolDefinition = getToolDefinitionByCapabilityId(toolPlan.capabilityId);
  const executionBoundary = await resolveCompatibilityToolExecutionBoundary({
    input,
    toolName: toolDefinition.id,
    arguments: toolPlan.inputDraft,
  });
  if (executionBoundary.status === "failed") {
    return finalizeFailedToolRouterResult({
      input,
      toolPlan,
      result: buildToolExecutionBoundaryFailureResult(input, toolPlan, toolDefinition, executionBoundary.reasonCode),
      actionKey,
      actionInputHash,
      jobId: null,
    });
  }

  const videoUnitId = toolPlan.capabilityId === "video_segment_generate" ? resolveSingleVideoShotId(toolPlan.inputDraft) : undefined;
  const generationJob = toolPlan.capabilityId === "video_segment_generate" && !videoUnitId
    ? null
    : resolveProviderGenerationJob(toolPlan.capabilityId, input.artifacts);
  let jobId: string | null = null;
  let activeGenerationJob: Awaited<ReturnType<WorkbenchService["startGenerationJobForExecution"]>> | null = null;
  const gatewayResult = await executeThroughToolGateway<MessageTurnResponse | ToolExecutionResult>({
    request: executionBoundary.request,
    current: executionBoundary.current,
    executionEnvelope: executionBoundary.executionEnvelope,
    execute: async ({ executionEnvelope }) => {
      if (generationJob) {
        const queuedJob = await input.service.createGenerationJob(input.project.id, {
          kind: generationJob.kind,
          sourceArtifactId: generationJob.sourceArtifact.id,
          capabilityId: toolPlan.capabilityId,
          ...(videoUnitId ? { unitId: videoUnitId } : {}),
          sourceArtifactIds: input.artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.id),
          inputSnapshot: {
            userInstruction,
            toolInput: structuredClone(toolPlan.inputDraft),
            artifacts: input.artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => ({
              id: artifact.id,
              kind: artifact.kind,
              nodeKey: artifact.nodeKey,
              version: artifact.version,
              updatedAt: artifact.updatedAt,
            })),
          },
        });
        jobId = queuedJob.id;
        const recovered = queuedJob.status === "succeeded" && queuedJob.resultArtifactId
          ? { artifact: await input.service.getArtifact(input.project.id, queuedJob.resultArtifactId) }
          : await input.service.resumeStagedGenerationResult(input.project.id, jobId);
        if (recovered) {
          const artifact = recovered.artifact;
          const assistantMessage = await input.service.addMessage(input.project.id, {
            role: "assistant",
            content: `已复用当前输入对应的${artifact.title}，没有重复调用生成服务。`,
            artifactRefs: [artifact.id],
            metadata: clearRunCheckpointMetadata(appendAgentObservationMetadata(undefined, createSucceededAgentObservation({
              projectId: input.project.id,
              actionKey,
              inputHash: actionInputHash,
              capabilityId: toolPlan.capabilityId,
              artifactKind: artifact.kind,
              artifactId: artifact.id,
            }))),
          });
          return {
            message: input.triggerMessage,
            assistantMessage,
            artifact,
            agentTurn: {
              ...plannedTurn,
              assistantMessage: { body: assistantMessage.content },
              state: "succeeded",
              shouldRunToolNow: false,
              artifactRefs: [artifact.id],
            },
          };
        }
        activeGenerationJob = await input.service.startGenerationJobForExecution(input.project.id, jobId);
        if (activeGenerationJob.job.status === "submission_unknown") {
          const content = "生成任务的恢复信息需要核对，系统没有自动重复提交。";
          const assistantMessage = await input.service.addMessage(input.project.id, {
            role: "assistant",
            content,
            metadata: appendAgentObservationMetadata(undefined, createAgentObservation({
              projectId: input.project.id,
              source: "tool",
              status: "inconclusive",
              actionKey,
              inputHash: actionInputHash,
              reasonCodes: ["submission_unknown"],
              reportRefs: [],
              targetLocators: [],
              responsibleStage: toolPlan.capabilityId,
              minimalNextAction: "pause",
              teacherSafeSummary: content,
            })),
          });
          return {
            message: input.triggerMessage,
            assistantMessage,
            agentTurn: {
              ...plannedTurn,
              assistantMessage: { body: content },
              state: "failed_blocked",
              shouldRunToolNow: false,
              artifactRefs: [],
            },
          };
        }
      }

      return input.toolRouter({
        toolName: toolDefinition.id,
        capabilityId: toolPlan.capabilityId,
        projectId: input.project.id,
        project: input.project,
        userInstruction,
        toolInput: toolPlan.inputDraft,
        runtime: input.runtime,
        projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
        approvedArtifacts,
        artifactRefs,
        resolvedArtifacts: executionArtifacts,
        sourceMessageId: input.triggerMessage.id,
        executionInputHash: activeGenerationJob?.job.inputHash ?? actionInputHash,
        executionIntentEpoch: activeGenerationJob?.job.intentEpoch ?? input.project.intentEpoch ?? 0,
        executionEnvelope,
        pptDirectorPlan,
        generationTaskLifecycle: activeGenerationJob ? {
          providerTaskId: activeGenerationJob.providerTaskId,
          onTaskAccepted: async (providerTaskId) => {
            await input.service.recordGenerationProviderTask(input.project.id, activeGenerationJob!.job.id, { providerTaskId });
          },
          onPoll: async () => {
            await input.service.recordGenerationPoll(input.project.id, activeGenerationJob!.job.id);
          },
        } : undefined,
      });
    },
  });
  if ("message" in gatewayResult) return gatewayResult;
  if (!("toolId" in gatewayResult)) {
    return finalizeFailedToolRouterResult({
      input,
      toolPlan,
      result: buildToolExecutionBoundaryFailureResult(input, toolPlan, toolDefinition, gatewayResult.reasonCode),
      actionKey,
      actionInputHash,
      jobId,
    });
  }
  let result = gatewayResult;

  if (result.status === "succeeded" && toolDefinition.adapterKind === "provider" && !isVerifiedProviderToolSuccess(result)) {
    result = buildUnverifiedProviderResult(input, toolPlan);
  }
  if (result.status === "succeeded" && result.validationReport?.overallStatus !== "passed") {
    result = buildUnverifiedProviderResult(input, toolPlan);
  }

  if (result.status !== "succeeded") {
    return finalizeFailedToolRouterResult({ input, toolPlan, result, actionKey, actionInputHash, jobId });
  }
  if (!result.validationReport) {
    throw new Error("ToolRouter succeeded without a ValidationReport.");
  }

  const artifactInput = {
    nodeKey: result.artifactDraft.nodeKey as WorkflowNodeKey,
    kind: result.artifactDraft.kind as ArtifactKind,
    title: result.artifactDraft.title,
    status: "needs_review" as const,
    summary: result.artifactDraft.summary,
    markdownContent: result.artifactDraft.markdownContent ?? "",
    structuredContent: result.artifactDraft.structuredContent,
    origin: "tool_result" as const,
    validationReport: result.validationReport,
    taskId: executionBoundary.current.taskId,
    taskBriefDigest: executionBoundary.current.taskBriefDigest,
    intentEpoch: executionBoundary.current.intentEpoch,
  };
  const artifact = jobId
    ? (await input.service.commitGenerationResult(input.project.id, jobId, artifactInput)).artifact
    : await input.service.saveArtifact(input.project.id, artifactInput);
  const successObservation = createSucceededAgentObservation({
    projectId: input.project.id,
    actionKey,
    inputHash: actionInputHash,
    capabilityId: toolPlan.capabilityId,
    artifactKind: artifact.kind,
    artifactId: artifact.id,
    validationReport: result.validationReport,
  });
  const successMetadata = mergeMessageMetadata(
    createToolRouterBudgetMetadata(result, toolPlan),
    clearRunCheckpointMetadata(appendAgentObservationMetadata(undefined, successObservation)),
  );
  if (plannedTurn.runtimeKind === "openai") {
    return replanAfterBusinessToolResult({
      input,
      reason: "tool_succeeded",
      actionKey,
      observationIds: [successObservation.observationId],
      resultMetadata: successMetadata ?? {},
      artifact,
      result,
    });
  }
  const succeededTurn: MainAgentTurn = {
    ...plannedTurn,
    assistantMessage: { body: result.assistantSummary },
    state: "succeeded",
    quickReplies: [],
    shouldRunToolNow: false,
    artifactRefs: [artifact.id],
  };
  if (input.pendingPlan) {
    await input.service.updateMessageMetadata(input.project.id, input.pendingPlan.messageId, {
      ...input.pendingPlan.messageMetadata,
      pendingDeliveryPlan: {
        ...input.pendingPlan,
        status: "confirmed",
        messageId: undefined,
        messageMetadata: undefined,
      },
    });
  }
  const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.project.id, {
    role: "assistant",
    content: result.assistantSummary,
    artifactRefs: [artifact.id],
    metadata: mergeMessageMetadata(
      createToolRouterBudgetMetadata(result, toolPlan),
      clearRunCheckpointMetadata(appendAgentObservationMetadata(undefined, createSucceededAgentObservation({
        projectId: input.project.id,
        actionKey,
        inputHash: actionInputHash,
        capabilityId: toolPlan.capabilityId,
        artifactKind: artifact.kind,
        artifactId: artifact.id,
        validationReport: result.validationReport,
      }))),
      { orchestrationMode: "single_tool_test_runtime" },
    ),
  });

  return {
    message: input.triggerMessage,
    assistantMessage,
    agentTurn: succeededTurn,
    artifact,
    result,
  };
}

async function resolveCompatibilityToolExecutionBoundary(input: {
  input: Parameters<typeof runPlannedArtifact>[0];
  toolName: string;
  arguments: Record<string, unknown>;
}) {
  const turnInput = input.input;
  const intentEpoch = turnInput.project.intentEpoch ?? 0;
  const identity = turnInput.executionIdentity ?? turnInput.service.getExecutionIdentity();
  if (!identity?.actorUserId.trim()) {
    return { status: "failed" as const, reasonCode: "execution_identity_required" };
  }
  const aggregate = await turnInput.controlPlaneStore.getTaskAggregate(turnInput.project.id, intentEpoch);
  if (!aggregate) {
    return { status: "failed" as const, reasonCode: "task_aggregate_required" };
  }

  const intensity = turnInput.project.generationIntensity ?? aggregate.taskBrief.generationIntensity;
  const actionArguments = structuredClone(input.arguments);
  try {
    const executionEnvelope = createExecutionEnvelope({
      actorUserId: identity.actorUserId,
      taskBrief: aggregate.taskBrief,
      planRevision: aggregate.plan.revision,
      intensity,
      intentGrant: aggregate.intentGrant,
      action: { toolName: input.toolName, arguments: actionArguments },
    });
    return {
      status: "ready" as const,
      executionEnvelope,
      request: {
        toolName: input.toolName,
        projectId: turnInput.project.id,
        intentEpoch,
        arguments: actionArguments,
      },
      current: {
        actorUserId: identity.actorUserId,
        projectId: turnInput.project.id,
        taskId: aggregate.taskBrief.taskId,
        intentEpoch,
        planRevision: aggregate.plan.revision,
        intensity,
        taskBriefDigest: aggregate.taskBrief.digest,
      },
    };
  } catch {
    return { status: "failed" as const, reasonCode: "execution_envelope_invalid" };
  }
}

function buildToolExecutionBoundaryFailureResult(
  input: Parameters<typeof runPlannedArtifact>[0],
  toolPlan: CapabilityToolPlan,
  toolDefinition: ReturnType<typeof getToolDefinitionByCapabilityId>,
  reasonCode: string,
): Exclude<ToolExecutionResult, { status: "succeeded" }> {
  return {
    status: "failed",
    toolId: toolDefinition.id,
    capabilityId: toolPlan.capabilityId,
    observation: createToolObservation({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId: toolPlan.capabilityId,
      expectedArtifactKind: toolDefinition.producedArtifactKind,
      kind: "tool_failed",
      teacherSafeSummary: "这一步的任务执行信息不完整，我会保存当前进度并按最新任务重新规划。",
      internalReasonSanitized: reasonCode,
      retryPolicy: { retryable: false, nextAction: "skip_or_replan" },
    }),
    artifactCreated: false,
    errorCategory: reasonCode,
    reasonCode,
    budgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: toolPlan.capabilityId,
      expectedArtifactKind: toolDefinition.producedArtifactKind,
      status: "failed",
      kind: "tool_failed",
      providerSubmitted: false,
    }),
  };
}

async function finalizeFailedToolRouterResult(input: {
  input: Parameters<typeof runPlannedArtifact>[0];
  toolPlan: CapabilityToolPlan;
  result: Exclude<ToolExecutionResult, { status: "succeeded" }>;
  actionKey: string;
  actionInputHash: string;
  jobId: string | null;
}): Promise<MessageTurnResponse> {
  const turnInput = input.input;
  const errorCategory = "errorCategory" in input.result ? input.result.errorCategory : undefined;
  if (input.jobId) {
    if (errorCategory === "submission_unknown") {
      await turnInput.service.markGenerationSubmissionUnknown(
        turnInput.project.id,
        input.jobId,
        input.result.observation.teacherSafeSummary,
      );
    } else {
      await turnInput.service.failGenerationJob(turnInput.project.id, input.jobId, {
        errorMessage: input.result.observation.teacherSafeSummary,
      });
    }
  }
  const budgetEvent = normalizeToolRouterBudgetEvent(input.result, input.toolPlan);
  const failedTurn: MainAgentTurn = {
    ...turnInput.plannedTurn,
    assistantMessage: { body: input.result.observation.teacherSafeSummary },
    state: input.result.status === "needs_input"
      ? "needs_input"
      : input.result.status === "retryable_failed"
        ? "failed_retryable"
        : "failed_blocked",
    shouldRunToolNow: false,
    artifactRefs: [],
  };
  const failureObservation = createAgentObservationFromToolObservation({
    projectId: turnInput.project.id,
    actionKey: input.actionKey,
    inputHash: input.actionInputHash,
    observation: input.result.observation,
    validationReport: input.result.validationReport,
    status: input.result.status === "needs_input" ? "needs_input" : "failed",
    reasonCodes: [
      input.result.observation.kind,
      ...(errorCategory ? [errorCategory] : []),
    ],
  });
  const failureMetadata = {
    ...appendToolObservationMetadata(undefined, input.result.observation),
    ...appendAgentObservationMetadata(undefined, failureObservation),
    agentHarnessBudgetEvent: budgetEvent,
  };
  if (turnInput.plannedTurn.runtimeKind === "openai") {
    return replanAfterBusinessToolResult({
      input: turnInput,
      reason: "tool_failed",
      actionKey: input.actionKey,
      observationIds: [failureObservation.observationId],
      resultMetadata: failureMetadata,
      result: input.result,
    });
  }
  const assistantMessage = await turnInput.service.addMessage(turnInput.project.id, {
    role: "assistant",
    content: input.result.observation.teacherSafeSummary,
    metadata: {
      ...failureMetadata,
      orchestrationMode: "single_tool_test_runtime",
    },
  });
  return { message: turnInput.triggerMessage, assistantMessage, agentTurn: failedTurn, result: input.result };
}

async function resolvePersistedPptDirectorPlan(
  input: Parameters<typeof runPlannedArtifact>[0],
): Promise<PptDirectorPlanBinding | undefined> {
  const triggerMessage = (await input.service.getMessages(input.project.id))
    .find((message) => message.id === input.triggerMessage.id);
  const report = [...readAgentToolReportsFromMessages(triggerMessage ? [triggerMessage] : [])]
    .reverse()
    .find((candidate) =>
      candidate.toolId === "ppt_director.plan_or_repair" &&
      candidate.status === "succeeded" &&
      candidate.projectId === input.project.id &&
      candidate.intentEpoch === (input.project.intentEpoch ?? 0) &&
      candidate.structuredOutput !== null &&
      Array.isArray(candidate.approvedArtifactRefs) &&
      candidate.approvedArtifactRefs.length > 0,
    );
  if (!report?.structuredOutput) return undefined;
  return {
    invocationId: report.invocationId,
    projectId: report.projectId,
    intentEpoch: report.intentEpoch,
    structuredOutput: structuredClone(report.structuredOutput),
    approvedArtifactRefs: report.approvedArtifactRefs.map((ref) => ({
      artifactId: ref.artifactId,
      kind: ref.kind,
      version: ref.version,
      digest: ref.digest,
    })),
  };
}

function resolveSingleVideoShotId(inputDraft: Record<string, unknown>): string | undefined {
  const shotIds = inputDraft.shotIds;
  if (!Array.isArray(shotIds) || shotIds.length !== 1 || typeof shotIds[0] !== "string" || !/^shot_[a-z0-9_-]+$/i.test(shotIds[0])) {
    return undefined;
  }
  return shotIds[0];
}

async function replanAfterBusinessToolResult(input: {
  input: Parameters<typeof runPlannedArtifact>[0];
  reason: "tool_succeeded" | "tool_failed" | "quality_rework";
  actionKey: string;
  observationIds: string[];
  resultMetadata: Record<string, unknown>;
  artifact?: ArtifactRecord;
  result?: unknown;
}): Promise<MessageTurnResponse> {
  const turnInput = input.input;
  if (turnInput.pendingPlan) {
    await updatePendingPlanStatus(turnInput.service, turnInput.project.id, turnInput.pendingPlan, "confirmed");
  }
  const messageBeforeReplan = (await turnInput.service.getMessages(turnInput.project.id))
    .find((message) => message.id === turnInput.triggerMessage.id) ?? turnInput.triggerMessage;
  await turnInput.service.updateMessageMetadata(turnInput.project.id, turnInput.triggerMessage.id, mergeExecutionMetadata(
    messageBeforeReplan.metadata,
    input.resultMetadata,
    { orchestrationMode: "main_agent_observe_replan" },
  ) ?? {});

  const project = await turnInput.service.getProject(turnInput.project.id);
  const messages = await turnInput.service.getMessages(turnInput.project.id);
  const refreshedTriggerMessage = messages.find((message) => message.id === turnInput.triggerMessage.id) ?? turnInput.triggerMessage;
  const replanTaskBrief = isTaskBrief(refreshedTriggerMessage.metadata.taskBrief)
    ? refreshedTriggerMessage.metadata.taskBrief
    : undefined;
  const replanIntentGrant = isIntentGrant(refreshedTriggerMessage.metadata.intentGrant)
    ? {
        ...refreshedTriggerMessage.metadata.intentGrant,
        maxExternalProviderCalls: typeof refreshedTriggerMessage.metadata.intentGrant.maxExternalProviderCalls === "number"
          ? refreshedTriggerMessage.metadata.intentGrant.maxExternalProviderCalls
          : null,
      }
    : undefined;
  const replanTaskAggregate = await turnInput.controlPlaneStore.getTaskAggregate(
    turnInput.project.id,
    project.intentEpoch ?? 0,
  );
  const workflowNodes = await turnInput.service.getNodes(turnInput.project.id);
  const artifacts = await turnInput.service.getArtifacts(turnInput.project.id);
  const generationJobs = await turnInput.service.getGenerationJobs(turnInput.project.id);
  const turnJobs = await turnInput.service.getConversationTurnJobs(turnInput.project.id);
  const pendingPlan = findPendingDeliveryPlan(messages);
  const authoritativeReplanTaskBrief = replanTaskBrief ?? replanTaskAggregate?.taskBrief;
  const contextPackage = buildConversationContextPackage({
    project,
    messages,
    workflowNodes,
    artifacts,
    taskBrief: authoritativeReplanTaskBrief,
  });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
    taskBrief: replanTaskBrief,
  });
  const agentWorldState = buildAgentWorldState({
    project,
    taskBrief: authoritativeReplanTaskBrief ?? null,
    taskPlanRevision: replanTaskAggregate?.plan.revision ?? null,
    workflowNodes,
    artifacts,
    generationJobs,
    turnJobs,
    contextPackage,
    pendingPlan,
    toolObservations: readActiveToolObservationsFromMessages(messages),
    agentObservations: readAgentObservationsForCurrentIntent(messages, project.intentEpoch ?? 0),
    agentToolReports: readAgentToolReportsFromMessages(messages),
    runCheckpoint: readLatestRunCheckpointFromMessages(messages),
  });
  const replanAgentInput: MainConversationAgentInput = {
    userMessage: turnInput.generationUserMessage,
    toolControlPlane: turnInput.enableNativeToolControlPlane ? "native" : "outer",
    responseStyle: turnInput.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: project.generationIntensity,
    intentGrant: turnInput.enableTaskGrantAutonomy ? replanIntentGrant : undefined,
    availableArtifactKinds: artifacts
      .filter((artifact) => isArtifactTrustedForDownstream(artifact) && Boolean(replanTaskBrief && isArtifactBoundToTask(artifact, replanTaskBrief)))
      .map((artifact) => artifact.kind),
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan),
    agentToolLoop: turnInput.enableNativeToolControlPlane ? createMainAgentToolLoopOptions({
      service: turnInput.service,
      runtime: turnInput.runtime,
      project,
      triggerMessage: refreshedTriggerMessage,
      artifacts,
      identity: turnInput.executionIdentity,
      fence: turnInput.executionFence,
      executor: turnInput.agentToolExecutor,
      intentGrant: replanIntentGrant,
      taskBrief: replanTaskBrief,
      externalProviderCallsUsed: countExternalProviderCalls(readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0)),
      planRevision: replanTaskAggregate?.plan.revision,
      controlPlaneStore: turnInput.controlPlaneStore,
      businessSkillRuntime: turnInput.businessSkillRuntime,
      businessSkillRuntimeMode: turnInput.businessSkillRuntimeMode,
    }) : undefined,
    replanDirective: {
      reason: input.reason,
      previousActionKey: input.actionKey,
      observationIds: input.observationIds,
      ...(input.reason === "tool_failed" ? {
        repairAction: resolveToolFailureRepairAction(input.result),
        reliableDefaultsAvailable: hasReliableTaskDefaults(project, replanTaskBrief),
      } : {}),
    },
  };
  let replanned = applyCapabilityAvailabilityToTurn(
    await turnInput.agent.respond(replanAgentInput),
    capabilityAvailability,
  );
  let completionContractBlockedOutputs: string[] = [];
  const remainingRequestedOutputs = replanTaskBrief
    ? findRemainingRequestedOutputs(replanTaskBrief, artifacts)
    : [];
  if (turnInput.enableTaskGrantAutonomy &&
      input.reason === "tool_succeeded" &&
      !replanned.toolPlan &&
      replanned.state !== "failed_blocked" &&
      replanned.state !== "failed_retryable" &&
      remainingRequestedOutputs.length > 0) {
    replanned = applyCapabilityAvailabilityToTurn(
      await turnInput.agent.respond({
        ...replanAgentInput,
        replanDirective: {
          reason: "completion_contract_unsatisfied",
          previousActionKey: input.actionKey,
          observationIds: input.observationIds,
          remainingRequestedOutputs,
        },
      }),
      capabilityAvailability,
    );
    if (!replanned.toolPlan) {
      completionContractBlockedOutputs = remainingRequestedOutputs;
      replanned = {
        ...replanned,
        assistantMessage: {
          body: "当前任务还没有完成，我已保存进度，但这轮没有形成可执行的下一步。请稍后从当前进度继续。",
        },
        state: "failed_blocked",
        shouldRunToolNow: false,
      };
    }
  }
  if (input.reason === "tool_failed" &&
      !replanned.toolPlan &&
      (replanned.state === "succeeded" || replanned.state === "chatting")) {
    const resultStatus = typeof input.result === "object" && input.result !== null && "status" in input.result
      ? input.result.status
      : undefined;
    const retryable = resultStatus === "retryable_failed";
    replanned = {
      ...replanned,
      assistantMessage: {
        body: retryable
          ? "本次生成暂时没有完成，当前进度已保存，可以稍后重试或调整后继续。"
          : "本次生成没有完成，当前进度已保存，需要调整后再继续。",
      },
      state: retryable ? "failed_retryable" : "failed_blocked",
      shouldRunToolNow: false,
    };
  }
  const replanProviderCallsUsed = countExternalProviderCalls(readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0));
  const policyNormalizedReplan = turnInput.enableTaskGrantAutonomy
    ? normalizeExecutionPolicy(replanned, replanIntentGrant, replanProviderCallsUsed)
    : replanned;
  const replanNeedsHumanGate = Boolean(policyNormalizedReplan.toolPlan && policyNormalizedReplan.shouldRunToolNow && (
    !turnInput.enableTaskGrantAutonomy || replanRequiresHumanGate({
      toolPlan: policyNormalizedReplan.toolPlan,
      project,
      intentGrant: replanIntentGrant,
      externalProviderCallsUsed: replanProviderCallsUsed,
    })
  ));
  const guardedReplan = replanNeedsHumanGate
    ? {
        ...policyNormalizedReplan,
        state: "awaiting_confirmation" as const,
        toolPlan: { ...policyNormalizedReplan.toolPlan!, requiresConfirmation: true },
        shouldRunToolNow: false,
      }
    : policyNormalizedReplan.toolPlan && policyNormalizedReplan.shouldRunToolNow && turnInput.enableTaskGrantAutonomy
      ? { ...policyNormalizedReplan, toolPlan: { ...policyNormalizedReplan.toolPlan, requiresConfirmation: false } }
      : policyNormalizedReplan;
  const completedToolRounds = (turnInput.autonomousToolRoundsUsed ?? 0) + 1;
  if (turnInput.enableTaskGrantAutonomy && guardedReplan.toolPlan && guardedReplan.shouldRunToolNow) {
    if (completedToolRounds >= MAX_AUTONOMOUS_BUSINESS_TOOL_ROUNDS) {
      return persistAutonomousToolRoundLimit({
        input,
        project,
        triggerMessage: refreshedTriggerMessage,
        guardedReplan: { ...guardedReplan, toolPlan: guardedReplan.toolPlan },
        completedToolRounds,
      });
    }

    const refreshedAgentObservations = readAgentObservationsForCurrentIntent(messages, project.intentEpoch ?? 0);
    return runPlannedArtifact({
      ...turnInput,
      project,
      artifacts,
      pendingPlan: null,
      plannedTurn: {
        ...guardedReplan,
        toolPlan: enrichToolPlanWithTaskContext(guardedReplan.toolPlan, replanTaskBrief, replanIntentGrant),
      },
      capabilityAvailability,
      budgetEvents: readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0),
      agentObservations: refreshedAgentObservations,
      contextTokenEstimate: contextPackage.tokenEstimate,
      triggerMessage: refreshedTriggerMessage,
      confirmedActionId: undefined,
      autonomousToolRoundsUsed: completedToolRounds,
      intentGrant: replanIntentGrant,
    });
  }
  const assistantMessage = await addAssistantMessageWithPendingActionId(turnInput.service, turnInput.project.id, {
    role: "assistant",
    content: appendPendingDecisionNotice(
      formatAssistantContent(guardedReplan.assistantMessage),
      guardedReplan,
      project,
      replanIntentGrant,
      countExternalProviderCalls(readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0)),
    ),
    artifactRefs: input.artifact ? [input.artifact.id] : [],
    metadata: mergeMessageMetadata(
      createPendingDeliveryPlanMetadata(
        guardedReplan,
        turnInput.generationUserMessage,
        replanTaskBrief,
        turnInput.enableTaskGrantAutonomy ? replanIntentGrant : undefined,
        countExternalProviderCalls(readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0)),
      ),
      {
        orchestrationMode: "main_agent_observe_replan",
        previousActionKey: input.actionKey,
        ...(completionContractBlockedOutputs.length > 0 ? {
          completionContract: {
            status: "blocked",
            reason: "remaining_requested_outputs",
            remainingRequestedOutputs: completionContractBlockedOutputs,
          },
        } : {}),
      },
    ),
  });

  return {
    message: turnInput.triggerMessage,
    assistantMessage,
    agentTurn: { ...guardedReplan, artifactRefs: input.artifact ? [input.artifact.id] : guardedReplan.artifactRefs },
    artifact: input.artifact,
    result: input.result,
  };
}

function resolveToolFailureRepairAction(
  result: unknown,
): NonNullable<MainConversationAgentInput["replanDirective"]>["repairAction"] {
  if (!result || typeof result !== "object" || !("observation" in result)) return undefined;
  const observation = result.observation;
  if (!observation || typeof observation !== "object" || !("retryPolicy" in observation)) return undefined;
  const retryPolicy = observation.retryPolicy;
  if (!retryPolicy || typeof retryPolicy !== "object" || !("nextAction" in retryPolicy)) return undefined;
  const nextAction = retryPolicy.nextAction;
  return nextAction === "fix_inputs" || nextAction === "retry_later" || nextAction === "ask_teacher" || nextAction === "do_not_retry_automatically"
    ? nextAction
    : undefined;
}

function hasReliableTaskDefaults(project: ProjectRecord, taskBrief?: TaskBrief) {
  return Boolean(
    project.grade?.trim() &&
    project.subject?.trim() &&
    (project.lessonTopic?.trim() || taskBrief?.goal.trim()),
  );
}

async function persistAutonomousToolRoundLimit(input: {
  input: Parameters<typeof replanAfterBusinessToolResult>[0];
  project: ProjectRecord;
  triggerMessage: ConversationMessageRecord;
  guardedReplan: MainAgentTurn & { toolPlan: CapabilityToolPlan };
  completedToolRounds: number;
}): Promise<MessageTurnResponse> {
  const turnInput = input.input.input;
  const content = "本轮处理已达到安全步数上限，当前进度已保存，可以从这里继续。";
  const actionKey = buildToolActionKey(input.guardedReplan.toolPlan);
  const inputHash = hashRunInput({
    projectId: input.project.id,
    intentEpoch: input.project.intentEpoch ?? 0,
    planId: input.guardedReplan.toolPlan.planId,
    capabilityId: input.guardedReplan.toolPlan.capabilityId,
    inputDraft: input.guardedReplan.toolPlan.inputDraft,
    completedToolRounds: input.completedToolRounds,
  });
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "budget",
    status: "needs_input",
    actionKey,
    inputHash,
    reasonCodes: ["autonomous_tool_round_limit_reached"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: input.guardedReplan.toolPlan.capabilityId,
    minimalNextAction: "pause",
    teacherSafeSummary: content,
  });
  const checkpoint = createRunCheckpoint({
    projectId: input.project.id,
    planVersion: input.project.intentEpoch ?? 0,
    reason: "budget_exhausted",
    actionKey,
    inputHash,
    observationRefs: [observation.observationId],
  });
  const assistantMessage = await turnInput.service.addMessage(input.project.id, {
    role: "assistant",
    content,
    artifactRefs: input.input.artifact ? [input.input.artifact.id] : [],
    metadata: appendRunCheckpointMetadata(
      appendAgentObservationMetadata(undefined, observation),
      checkpoint,
    ),
  });

  return {
    message: input.triggerMessage,
    assistantMessage,
    agentTurn: {
      ...input.guardedReplan,
      assistantMessage: { body: content },
      state: "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: input.input.artifact ? [input.input.artifact.id] : [],
    },
    artifact: input.input.artifact,
    result: input.input.result,
  };
}

function replanRequiresHumanGate(input: {
  toolPlan: CapabilityToolPlan;
  project: ProjectRecord;
  intentGrant?: IntentGrant;
  externalProviderCallsUsed?: number;
}) {
  const tool = getToolDefinitionByCapabilityId(input.toolPlan.capabilityId);
  const risk = actionRiskForTool(tool);
  if (risk !== "external_generation") return false;
  return evaluateActionPolicy({
    risk,
    intentGrant: input.intentGrant,
    externalProviderCallsUsed: input.externalProviderCallsUsed,
    expectedScope: {
      projectId: input.project.id,
      intentEpoch: input.project.intentEpoch ?? 0,
      intensity: input.project.generationIntensity ?? "standard",
    },
  }).kind === "human_gate";
}

function appendPendingDecisionNotice(
  content: string,
  agentTurn: MainAgentTurn,
  project: ProjectRecord,
  intentGrant?: IntentGrant,
  externalProviderCallsUsed = 0,
  taskBrief?: TaskBrief,
) {
  if (agentTurn.state !== "awaiting_confirmation" || !agentTurn.toolPlan?.requiresConfirmation) return content;
  const tool = getToolDefinitionByCapabilityId(agentTurn.toolPlan.capabilityId);
  const risk = actionRiskForTool(tool);
  const policy = evaluateActionPolicy({
    risk,
    intentGrant,
    externalProviderCallsUsed,
    expectedScope: {
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      intensity: project.generationIntensity ?? "standard",
    },
  });
  if (policy.kind !== "human_gate") return content;
  const description = describeActionPolicyHumanGate(policy.reason);
  if (policy.reason === "budget_not_disclosed" && taskBrief) {
    const budget = resolveStandardTaskBudget(taskBrief);
    return `${content}\n\n${description.question}${description.impactSummary} 当前任务标准范围最多调用 ${budget.maxExternalProviderCalls} 次外部生成能力；目前没有可靠积分计量，因此不会显示虚构积分。`;
  }
  return `${content}\n\n${description.question}${description.impactSummary}`;
}


function buildUnverifiedProviderResult(
  input: Parameters<typeof runPlannedArtifact>[0],
  toolPlan: CapabilityToolPlan,
): ToolExecutionResult {
  const tool = getToolDefinitionByCapabilityId(toolPlan.capabilityId);
  return {
    status: "failed",
    toolId: tool.id,
    capabilityId: toolPlan.capabilityId,
    provider: toolPlan.capabilityId,
    observation: createToolObservation({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId: toolPlan.capabilityId,
      expectedArtifactKind: toolPlan.expectedArtifactKind,
      kind: "quality_gate_failed",
      teacherSafeSummary: "生成结果没有通过交付校验，我没有保存这份结果。请稍后重试。",
      internalReasonSanitized: "Provider success lacked artifact truth or a passing quality gate.",
      retryPolicy: { retryable: false, nextAction: "fix_inputs" },
    }),
    artifactCreated: false,
    errorCategory: "quality_gate_failed",
    budgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: toolPlan.capabilityId,
      actionKey: buildToolActionKey(toolPlan),
      expectedArtifactKind: toolPlan.expectedArtifactKind,
      status: "failed",
      kind: "quality_gate_failed",
    }),
  };
}

function buildApprovedArtifactInputs(artifacts: ArtifactRecord[]) {
  return artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => ({
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
    nodeKey: artifact.nodeKey,
    title: artifact.title,
    summary: artifact.summary,
    markdown: artifact.markdownContent,
  }));
}

function buildProviderArtifactRefs(artifacts: ArtifactRecord[]) {
  return artifacts.map((artifact) => ({
    kind: artifact.kind,
    artifactId: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  }));
}

function isRepairablePptArtifact(artifact: ArtifactRecord): boolean {
  return artifact.kind === "pptx_artifact" && artifact.nodeKey === "pptx_artifact" && artifact.status === "needs_review" && artifact.isApproved === false && Boolean(artifact.structuredContent.pptFullDeckCandidate);
}

function isApprovedArtifact(artifact: ArtifactRecord) {
  return artifact.isApproved && artifact.status === "approved";
}

function createToolRouterBudgetMetadata(result: ToolExecutionResult, toolPlan: CapabilityToolPlan): Record<string, unknown> {
  return {
    agentHarnessBudgetEvent: normalizeToolRouterBudgetEvent(result, toolPlan),
  };
}

function normalizeToolRouterBudgetEvent(result: ToolExecutionResult, toolPlan: CapabilityToolPlan) {
  return {
    ...result.budgetEvent,
    actionKey: buildToolActionKey(toolPlan),
  };
}

function resolveProviderGenerationJob(capabilityId: CapabilityId, artifacts: ArtifactRecord[]) {
  if (capabilityId !== "coze_ppt" && capabilityId !== "image_asset" && capabilityId !== "video_segment_generate") return null;
  const sourceArtifact = findProviderSourceArtifact(capabilityId, artifacts);
  if (!sourceArtifact) return null;

  return {
    kind: capabilityId === "coze_ppt" ? "pptx" as const : capabilityId === "image_asset" ? "image" as const : "video" as const,
    sourceArtifact,
  };
}

function findProviderSourceArtifact(capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate", artifacts: ArtifactRecord[]) {
  const candidates = [...artifacts].reverse().filter(isArtifactTrustedForDownstream);
  if (capabilityId === "coze_ppt") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_design_draft" && artifact.kind === "ppt_design_draft") ?? null;
  }
  if (capabilityId === "image_asset") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_draft" && artifact.kind === "ppt_draft") ?? null;
  }
  return candidates.find((artifact) => artifact.nodeKey === "video_segment_plan" && artifact.kind === "video_segment_plan") ?? null;
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function buildToolActionKey(toolPlan: CapabilityToolPlan): string {
  return `${toolPlan.capabilityId}:${toolPlan.expectedArtifactKind ?? ""}`;
}

function buildReActActionInputHash(input: Parameters<typeof runPlannedArtifact>[0], toolPlan: CapabilityToolPlan) {
  return hashRunInput({
    projectId: input.project.id,
    intentEpoch: input.project.intentEpoch ?? 0,
    planId: toolPlan.planId,
    capabilityId: toolPlan.capabilityId,
    inputDraft: toolPlan.inputDraft,
    teacherRequest: input.generationUserMessage,
    reference: input.reference,
    approvedArtifacts: input.artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      version: artifact.version,
      updatedAt: artifact.updatedAt,
    })),
  });
}

function createAgentObservationFromToolObservation(input: {
  projectId: string;
  actionKey: string;
  inputHash: string;
  observation: ToolObservation;
  status: AgentObservation["status"];
  reasonCodes?: string[];
  validationReport?: ValidationReport;
}) {
  const report = input.validationReport;
  return createAgentObservation({
    projectId: input.projectId,
    source: report ? "validation" : "tool",
    status: input.status,
    actionKey: input.actionKey,
    inputHash: input.inputHash,
    reasonCodes: input.reasonCodes ?? [input.observation.kind],
    reportRefs: report ? [{ kind: "validation", id: report.reportId, digest: report.reportDigest }] : [],
    targetLocators: report ? report.gates.flatMap((gate) => gate.locators) : [],
    responsibleStage: report?.stage ?? input.observation.capabilityId,
    minimalNextAction: mapToolObservationNextAction(input.observation),
    teacherSafeSummary: input.observation.teacherSafeSummary,
  });
}

function createSucceededAgentObservation(input: {
  projectId: string;
  actionKey: string;
  inputHash: string;
  capabilityId: string;
  artifactKind: string;
  artifactId: string;
  validationReport?: ValidationReport;
}) {
  const report = input.validationReport;
  return createAgentObservation({
    projectId: input.projectId,
    source: report ? "validation" : "tool",
    status: "succeeded",
    actionKey: input.actionKey,
    inputHash: input.inputHash,
    reasonCodes: report ? ["validation_passed"] : ["tool_succeeded"],
    reportRefs: report ? [{ kind: "validation", id: report.reportId, digest: report.reportDigest }] : [],
    targetLocators: [{ kind: "artifact", artifactKind: input.artifactKind, artifactId: input.artifactId }],
    responsibleStage: report?.stage ?? input.capabilityId,
    minimalNextAction: "continue",
    teacherSafeSummary: "这一步已经完成并保存，可以继续检查或推进下一步。",
  });
}

function mapToolObservationNextAction(observation: ToolObservation): AgentObservation["minimalNextAction"] {
  if (observation.retryPolicy.nextAction === "ask_teacher") return "ask_teacher";
  if (observation.retryPolicy.nextAction === "fix_inputs") return "repair_upstream";
  if (observation.retryPolicy.nextAction === "do_not_retry_automatically") return "pause";
  return "continue";
}

function createToolSucceededBudgetMetadata(toolPlan: CapabilityToolPlan): Record<string, unknown> {
  return {
    agentHarnessBudgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: toolPlan.capabilityId,
      actionKey: buildToolActionKey(toolPlan),
      expectedArtifactKind: toolPlan.expectedArtifactKind,
      status: "succeeded",
      kind: "tool_succeeded",
    }),
  };
}

function capabilityRunFailureKindToObservationKind(errorCategory: "provider" | "network" | "validation" | "permission" | "timeout" | "parse" | "missing_field" | "unknown"): ToolObservationKind {
  if (errorCategory === "validation") return "quality_gate_failed";
  if (errorCategory === "permission") return "blocked_by_policy";
  return "tool_failed";
}

function createUnavailableCapabilityObservationMetadata(
  projectId: string,
  triggerMessage: ConversationMessageRecord,
  agentTurn: MainAgentTurn,
  capabilityAvailability: CapabilityAvailabilityEntry[],
): Record<string, unknown> | undefined {
  if (!agentTurn.toolPlan || agentTurn.shouldRunToolNow) return undefined;
  const availability = capabilityAvailability.find((entry) => entry.capabilityId === agentTurn.toolPlan?.capabilityId);
  if (!availability || availability.status === "available") return undefined;

  const observationKind: ToolObservationKind = availability.status === "provider_unavailable" ? "provider_unavailable" : "blocked_by_policy";
  const observation = createToolObservation({
    projectId,
    sourceMessageId: triggerMessage.id,
    capabilityId: agentTurn.toolPlan.capabilityId,
    expectedArtifactKind: agentTurn.toolPlan.expectedArtifactKind,
    kind: observationKind,
    teacherSafeSummary: availability.reasonForUser,
    internalReasonSanitized: availability.reasonForModel,
  });
  const budgetEvent = buildAgentHarnessBudgetEvent({
    capabilityId: agentTurn.toolPlan.capabilityId,
    expectedArtifactKind: agentTurn.toolPlan.expectedArtifactKind,
    status: "blocked",
    kind: observationKind,
  });

  return {
    ...appendToolObservationMetadata(undefined, observation),
    ...appendAgentObservationMetadata(undefined, createAgentObservationFromToolObservation({
      projectId,
      actionKey: buildToolActionKey(agentTurn.toolPlan),
      inputHash: hashRunInput({
        projectId,
        sourceMessageId: triggerMessage.id,
        capabilityId: agentTurn.toolPlan.capabilityId,
        inputDraft: agentTurn.toolPlan.inputDraft,
      }),
      observation,
      status: availability.status === "needs_approved_inputs" ? "needs_input" : "blocked",
    })),
    agentHarnessBudgetEvent: budgetEvent,
  };
}

function mergeMessageMetadata(...metadataItems: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  const merged = metadataItems.reduce<Record<string, unknown>>((result, metadata) => {
    if (!metadata) return result;
    return { ...result, ...metadata };
  }, {});

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeExecutionMetadata(...metadataItems: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  let merged = mergeMessageMetadata(...metadataItems) ?? {};
  const agentObservations = metadataItems.flatMap((metadata) => readAgentObservationsFromMetadata(metadata));
  const toolObservations = metadataItems.flatMap((metadata) => readToolObservationsFromMetadata(metadata));
  const budgetEvents = readAgentHarnessBudgetEventsFromMessages(metadataItems.map((metadata) => ({ metadata })));

  for (const observation of agentObservations) {
    merged = appendAgentObservationMetadata(merged, observation);
  }
  if (toolObservations.length > 0) {
    delete merged.toolObservations;
    for (const observation of toolObservations) {
      merged = appendToolObservationMetadata(merged, observation);
    }
  }
  if (budgetEvents.length > 0) {
    delete merged.agentHarnessBudgetEvent;
    merged.agentHarnessBudgetEvents = dedupeBudgetEvents(budgetEvents);
  }

  return merged;
}

function dedupeBudgetEvents(events: ReturnType<typeof readAgentHarnessBudgetEventsFromMessages>) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.capabilityId}:${event.actionKey}:${event.status}:${event.kind}:${event.createdAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createPendingDeliveryPlanMetadata(
  agentTurn: MainAgentTurn,
  teacherRequest: string,
  taskBrief?: TaskBrief,
  intentGrant?: IntentGrant,
  externalProviderCallsUsed = 0,
) {
  if (agentTurn.state !== "awaiting_confirmation" || !agentTurn.toolPlan?.requiresConfirmation) {
    return undefined;
  }

  return {
    pendingDeliveryPlan: {
      status: "pending",
      teacherRequest,
      toolPlan: agentTurn.toolPlan,
      ...(agentTurn.deliveryPlan ? { deliveryPlan: agentTurn.deliveryPlan } : {}),
      ...(taskBrief ? { taskBrief } : {}),
      ...(intentGrant ? { intentGrant } : {}),
      externalProviderCallsUsed,
      runtimeKind: agentTurn.runtimeKind,
    },
  };
}

async function updatePendingPlanStatus(
  service: WorkbenchService,
  projectId: string,
  pendingPlan: PendingDeliveryPlanSnapshot,
  status: PendingDeliveryPlanMetadata["status"],
) {
  await service.updateMessageMetadata(projectId, pendingPlan.messageId, {
    ...pendingPlan.messageMetadata,
    pendingDeliveryPlan: {
      ...pendingPlan,
      status,
      ...(pendingPlan.pendingDecision ? { pendingDecision: withPendingDecisionStatus(pendingPlan.pendingDecision, pendingDecisionStatusForPlanStatus(status)) } : {}),
      messageId: undefined,
      messageMetadata: undefined,
    },
  });
}

async function addAssistantMessageWithPendingActionId(
  service: WorkbenchService,
  projectId: string,
  input: Parameters<WorkbenchService["addMessage"]>[1],
) {
  const assistantMessage = await service.addMessage(projectId, input);
  const pendingPlan = parsePendingDeliveryPlanMetadata(assistantMessage.metadata.pendingDeliveryPlan, { allowMissingActionId: true });
  if (!pendingPlan || pendingPlan.status !== "pending" || pendingPlan.actionId) return assistantMessage;

  const actionId = createHumanGateActionId({
    projectId,
    capabilityId: pendingPlan.toolPlan.capabilityId,
    messageId: assistantMessage.id,
  });
  const pendingDeliveryPlan = assistantMessage.metadata.pendingDeliveryPlan;
  const pendingDecision = createPendingDecisionForPendingPlan(
    pendingPlan,
    actionId,
    resolveConversationActorUserId(service, projectId),
  );

  return service.updateMessageMetadata(projectId, assistantMessage.id, {
    ...assistantMessage.metadata,
    pendingDeliveryPlan: {
      ...(typeof pendingDeliveryPlan === "object" && pendingDeliveryPlan && !Array.isArray(pendingDeliveryPlan) ? pendingDeliveryPlan : {}),
      actionId,
      ...(pendingDecision ? { pendingDecision } : {}),
    },
  });
}

function findPendingDeliveryPlan(messages: ConversationMessageRecord[]): PendingDeliveryPlanSnapshot | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const pendingPlan = parsePendingDeliveryPlanMetadata(message.metadata.pendingDeliveryPlan);
    if (!pendingPlan || pendingPlan.status !== "pending") continue;
    return {
      ...pendingPlan,
      messageId: message.id,
      messageMetadata: message.metadata,
    };
  }

  return null;
}

function findActiveDeliveryPlans(messages: ConversationMessageRecord[]): PendingDeliveryPlanSnapshot[] {
  const plans: PendingDeliveryPlanSnapshot[] = [];
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const plan = parsePendingDeliveryPlanMetadata(message.metadata.pendingDeliveryPlan);
    if (!plan || (plan.status !== "pending" && plan.status !== "paused")) continue;
    plans.push({ ...plan, messageId: message.id, messageMetadata: message.metadata });
  }
  return plans;
}

function resolveActiveDeliveryPlan(plans: PendingDeliveryPlanSnapshot[], confirmedActionId?: string) {
  if (confirmedActionId) return plans.find((plan) => plan.actionId === confirmedActionId) ?? plans[0] ?? null;
  return plans.length === 1 ? plans[0] : null;
}

function parsePendingDeliveryPlanMetadata(value: unknown, options: { allowMissingActionId?: boolean } = {}): PendingDeliveryPlanMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PendingDeliveryPlanMetadata>;
  if (!isPendingDeliveryPlanStatus(candidate.status)) return null;
  if (typeof candidate.teacherRequest !== "string" || !candidate.teacherRequest.trim()) return null;
  if (!candidate.toolPlan || typeof candidate.toolPlan !== "object") return null;
  if (candidate.deliveryPlan !== undefined && (typeof candidate.deliveryPlan !== "object" || Array.isArray(candidate.deliveryPlan))) return null;
  if (candidate.runtimeKind !== "openai" && candidate.runtimeKind !== "deterministic") return null;
  if (candidate.status === "pending" && !options.allowMissingActionId && (typeof candidate.actionId !== "string" || !candidate.actionId.trim())) return null;

  return {
    status: candidate.status,
    teacherRequest: candidate.teacherRequest,
    toolPlan: candidate.toolPlan as CapabilityToolPlan,
    deliveryPlan: candidate.deliveryPlan as DeliveryPlan | undefined,
    runtimeKind: candidate.runtimeKind,
    ...(isTaskBrief(candidate.taskBrief) ? { taskBrief: candidate.taskBrief } : {}),
    ...(isIntentGrant(candidate.intentGrant) ? { intentGrant: candidate.intentGrant } : {}),
    ...(isPendingDecision(candidate.pendingDecision) ? { pendingDecision: candidate.pendingDecision } : {}),
    externalProviderCallsUsed: typeof candidate.externalProviderCallsUsed === "number" && candidate.externalProviderCallsUsed >= 0
      ? candidate.externalProviderCallsUsed
      : 0,
    actionId: typeof candidate.actionId === "string" ? candidate.actionId : undefined,
  };
}

function createPendingDecisionForPendingPlan(
  pendingPlan: PendingDeliveryPlanMetadata,
  actionId: string,
  actorUserId: string,
): PendingDecision | undefined {
  const taskBrief = pendingPlan.taskBrief;
  if (!taskBrief) return undefined;
  const tool = getToolDefinitionByCapabilityId(pendingPlan.toolPlan.capabilityId);
  const risk = actionRiskForTool(tool);
  const decision = evaluateActionPolicy({
    risk,
    intentGrant: pendingPlan.intentGrant,
    externalProviderCallsUsed: pendingPlan.externalProviderCallsUsed,
    expectedScope: {
      projectId: taskBrief.projectId,
      intentEpoch: taskBrief.intentEpoch,
      intensity: taskBrief.generationIntensity,
    },
  });
  if (decision.kind !== "human_gate") return undefined;
  const standardBudget = resolveStandardTaskBudget(taskBrief);
  const upgradeBudget = resolveBudgetUpgrade({
    taskBrief,
    currentMaxExternalProviderCalls: pendingPlan.intentGrant?.maxExternalProviderCalls,
  });
  return createPendingDecisionForAction({
    action: risk,
    decision,
    actionId,
    actorUserId,
    projectId: taskBrief.projectId,
    taskId: taskBrief.taskId,
    intentEpoch: taskBrief.intentEpoch,
    planId: pendingPlan.toolPlan.planId,
    intentGrant: pendingPlan.intentGrant,
    disclosedBudget: decision.reason === "budget_not_disclosed"
      ? {
          budgetPolicyVersion: standardBudget.policyVersion,
          maxCostCredits: null,
          maxExternalProviderCalls: standardBudget.maxExternalProviderCalls,
        }
      : decision.reason === "budget_upgrade" ? {
          budgetPolicyVersion: upgradeBudget.policyVersion,
          maxCostCredits: null,
          maxExternalProviderCalls: upgradeBudget.maxExternalProviderCalls,
        }
      : undefined,
  });
}

function pendingDecisionStatusForPlanStatus(status: PendingDeliveryPlanMetadata["status"]): PendingDecision["status"] {
  if (status === "confirmed") return "confirmed";
  if (status === "canceled") return "canceled";
  if (status === "superseded") return "superseded";
  if (status === "paused") return "pending";
  return "pending";
}

function resolveConversationActorUserId(
  service: WorkbenchService,
  projectId: string,
  identity?: ExecutionIdentitySnapshot,
) {
  return identity?.actorUserId ?? service.getExecutionIdentity()?.actorUserId ?? `local-project:${projectId}`;
}

function isPendingDeliveryPlanStatus(value: unknown): value is PendingDeliveryPlanMetadata["status"] {
  return value === "pending" || value === "paused" || value === "confirmed" || value === "canceled" || value === "superseded";
}

function createConversationControlImpact(input: {
  decision: import("@/server/conversation/conversation-control-resolver").ConversationControlDecision;
  previousIntentEpoch: number;
  nextIntentEpoch: number;
  capabilityId: CapabilityId;
  sourceActionId?: string;
  teacherMessage: string;
  artifacts: ArtifactRecord[];
}) {
  const domainImpact = resolveDomainRevisionImpact(input.teacherMessage, input.artifacts);
  const scope = input.decision.kind === "pause_active_offer" || input.decision.kind === "cancel_active_offer"
    ? "none"
    : domainImpact?.nextAction === "repair_unit" ? "unit" : "upstream";
  const payload = {
    decisionKind: input.decision.kind,
    reasonCode: input.decision.reasonCode,
    previousIntentEpoch: input.previousIntentEpoch,
    nextIntentEpoch: input.nextIntentEpoch,
    capabilityId: input.capabilityId,
    sourceActionBound: Boolean(input.sourceActionId),
    impactScope: scope,
    preservedArtifacts: true,
    domainImpact,
  };
  return { ...payload, impactDigest: hashRunInput(payload) };
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
  plans: PendingDeliveryPlanSnapshot[],
) {
  const actionId = confirmedActionId?.trim();
  if (!actionId) return undefined;
  const plan = plans.find((candidate) => candidate.actionId === actionId);
  return plan && isBoundActionConfirmation(teacherContent, plan) ? actionId : undefined;
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

function isGenericContinuationRequest(text: string) {
  const normalized = text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
  return /^(继续|继续下一步|接着做|继续推进|往下做|按计划继续)$/.test(normalized);
}

function toMainAgentConversationContext(messages: ConversationMessageRecord[], pendingPlan: PendingDeliveryPlanSnapshot | null) {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return {
    recentMessages: messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
    latestAssistantContent: latestAssistant?.content,
    ...(pendingPlan
      ? {
          pendingDeliveryPlan: {
            teacherRequest: pendingPlan.teacherRequest,
            toolPlan: pendingPlan.toolPlan,
            ...(pendingPlan.deliveryPlan ? { deliveryPlan: pendingPlan.deliveryPlan } : {}),
          },
        }
      : {}),
  };
}

function toMainAgentProjectContext(project: ProjectRecord) {
  return {
    grade: project.grade,
    subject: project.subject,
    topic: project.lessonTopic,
  };
}

function toAgentRuntimeProjectContext(project: ProjectRecord, teacherGoal: string): AgentProjectContext {
  const scope = resolveProjectSemanticScope(project, teacherGoal);
  return {
    ...scope,
    textbookVersion: project.textbookVersion ?? undefined,
    teacherGoal,
    requestedOutputs: ["需求规格", "教案", "PPT 大纲", "导入视频方案"],
  };
}
