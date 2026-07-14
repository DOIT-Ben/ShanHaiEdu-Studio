import type { AgentProjectContext, AgentRuntime } from "@/server/agent-runtime/types";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability, type CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { appendToolObservationMetadata, createToolObservation, readActiveToolObservationsFromMessages, readToolObservationsFromMetadata, type ToolObservation, type ToolObservationKind } from "@/server/capabilities/tool-observation";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { buildAgentHarnessBudgetEvent, evaluateAgentHarnessBudget, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import { normalizeExecutionPolicy, resolveConversationControl } from "@/server/conversation/conversation-control-resolver";
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
  STANDARD_TASK_MAX_EXTERNAL_PROVIDER_CALLS,
} from "@/server/guards/action-policy";
import { evaluateToolPlan } from "@/server/guards/plan-guard";
import { routeToolCall } from "@/server/tools/tool-router";
import { getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { isVerifiedProviderToolSuccess, type ToolExecutionResult } from "@/server/tools/tool-types";
import type { ValidationReport } from "@/server/quality/quality-types";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { analyzePptRevisionImpact } from "@/server/ppt-quality/ppt-impact-analysis";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, ProjectExecutionFence, ProjectRecord, WorkflowNodeKey } from "@/server/workbench/types";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import { createDeterministicMainConversationAgent, type MainConversationAgent, type MainConversationAgentInput } from "./main-conversation-agent";
import { createMainAgentToolLoopOptions } from "./main-agent-tool-loop-config";
import { createTaskBrief, isPendingDecision, withPendingDecisionStatus, type IntentGrant, type PendingDecision, type TaskBrief } from "./task-contract";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

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

function resolveActiveTaskBrief(messages: ConversationMessageRecord[], message: ConversationMessageRecord, project: ProjectRecord): TaskBrief | undefined {
  if (isTaskControlMessage(message.content) || typeof message.metadata.confirmedActionId === "string") {
    for (const candidate of [...messages].reverse()) {
      const brief = candidate.metadata.taskBrief;
      if (isTaskBrief(brief) && brief.projectId === project.id && brief.intentEpoch === (project.intentEpoch ?? 0)) return brief;
    }
    return undefined;
  }
  if (!/PPT|课件|教案|视频|材料包|公开课/i.test(message.content)) return undefined;
  const taskScope = inferTaskScope(message.content);
  return createTaskBrief({
    taskId: `task:${message.id}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: message.content,
    requestedOutputs: taskScope.requestedOutputs,
    constraints: [],
    excludedOutputs: taskScope.excludedOutputs,
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: message.id,
  });
}

function isTaskControlMessage(content: string) {
  return /^(继续|确定|确认|开始|暂停|恢复|取消|确认开始|继续下一步|继续推进|按这个计划推进|确认需求并生成大纲)(?:[，,].*)?[。.!！]?$/.test(content.trim());
}

function createStandardIntentGrant(brief: TaskBrief): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1", taskId: brief.taskId, projectId: brief.projectId, intentEpoch: brief.intentEpoch,
    standardWorkAuthorized: true, intensity: brief.generationIntensity, budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
    maxCostCredits: null, maxExternalProviderCalls: null, requiredCheckpoints: [], expiresAt: null,
  };
}

function inferTaskScope(goal: string): { requestedOutputs: string[]; excludedOutputs: string[] } {
  const negativeClauses = [...goal.matchAll(/(?:不(?:做|要|生成|需要|包含|打包)|不要|无需)[^，,。；;！!\n]*/gi)]
    .map((match) => match[0]);
  const positiveGoal = negativeClauses.reduce((text, clause) => text.replace(clause, " "), goal);
  const excludedOutputs = inferOutputsFromText(negativeClauses.join(" "), { includeVideoWhenScriptMentioned: true });
  const requestedOutputs = inferOutputsFromText(positiveGoal, { includeVideoWhenScriptMentioned: false })
    .filter((output) => !excludedOutputs.includes(output));

  return {
    requestedOutputs: requestedOutputs.length ? requestedOutputs : ["lesson_plan"],
    excludedOutputs,
  };
}

function inferOutputsFromText(text: string, options: { includeVideoWhenScriptMentioned: boolean }): string[] {
  const hasVideoScript = /视频脚本|导入脚本/i.test(text);
  return [
    /教案/i.test(text) ? "lesson_plan" : null,
    /PPT|课件/i.test(text) ? "ppt" : null,
    hasVideoScript ? "video_script" : null,
    /图片|图像|素材图|生图/i.test(text) ? "image" : null,
    /成片/i.test(text) || (options.includeVideoWhenScriptMentioned ? /视频/i.test(text) : /视频/i.test(text) && !hasVideoScript) ? "video" : null,
    /材料包|交付包|整包|打包/i.test(text) ? "package" : null,
  ].filter((value): value is string => Boolean(value));
}

function isTaskBrief(value: unknown): value is TaskBrief {
  return typeof value === "object" && value !== null && (value as TaskBrief).schemaVersion === "task-brief.v1";
}

function findTaskBriefForIntent(messages: ConversationMessageRecord[], projectId: string, intentEpoch: number) {
  for (const candidate of [...messages].reverse()) {
    const brief = candidate.metadata.taskBrief;
    if (isTaskBrief(brief) && brief.projectId === projectId && brief.intentEpoch === intentEpoch) return brief;
  }
  return undefined;
}

function isTaskRedirectWithoutPendingPlan(content: string, previousBrief: TaskBrief | undefined, activePlanCount: number) {
  if (!previousBrief || activePlanCount > 0 || !/(?:改成|改做|换成|只做|不做|不要|无需)/.test(content)) return false;
  if (!/PPT|课件|教案|视频|材料包|公开课/i.test(content)) return false;
  const nextScope = inferTaskScope(content);
  return JSON.stringify([...nextScope.requestedOutputs].sort()) !== JSON.stringify([...previousBrief.requestedOutputs].sort())
    || JSON.stringify([...nextScope.excludedOutputs].sort()) !== JSON.stringify([...previousBrief.excludedOutputs].sort());
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
const taskOutputArtifactKinds: Record<string, ReadonlySet<ArtifactKind>> = {
  lesson_plan: new Set(["lesson_plan"]),
  ppt: new Set(["pptx_artifact"]),
  video_script: new Set(["video_script_generate"]),
  image: new Set(["image_prompts"]),
  video: new Set(["concat_only_assemble"]),
  package: new Set(["final_delivery"]),
};

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
};

export function createConversationTurnService(options: ConversationTurnServiceOptions) {
  const agent = options.agent ?? createDeterministicMainConversationAgent();
  const toolRouter = options.toolRouter ?? routeToolCall;

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
}): Promise<MessageTurnResponse> {
  const teacherContent = input.teacherContent;
  const reference = input.reference;

  const storedProject = await input.service.getProject(input.projectId);
  let project = input.generationIntensityOverride
    ? { ...storedProject, generationIntensity: input.generationIntensityOverride }
    : storedProject;
  const messages = await input.service.getMessages(input.projectId);
  const activePlans = findActiveDeliveryPlans(messages);
  const previousIntentEpoch = project.intentEpoch ?? 0;
  const previousTaskBrief = findTaskBriefForIntent(messages, project.id, previousIntentEpoch);
  let redirectImpact: Record<string, unknown> | undefined;
  if (isTaskRedirectWithoutPendingPlan(teacherContent, previousTaskBrief, activePlans.length)) {
    const nextIntentEpoch = await input.service.advanceProjectIntentEpoch(input.projectId, previousIntentEpoch);
    project = { ...project, intentEpoch: nextIntentEpoch };
    const payload = {
      decisionKind: "redirect_without_pending_plan",
      reasonCode: "teacher_redirected_without_pending_plan",
      previousIntentEpoch,
      nextIntentEpoch,
      impactScope: "upstream",
      preservedArtifacts: true,
    };
    redirectImpact = { ...payload, impactDigest: hashRunInput(payload) };
  }
  const taskBrief = resolveActiveTaskBrief(messages, input.triggerMessage, project);
  let intentGrant = taskBrief
    ? resolveActiveIntentGrant(messages, taskBrief) ?? createStandardIntentGrant(taskBrief)
    : undefined;
  if (taskBrief) {
    input.triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...input.triggerMessage.metadata,
      ...(redirectImpact ? { conversationControlImpact: redirectImpact } : {}),
      taskBrief,
      intentGrant,
    });
    const triggerMessageIndex = messages.findIndex((message) => message.id === input.triggerMessage.id);
    if (triggerMessageIndex >= 0) messages[triggerMessageIndex] = input.triggerMessage;
  }
  const workflowNodes = await input.service.getNodes(input.projectId);
  const artifacts = await input.service.getArtifacts(input.projectId);
  const generationJobs = await input.service.getGenerationJobs(input.projectId);
  const turnJobs = await input.service.getConversationTurnJobs(input.projectId);
  const availableArtifactKinds = artifacts.map((artifact) => artifact.kind);

  const pendingPlan = resolveActiveDeliveryPlan(activePlans, input.confirmedActionId);
  const toolObservations = readActiveToolObservationsFromMessages(messages);
  const agentObservations = readAgentObservationsForCurrentIntent(messages, project.intentEpoch ?? 0);
  const agentToolReports = readAgentToolReportsFromMessages(messages);
  const runCheckpoint = readLatestRunCheckpointFromMessages(messages);
  const budgetEvents = readBudgetEventsForCurrentIntent(messages, project.intentEpoch ?? 0);
  const externalProviderCallsUsed = countExternalProviderCalls(budgetEvents);
  const contextPackage = buildConversationContextPackage({ project, messages, workflowNodes, artifacts });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
  });
  if (activePlans.length > 1 && !input.confirmedActionId && isGenericContinuationRequest(teacherContent)) {
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

  const rawAgentTurn = applyCapabilityAvailabilityToTurn(await input.agent.respond({
    userMessage: teacherContent,
    responseStyle: input.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: project.generationIntensity,
    taskBrief,
    intentGrant: input.enableTaskGrantAutonomy ? intentGrant : undefined,
    availableArtifactKinds,
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan),
    agentToolLoop: createMainAgentToolLoopOptions({
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
    }),
  }), capabilityAvailability);
  const controlResolution = resolveConversationControl({
    userMessage: teacherContent,
    pendingPlan,
    receivedConfirmedActionId: input.confirmedActionId,
    receivedActorUserId: resolveConversationActorUserId(input.service, input.projectId, input.executionIdentity),
    agentTurn: rawAgentTurn,
    capabilityAvailability,
    intentGrant: input.enableTaskGrantAutonomy ? intentGrant : undefined,
    externalProviderCallsUsed,
  });
  const agentTurn = controlResolution.turn;
  const effectiveConfirmedActionId = input.confirmedActionId
    ?? (controlResolution.decision.usePendingActionId ? pendingPlan?.actionId : undefined);
  const confirmedBudgetDisclosure = Boolean(pendingPlan) && pendingPlan?.actionId === effectiveConfirmedActionId &&
    pendingPlan?.pendingDecision?.kind === "budget_disclosure";
  if (confirmedBudgetDisclosure && intentGrant) {
    intentGrant = discloseStandardTaskBudget(intentGrant);
    await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...input.triggerMessage.metadata,
      ...(taskBrief ? { taskBrief } : {}),
      intentGrant,
    });
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

  if (agentTurn.shouldRunToolNow && (agentTurn.toolPlan || pendingPlan?.toolPlan)) {
    return runPlannedArtifact({
      service: input.service,
      runtime: input.runtime,
      toolRouter: input.toolRouter,
      project,
      artifacts,
      pendingPlan: effectivePendingPlan,
      plannedTurn: {
        ...agentTurn,
        toolPlan: enrichToolPlanWithTaskContext(
          agentTurn.toolPlan ?? effectivePendingPlan?.toolPlan,
           taskBrief ?? effectivePendingPlan?.taskBrief,
           intentGrant ?? effectivePendingPlan?.intentGrant,
        ),
         deliveryPlan: agentTurn.deliveryPlan ?? effectivePendingPlan?.deliveryPlan,
      },
      capabilityAvailability,
      budgetEvents,
      agentObservations,
      contextTokenEstimate: contextPackage.tokenEstimate,
      reference,
      confirmedActionId: effectiveConfirmedActionId,
      triggerMessage: input.triggerMessage,
      generationUserMessage: pendingPlan?.teacherRequest ?? teacherContent,
      agent: input.agent,
      agentToolExecutor: input.agentToolExecutor,
      executionIdentity: input.executionIdentity,
      executionFence: input.executionFence,
      enableTaskGrantAutonomy: input.enableTaskGrantAutonomy,
      intentGrant,
    });
  }
  const assistantMetadata = mergeMessageMetadata(
      createPendingDeliveryPlanMetadata(
        agentTurn,
        controlResolution.decision.kind === "resume_paused_offer" && pendingPlan ? pendingPlan.teacherRequest : teacherContent,
        taskBrief,
        intentGrant,
        externalProviderCallsUsed,
      ),
    createUnavailableCapabilityObservationMetadata(input.projectId, input.triggerMessage, agentTurn, capabilityAvailability),
    { conversationControlDecision: controlResolution.decision },
  );
  const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.projectId, {
    role: "assistant",
    content: appendPendingDecisionNotice(
      formatAssistantContent(agentTurn.assistantMessage),
      agentTurn,
      project,
      intentGrant,
      externalProviderCallsUsed,
    ),
    metadata: assistantMetadata,
  });

  return { message: input.triggerMessage, assistantMessage, agentTurn };
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
      taskBrief: {
        taskId: taskBrief.taskId,
        digest: taskBrief.digest,
        goal: taskBrief.goal,
        intentEpoch: taskBrief.intentEpoch,
        generationIntensity: taskBrief.generationIntensity,
      },
      intentGrant: {
        taskId: intentGrant.taskId,
        intentEpoch: intentGrant.intentEpoch,
        standardWorkAuthorized: intentGrant.standardWorkAuthorized,
        intensity: intentGrant.intensity,
      },
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

  const videoUnitId = toolPlan.capabilityId === "video_segment_generate" ? resolveSingleVideoShotId(toolPlan.inputDraft) : undefined;
  const generationJob = toolPlan.capabilityId === "video_segment_generate" && !videoUnitId
    ? null
    : resolveProviderGenerationJob(toolPlan.capabilityId, input.artifacts);
  let jobId: string | null = null;
  let activeGenerationJob: Awaited<ReturnType<WorkbenchService["startGenerationJobForExecution"]>> | null = null;
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

  let result = await input.toolRouter({
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

  const toolDefinition = getToolDefinitionByCapabilityId(toolPlan.capabilityId);
  if (result.status === "succeeded" && toolDefinition.adapterKind === "provider" && !isVerifiedProviderToolSuccess(result)) {
    result = buildUnverifiedProviderResult(input, toolPlan);
  }
  if (result.status === "succeeded" && result.validationReport?.overallStatus !== "passed") {
    result = buildUnverifiedProviderResult(input, toolPlan);
  }

  if (result.status !== "succeeded") {
    if (jobId) {
      if ("errorCategory" in result && result.errorCategory === "submission_unknown") {
        await input.service.markGenerationSubmissionUnknown(input.project.id, jobId, result.observation.teacherSafeSummary);
      } else {
        await input.service.failGenerationJob(input.project.id, jobId, { errorMessage: result.observation.teacherSafeSummary });
      }
    }
    const budgetEvent = normalizeToolRouterBudgetEvent(result, toolPlan);
    const failedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: result.observation.teacherSafeSummary },
      state: result.status === "needs_input" ? "needs_input" : result.status === "retryable_failed" ? "failed_retryable" : "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const failureObservation = createAgentObservationFromToolObservation({
      projectId: input.project.id,
      actionKey,
      inputHash: actionInputHash,
      observation: result.observation,
      validationReport: result.validationReport,
      status: result.status === "needs_input" ? "needs_input" : "failed",
      reasonCodes: [
        result.observation.kind,
        ...("errorCategory" in result && result.errorCategory ? [result.errorCategory] : []),
      ],
    });
    const failureMetadata = {
      ...appendToolObservationMetadata(undefined, result.observation),
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
      content: result.observation.teacherSafeSummary,
      metadata: {
        ...failureMetadata,
        orchestrationMode: "single_tool_test_runtime",
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: failedTurn, result };
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
    validationReport: result.validationReport,
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
  const workflowNodes = await turnInput.service.getNodes(turnInput.project.id);
  const artifacts = await turnInput.service.getArtifacts(turnInput.project.id);
  const generationJobs = await turnInput.service.getGenerationJobs(turnInput.project.id);
  const turnJobs = await turnInput.service.getConversationTurnJobs(turnInput.project.id);
  const pendingPlan = findPendingDeliveryPlan(messages);
  const contextPackage = buildConversationContextPackage({ project, messages, workflowNodes, artifacts });
  const capabilityAvailability = buildCapabilityAvailability({
    capabilityDefinitions: getCapabilityDefinitions(),
    artifacts,
    providerAvailability: resolveRuntimeProviderAvailability(),
  });
  const agentWorldState = buildAgentWorldState({
    project,
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
    responseStyle: turnInput.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: project.generationIntensity,
    intentGrant: turnInput.enableTaskGrantAutonomy ? replanIntentGrant : undefined,
    availableArtifactKinds: artifacts.map((artifact) => artifact.kind),
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan),
    agentToolLoop: createMainAgentToolLoopOptions({
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
    }),
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
  if (policy.reason === "budget_not_disclosed") {
    return `${content}\n\n${description.question}${description.impactSummary} 当前标准范围最多调用 ${STANDARD_TASK_MAX_EXTERNAL_PROVIDER_CALLS} 次外部生成能力；目前没有可靠积分计量，因此不会显示虚构积分。`;
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

function findRemainingRequestedOutputs(taskBrief: TaskBrief, artifacts: ArtifactRecord[]): string[] {
  const trustedKinds = new Set(
    artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.kind),
  );
  return taskBrief.requestedOutputs.filter((output) => {
    const satisfyingKinds = taskOutputArtifactKinds[output];
    return !satisfyingKinds || ![...satisfyingKinds].some((kind) => trustedKinds.has(kind));
  });
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
          budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
          maxCostCredits: null,
          maxExternalProviderCalls: STANDARD_TASK_MAX_EXTERNAL_PROVIDER_CALLS,
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
  return events.filter((event) => {
    if (event.status === "blocked" || event.kind === "provider_unavailable" || event.kind === "blocked_by_policy" || event.kind === "retry_exhausted") {
      return false;
    }
    try {
      const tool = getToolDefinitionByCapabilityId(event.capabilityId as CapabilityId);
      return actionRiskForTool(tool) === "external_generation";
    } catch {
      return false;
    }
  }).length;
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
  return {
    grade: project.grade ?? inferGrade(teacherGoal) ?? "五年级",
    subject: project.subject ?? inferSubject(teacherGoal) ?? "数学",
    topic: project.lessonTopic ?? inferTopic(teacherGoal) ?? "待确认课题",
    textbookVersion: project.textbookVersion ?? undefined,
    teacherGoal,
    requestedOutputs: ["需求规格", "教案", "PPT 大纲", "导入视频方案"],
  };
}

function inferGrade(text: string) {
  return text.match(/[一二三四五六1-6]年级/)?.[0] ?? null;
}

function inferSubject(text: string) {
  return text.match(/数学|语文|英语|科学|道德与法治/)?.[0] ?? null;
}

function inferTopic(text: string) {
  return text.match(/百分数|分数|小数|周长|面积|乘法|除法|课题/)?.[0] ?? null;
}
