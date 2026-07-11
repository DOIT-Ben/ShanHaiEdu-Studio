import type { AgentProjectContext, AgentRuntime } from "@/server/agent-runtime/types";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability, type CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { appendToolObservationMetadata, createToolObservation, readActiveToolObservationsFromMessages, type ToolObservationKind } from "@/server/capabilities/tool-observation";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { buildAgentHarnessBudgetEvent, evaluateAgentHarnessBudget, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import { resolveConversationControl } from "@/server/conversation/conversation-control-resolver";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { evaluateToolPlan } from "@/server/guards/plan-guard";
import { routeToolCall } from "@/server/tools/tool-router";
import { getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { isVerifiedProviderToolSuccess, type ToolExecutionResult } from "@/server/tools/tool-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord, ConversationMessageRecord, ProjectRecord, WorkflowNodeKey } from "@/server/workbench/types";
import { createDeterministicMainConversationAgent, type MainConversationAgent } from "./main-conversation-agent";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

type PendingDeliveryPlanMetadata = {
  status: "pending" | "confirmed" | "superseded";
  teacherRequest: string;
  toolPlan: CapabilityToolPlan;
  deliveryPlan?: DeliveryPlan;
  runtimeKind: MainAgentTurn["runtimeKind"];
  actionId?: string;
};

type PendingDeliveryPlanSnapshot = PendingDeliveryPlanMetadata & {
  messageId: string;
  messageMetadata: Record<string, unknown>;
};

const toolRouterCapabilityIds = new Set<CapabilityId>(
  listToolDefinitions().flatMap((tool) => tool.capabilityId ? [tool.capabilityId] : []),
);

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
}): Promise<MessageTurnResponse> {
  const teacherContent = input.teacherContent;
  const reference = input.reference;

  const project = await input.service.getProject(input.projectId);
  const messages = await input.service.getMessages(input.projectId);
  const workflowNodes = await input.service.getNodes(input.projectId);
  const artifacts = await input.service.getArtifacts(input.projectId);
  const generationJobs = await input.service.getGenerationJobs(input.projectId);
  const turnJobs = await input.service.getConversationTurnJobs(input.projectId);
  const availableArtifactKinds = artifacts.map((artifact) => artifact.kind);

  const pendingPlan = findPendingDeliveryPlan(messages);
  const toolObservations = readActiveToolObservationsFromMessages(messages);
  const budgetEvents = readAgentHarnessBudgetEventsFromMessages(messages);
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
    toolObservations,
  });

  const rawAgentTurn = applyCapabilityAvailabilityToTurn(await input.agent.respond({
    userMessage: teacherContent,
    responseStyle: input.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    availableArtifactKinds,
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan),
  }), capabilityAvailability);
  const controlResolution = resolveConversationControl({
    userMessage: teacherContent,
    pendingPlan,
    receivedConfirmedActionId: input.confirmedActionId,
    agentTurn: rawAgentTurn,
    capabilityAvailability,
  });
  const agentTurn = controlResolution.turn;
  const effectiveConfirmedActionId = input.confirmedActionId
    ?? (controlResolution.decision.usePendingActionId ? pendingPlan?.actionId : undefined);

  if (controlResolution.decision.supersedePendingAction && pendingPlan) {
    await updatePendingPlanStatus(input.service, input.projectId, pendingPlan, "superseded");
  }

  if (agentTurn.shouldRunToolNow && (agentTurn.toolPlan || pendingPlan?.toolPlan)) {
    return runPlannedArtifact({
      service: input.service,
      runtime: input.runtime,
      toolRouter: input.toolRouter,
      project,
      artifacts,
      pendingPlan,
      plannedTurn: {
        ...agentTurn,
        toolPlan: agentTurn.toolPlan ?? pendingPlan?.toolPlan,
        deliveryPlan: agentTurn.deliveryPlan ?? pendingPlan?.deliveryPlan,
      },
      capabilityAvailability,
      budgetEvents,
      contextTokenEstimate: contextPackage.tokenEstimate,
      reference,
      confirmedActionId: effectiveConfirmedActionId,
      triggerMessage: input.triggerMessage,
      generationUserMessage: pendingPlan?.teacherRequest ?? teacherContent,
    });
  }
  const assistantMetadata = mergeMessageMetadata(
    createPendingDeliveryPlanMetadata(agentTurn, teacherContent),
    createUnavailableCapabilityObservationMetadata(input.projectId, input.triggerMessage, agentTurn, capabilityAvailability),
    { conversationControlDecision: controlResolution.decision },
  );
  const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.projectId, {
    role: "assistant",
    content: formatAssistantContent(agentTurn.assistantMessage),
    metadata: assistantMetadata,
  });

  return { message: input.triggerMessage, assistantMessage, agentTurn };
}

function applyCapabilityAvailabilityToTurn(agentTurn: MainAgentTurn, capabilityAvailability: CapabilityAvailabilityEntry[]): MainAgentTurn {
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
  contextTokenEstimate: number;
  reference: string;
  triggerMessage: ConversationMessageRecord;
  generationUserMessage: string;
  confirmedActionId?: string;
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
        agentHarnessBudgetEvent: budgetEvent,
      },
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: blockedTurn };
  }

  const budgetDecision = evaluateAgentHarnessBudget({
    capabilityId: plannedTurn.toolPlan.capabilityId,
    actionKey: buildToolActionKey(plannedTurn.toolPlan),
    events: input.budgetEvents,
    contextTokenEstimate: input.contextTokenEstimate,
    isSideEffectful: plannedTurn.toolPlan.requiresConfirmation,
    hasConfirmedHumanGate: Boolean(input.confirmedActionId),
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
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, observation),
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
      sourceMessageId: input.triggerMessage.id,
      capabilityId: plannedTurn.toolPlan.capabilityId,
      expectedArtifactKind: plannedTurn.toolPlan.expectedArtifactKind,
      kind: observationKind,
      teacherSafeSummary: rawAssistantPrompt,
      internalReasonSanitized: result.status === "failed" ? `capability_failed:${result.errorCategory}` : "capability_needs_input",
      retryPolicy: result.status === "failed"
        ? { retryable: result.retryable, nextAction: result.errorCategory === "validation" ? "fix_inputs" : "retry_later" }
        : { retryable: false, nextAction: "ask_teacher" },
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
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, observation),
        agentHarnessBudgetEvent: budgetEvent,
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
  const advancedDeliveryPlan = plannedTurn.deliveryPlan
    ? advanceDeliveryPlan(plannedTurn.deliveryPlan, plannedTurn.toolPlan.capabilityId)
    : null;
  const nextToolPlan = advancedDeliveryPlan?.nextCapabilityId
    ? buildContinuedToolPlan(advancedDeliveryPlan.nextCapabilityId, generationUserMessage, advancedDeliveryPlan.deliveryPlan)
    : null;
  const succeededTurn: MainAgentTurn = {
    ...plannedTurn,
    assistantMessage: { body: result.assistantSummary },
    state: "succeeded",
    toolPlan: nextToolPlan ?? plannedTurn.toolPlan,
    deliveryPlan: advancedDeliveryPlan?.deliveryPlan ?? plannedTurn.deliveryPlan,
    quickReplies: nextToolPlan ? [{ label: "继续下一步", prompt: "继续下一步", recommended: true }] : [],
    shouldRunToolNow: true,
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
      nextToolPlan && advancedDeliveryPlan
      ? {
          pendingDeliveryPlan: {
            status: "pending",
            teacherRequest: generationUserMessage,
            toolPlan: nextToolPlan,
            deliveryPlan: advancedDeliveryPlan.deliveryPlan,
            runtimeKind: plannedTurn.runtimeKind,
          },
        }
      : undefined,
      createToolSucceededBudgetMetadata(plannedTurn.toolPlan),
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

  const generationUserMessage = input.generationUserMessage;
  const userInstruction = input.reference ? `${generationUserMessage}\n\n引用：${input.reference}` : generationUserMessage;
  const approvedArtifacts = buildApprovedArtifactInputs(input.artifacts);
  const artifactRefs = buildProviderArtifactRefs(input.artifacts);

  const generationJob = resolveProviderGenerationJob(toolPlan.capabilityId, input.artifacts);
  let jobId: string | null = null;
  if (generationJob) {
    const queuedJob = await input.service.createGenerationJob(input.project.id, {
      kind: generationJob.kind,
      sourceArtifactId: generationJob.sourceArtifact.id,
    });
    jobId = queuedJob.id;
    await input.service.startGenerationJob(input.project.id, jobId);
  }

  let result = await input.toolRouter({
    capabilityId: toolPlan.capabilityId,
    projectId: input.project.id,
    project: input.project,
    userInstruction,
    runtime: input.runtime,
    projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
    approvedArtifacts,
    artifactRefs,
    resolvedArtifacts: input.artifacts.filter(isApprovedArtifact),
    sourceMessageId: input.triggerMessage.id,
  });

  const toolDefinition = getToolDefinitionByCapabilityId(toolPlan.capabilityId);
  if (result.status === "succeeded" && toolDefinition.adapterKind === "provider" && !isVerifiedProviderToolSuccess(result)) {
    result = buildUnverifiedProviderResult(input, toolPlan);
  }

  if (result.status !== "succeeded") {
    if (jobId) {
      await input.service.failGenerationJob(input.project.id, jobId, { errorMessage: result.observation.teacherSafeSummary });
    }
    const budgetEvent = normalizeToolRouterBudgetEvent(result, toolPlan);
    const failedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: result.observation.teacherSafeSummary },
      state: result.status === "needs_input" ? "needs_input" : result.status === "retryable_failed" ? "failed_retryable" : "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: result.observation.teacherSafeSummary,
      metadata: {
        ...appendToolObservationMetadata(undefined, result.observation),
        agentHarnessBudgetEvent: budgetEvent,
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
  if (jobId) {
    await input.service.finishGenerationJob(input.project.id, jobId, { resultArtifactId: artifact.id });
  }
  const advancedDeliveryPlan = plannedTurn.deliveryPlan
    ? advanceDeliveryPlan(plannedTurn.deliveryPlan, toolPlan.capabilityId)
    : null;
  const nextToolPlan = advancedDeliveryPlan?.nextCapabilityId
    ? buildContinuedToolPlan(advancedDeliveryPlan.nextCapabilityId, generationUserMessage, advancedDeliveryPlan.deliveryPlan)
    : null;
  const succeededTurn: MainAgentTurn = {
    ...plannedTurn,
    assistantMessage: { body: result.assistantSummary },
    state: "succeeded",
    toolPlan: nextToolPlan ?? toolPlan,
    deliveryPlan: advancedDeliveryPlan?.deliveryPlan ?? plannedTurn.deliveryPlan,
    quickReplies: nextToolPlan ? [{ label: "继续下一步", prompt: "继续下一步", recommended: true }] : [],
    shouldRunToolNow: true,
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
      nextToolPlan && advancedDeliveryPlan
      ? {
          pendingDeliveryPlan: {
            status: "pending",
            teacherRequest: generationUserMessage,
            toolPlan: nextToolPlan,
            deliveryPlan: advancedDeliveryPlan.deliveryPlan,
            runtimeKind: plannedTurn.runtimeKind,
          },
        }
      : undefined,
      createToolRouterBudgetMetadata(result, toolPlan),
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
  return artifacts.filter(isApprovedArtifact).map((artifact) => ({
    nodeKey: artifact.nodeKey,
    title: artifact.title,
    summary: artifact.summary,
    markdown: artifact.markdownContent,
  }));
}

function buildProviderArtifactRefs(artifacts: ArtifactRecord[]) {
  return artifacts.filter(isApprovedArtifact).map((artifact) => ({
    kind: artifact.kind,
    artifactId: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  }));
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
  const candidates = [...artifacts].reverse().filter((artifact) => artifact.isApproved && artifact.status === "approved");
  if (capabilityId === "coze_ppt") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_design_draft" && artifact.kind === "ppt_design_draft") ?? null;
  }
  if (capabilityId === "image_asset") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_draft" && artifact.kind === "ppt_draft") ?? null;
  }
  return candidates.find((artifact) => artifact.nodeKey === "video_segment_plan" && artifact.kind === "video_segment_plan") ?? null;
}

function advanceDeliveryPlan(deliveryPlan: DeliveryPlan, completedCapabilityId: string) {
  const completedIndex = deliveryPlan.steps.findIndex((step) => step.capabilityId === completedCapabilityId);
  const nextStep = completedIndex === -1 ? null : deliveryPlan.steps.slice(completedIndex + 1).find((step) => step.status !== "succeeded");
  const nextCapabilityId = nextStep?.capabilityId;

  return {
    nextCapabilityId,
    deliveryPlan: {
      ...deliveryPlan,
      currentStepId: nextCapabilityId ?? (completedCapabilityId as DeliveryPlan["currentStepId"]),
      steps: deliveryPlan.steps.map((step) => {
        if (step.capabilityId === completedCapabilityId) return { ...step, status: "succeeded" as const };
        if (step.capabilityId === nextCapabilityId) return { ...step, status: "awaiting_confirmation" as const };
        return step;
      }),
    },
  };
}

function buildContinuedToolPlan(capabilityId: CapabilityToolPlan["capabilityId"], teacherRequest: string, deliveryPlan: DeliveryPlan): CapabilityToolPlan {
  const capability = getCapabilityDefinition(capabilityId);
  const stepIndex = deliveryPlan.steps.findIndex((step) => step.capabilityId === capabilityId);
  const nextCapabilityId = deliveryPlan.steps[stepIndex + 1]?.capabilityId;

  return {
    planId: `${capabilityId}:${deliveryPlan.id}`,
    capabilityId,
    reasonForUser: `我可以继续为你${capability.userLabel}。`,
    internalReason: `continued_from_pending_delivery_plan:${capabilityId}`,
    inputDraft: {
      teacherGoal: teacherRequest,
      upstreamAvailable: deliveryPlan.steps.slice(0, Math.max(0, stepIndex)).map((step) => step.artifactKind),
    },
    missingInputs: [],
    upstreamPlan: [],
    nextSuggestedCapabilities: nextCapabilityId ? [nextCapabilityId] : [],
    requiresConfirmation: capability.requiresConfirmation,
    expectedArtifactKind: capability.artifactKind,
  };
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function buildToolActionKey(toolPlan: CapabilityToolPlan): string {
  return `${toolPlan.capabilityId}:${toolPlan.expectedArtifactKind ?? ""}`;
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

function capabilityRunFailureKindToObservationKind(errorCategory: "provider" | "validation" | "permission" | "timeout" | "unknown"): ToolObservationKind {
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

function createPendingDeliveryPlanMetadata(agentTurn: MainAgentTurn, teacherRequest: string) {
  if (agentTurn.state !== "awaiting_confirmation" || !agentTurn.toolPlan?.requiresConfirmation) {
    return undefined;
  }

  return {
    pendingDeliveryPlan: {
      status: "pending",
      teacherRequest,
      toolPlan: agentTurn.toolPlan,
      ...(agentTurn.deliveryPlan ? { deliveryPlan: agentTurn.deliveryPlan } : {}),
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

  return service.updateMessageMetadata(projectId, assistantMessage.id, {
    ...assistantMessage.metadata,
    pendingDeliveryPlan: {
      ...(typeof pendingDeliveryPlan === "object" && pendingDeliveryPlan && !Array.isArray(pendingDeliveryPlan) ? pendingDeliveryPlan : {}),
      actionId,
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

function parsePendingDeliveryPlanMetadata(value: unknown, options: { allowMissingActionId?: boolean } = {}): PendingDeliveryPlanMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PendingDeliveryPlanMetadata>;
  if (candidate.status !== "pending" && candidate.status !== "confirmed" && candidate.status !== "superseded") return null;
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
    actionId: typeof candidate.actionId === "string" ? candidate.actionId : undefined,
  };
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
