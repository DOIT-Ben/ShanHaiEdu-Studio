import type { AgentProjectContext, AgentRuntime } from "@/server/agent-runtime/types";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability, type CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import { getCapabilityDefinition, getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { appendToolObservationMetadata, createToolObservation, readActiveToolObservationsFromMessages, type ToolObservationKind } from "@/server/capabilities/tool-observation";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
import { buildAgentHarnessBudgetEvent, evaluateAgentHarnessBudget, readAgentHarnessBudgetEventsFromMessages, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import { generateCozePptFromArtifact } from "@/server/coze-ppt/coze-ppt-run";
import { generateImageFromArtifact } from "@/server/image-generation/image-generation-run";
import { generateVideoFromArtifact } from "@/server/video-generation/video-generation-run";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { evaluateToolPlan } from "@/server/guards/plan-guard";
import { routeToolCall } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord, ConversationMessageRecord, ProjectRecord, WorkflowNodeKey } from "@/server/workbench/types";
import { createDeterministicMainConversationAgent, type MainConversationAgent } from "./main-conversation-agent";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

type PendingDeliveryPlanMetadata = {
  status: "pending" | "confirmed";
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

const unsupportedExternalCapabilityIds = new Set(["asset_image_generate", "concat_only_assemble"]);

const toolRouterCapabilityIds = new Set<CapabilityId>([
  "requirement_spec",
  "lesson_plan",
  "ppt_outline",
  "ppt_design",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "video_segment_plan",
  "final_package",
  "coze_ppt",
  "asset_image_generate",
  "concat_only_assemble",
]);

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

  const agentTurn = applyCapabilityAvailabilityToTurn(await input.agent.respond({
    userMessage: teacherContent,
    availableArtifactKinds,
    projectContext: toMainAgentProjectContext(project),
    conversationContext: contextPackageToMainAgentConversationContext(contextPackage, agentWorldState, capabilityAvailability, pendingPlan),
  }), capabilityAvailability);

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
      confirmedActionId: input.confirmedActionId,
      triggerMessage: input.triggerMessage,
      generationUserMessage: pendingPlan?.teacherRequest ?? teacherContent,
    });
  }
  const assistantMetadata = mergeMessageMetadata(
    createPendingDeliveryPlanMetadata(agentTurn, teacherContent),
    createUnavailableCapabilityObservationMetadata(input.projectId, input.triggerMessage, agentTurn, capabilityAvailability),
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

  const externalResult = await runExternalProviderCapability(input);
  if (externalResult) return externalResult;

  const result = await runCapabilityWithAgentRuntime({
    runtime: input.runtime,
    projectId: input.project.id,
    capabilityId: plannedTurn.toolPlan.capabilityId,
    userMessage: input.reference ? `${generationUserMessage}\n\n引用：${input.reference}` : generationUserMessage,
    projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
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
  const result = await input.toolRouter({
    capabilityId: toolPlan.capabilityId,
    projectId: input.project.id,
    userInstruction,
    runtime: input.runtime,
    projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
    approvedArtifacts,
    artifactRefs,
    sourceMessageId: input.triggerMessage.id,
  });

  if (result.status !== "succeeded") {
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

async function runExternalProviderCapability(input: {
  service: WorkbenchService;
  project: ProjectRecord;
  artifacts: ArtifactRecord[];
  pendingPlan: PendingDeliveryPlanSnapshot | null;
  plannedTurn: MainAgentTurn;
  reference: string;
  triggerMessage: ConversationMessageRecord;
  generationUserMessage: string;
}): Promise<MessageTurnResponse | null> {
  const capabilityId = input.plannedTurn.toolPlan?.capabilityId;
  if (capabilityId && unsupportedExternalCapabilityIds.has(capabilityId)) {
    const message = unsupportedExternalCapabilityMessage(capabilityId);
    const failureMetadata = createToolFailureObservationMetadata({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId,
      expectedArtifactKind: input.plannedTurn.toolPlan?.expectedArtifactKind,
      kind: "blocked_by_policy",
      status: "blocked",
      teacherSafeSummary: message,
      internalReasonSanitized: `unsupported_external_capability:${capabilityId}`,
      retryable: false,
    });
    const failedTurn: MainAgentTurn = {
      ...input.plannedTurn,
      assistantMessage: { body: message },
      state: "failed_blocked",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: message,
      metadata: failureMetadata,
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: failedTurn };
  }
  if (capabilityId !== "coze_ppt" && capabilityId !== "image_asset" && capabilityId !== "video_segment_generate") return null;

  const sourceArtifact = await resolveExternalSourceArtifact(input, capabilityId);
  if (!sourceArtifact) {
    const message = externalMissingSourceMessage(capabilityId);
    const failureMetadata = createToolFailureObservationMetadata({
      projectId: input.project.id,
      sourceMessageId: input.triggerMessage.id,
      capabilityId,
      expectedArtifactKind: input.plannedTurn.toolPlan?.expectedArtifactKind,
      kind: "blocked_by_policy",
      status: "blocked",
      teacherSafeSummary: message,
      internalReasonSanitized: `missing_external_source:${capabilityId}`,
      retryable: false,
    });
    const failedTurn: MainAgentTurn = {
      ...input.plannedTurn,
      assistantMessage: { body: message },
      state: "failed_retryable",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: message,
      metadata: failureMetadata,
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: failedTurn };
  }

  let jobId: string | null = null;
  try {
    const jobKind = capabilityId === "coze_ppt" ? "pptx" : capabilityId === "image_asset" ? "image" : "video";
    const queuedJob = await input.service.createGenerationJob(input.project.id, {
      kind: jobKind,
      sourceArtifactId: sourceArtifact.id,
    });
    jobId = queuedJob.id;
    await input.service.startGenerationJob(input.project.id, jobId);

    const artifactDraft = capabilityId === "coze_ppt"
      ? await buildCozePptArtifactDraft(input.project, sourceArtifact)
      : capabilityId === "image_asset"
        ? await buildImageArtifactDraft(input.project, sourceArtifact)
        : await buildVideoArtifactDraft(input.project, sourceArtifact, input.artifacts);

    const artifact = await input.service.saveArtifact(input.project.id, artifactDraft);
    await input.service.finishGenerationJob(input.project.id, jobId, { resultArtifactId: artifact.id });

    const advancedDeliveryPlan = input.plannedTurn.deliveryPlan
      ? advanceDeliveryPlan(input.plannedTurn.deliveryPlan, capabilityId)
      : null;
    const nextToolPlan = advancedDeliveryPlan?.nextCapabilityId
      ? buildContinuedToolPlan(advancedDeliveryPlan.nextCapabilityId, input.generationUserMessage, advancedDeliveryPlan.deliveryPlan)
      : null;
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

    const assistantSummary = externalSuccessMessage(capabilityId, artifact.title);
    const succeededTurn: MainAgentTurn = {
      ...input.plannedTurn,
      assistantMessage: { body: assistantSummary },
      state: "succeeded",
      toolPlan: nextToolPlan ?? input.plannedTurn.toolPlan,
      deliveryPlan: advancedDeliveryPlan?.deliveryPlan ?? input.plannedTurn.deliveryPlan,
      quickReplies: nextToolPlan ? [{ label: "继续下一步", prompt: "继续下一步", recommended: true }] : [],
      shouldRunToolNow: true,
      artifactRefs: [artifact.id],
    };
    const assistantMessage = await addAssistantMessageWithPendingActionId(input.service, input.project.id, {
      role: "assistant",
      content: assistantSummary,
      artifactRefs: [artifact.id],
      metadata: mergeMessageMetadata(
        nextToolPlan && advancedDeliveryPlan
        ? {
            pendingDeliveryPlan: {
              status: "pending",
              teacherRequest: input.generationUserMessage,
              toolPlan: nextToolPlan,
              deliveryPlan: advancedDeliveryPlan.deliveryPlan,
              runtimeKind: input.plannedTurn.runtimeKind,
            },
          }
        : undefined,
        input.plannedTurn.toolPlan ? createToolSucceededBudgetMetadata(input.plannedTurn.toolPlan) : undefined,
      ),
    });

    return { message: input.triggerMessage, assistantMessage, agentTurn: succeededTurn, artifact };
  } catch (error) {
    const message = externalFailedMessage(capabilityId, error);
    const failureMetadata = createToolFailureObservationMetadata({
      projectId: input.project.id,
      jobId: jobId ?? undefined,
      sourceMessageId: input.triggerMessage.id,
      capabilityId,
      expectedArtifactKind: input.plannedTurn.toolPlan?.expectedArtifactKind,
      kind: message.includes("逐页完整") ? "quality_gate_failed" : "tool_failed",
      status: "retryable_failed",
      teacherSafeSummary: message,
      internalReasonSanitized: error instanceof Error ? error.message : "external_provider_failed",
      retryable: true,
    });
    if (jobId) {
      await input.service.failGenerationJob(input.project.id, jobId, { errorMessage: message }).catch(() => null);
    }
    const failedTurn: MainAgentTurn = {
      ...input.plannedTurn,
      assistantMessage: { body: message },
      state: "failed_retryable",
      shouldRunToolNow: false,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: message,
      metadata: failureMetadata,
    });
    return { message: input.triggerMessage, assistantMessage, agentTurn: failedTurn };
  }
}

async function buildCozePptArtifactDraft(project: ProjectRecord, sourceArtifact: ArtifactRecord) {
  const generated = await generateCozePptFromArtifact({ project, artifact: sourceArtifact });
  const pageLabel = `${generated.slideCount} 页`;
  return {
    nodeKey: "pptx_artifact" as const,
    kind: "pptx_artifact" as const,
    title: `真实 ${pageLabel} PPTX 文件`,
    status: "needs_review" as const,
    summary: `已生成可下载的真实 ${pageLabel} PPTX 文件，请下载后核对页面内容。`,
    markdownContent: [
      `# 真实 ${pageLabel} PPTX 文件`,
      "",
      `已基于当前逐页四层 PPT 设计稿生成真实 ${pageLabel} PPTX 文件。`,
      "",
      "正式授课前请核对教材、页码、例题、页面顺序和课堂节奏。",
    ].join("\n"),
    structuredContent: {
      文件状态: `真实 ${pageLabel} PPTX 已生成`,
      文件大小: `${generated.bytes} bytes`,
      实际页数: pageLabel,
      目标页数: `${generated.requestedPageCount} 页`,
      storage: {
        cozePptx: {
          localOutput: generated.localOutput,
          fileName: generated.fileName,
          bytes: generated.bytes,
          sha256: generated.sha256,
          slideCount: generated.slideCount,
          requestedPageCount: generated.requestedPageCount,
          generationMode: "coze_generated",
          sourceArtifactId: sourceArtifact.id,
        },
      },
    },
  };
}

async function buildImageArtifactDraft(project: ProjectRecord, sourceArtifact: ArtifactRecord) {
  const generated = await generateImageFromArtifact({ project, artifact: sourceArtifact });
  return {
    nodeKey: "image_prompts" as const,
    kind: "image_prompts" as const,
    title: "真实课堂视觉图",
    status: "needs_review" as const,
    summary: "已生成一张可用于课件导入页的本地课堂视觉图，请下载或接入前继续核对画面内容。",
    markdownContent: [
      "# 真实课堂视觉图",
      "",
      "已基于当前 PPT 大纲生成一张本地课堂视觉图。",
      "",
      "正式授课前请核对画面是否贴合教材、课题、课堂问题和学生认知水平。",
    ].join("\n"),
    structuredContent: {
      文件状态: "真实课堂视觉图已生成",
      文件大小: `${generated.bytes} bytes`,
      文件类型: generated.mime,
      storage: {
        imageAsset: {
          localOutput: generated.localOutput,
          fileName: generated.fileName,
          bytes: generated.bytes,
          sha256: generated.sha256,
          mime: generated.mime,
          generationMode: "image_generated",
          sourceArtifactId: sourceArtifact.id,
        },
      },
    },
  };
}

async function buildVideoArtifactDraft(project: ProjectRecord, sourceArtifact: ArtifactRecord, upstreamArtifacts: ArtifactRecord[]) {
  const generated = await generateVideoFromArtifact({ project, artifact: sourceArtifact, upstreamArtifacts });
  return {
    nodeKey: "video_segment_generate" as const,
    kind: "video_segment_generate" as const,
    title: "真实分镜视频片段",
    status: "needs_review" as const,
    summary: "已生成一段本地分镜视频，请播放后核对画面、节奏和课堂锚点。",
    markdownContent: [
      "# 真实分镜视频片段",
      "",
      "已基于当前分镜视频计划生成一段本地 MP4。",
      "",
      "正式授课前请核对画面质量、节奏、课堂锚点、学生理解成本和是否提前讲解知识点。",
    ].join("\n"),
    structuredContent: {
      文件状态: "真实分镜视频片段已生成",
      文件大小: `${generated.bytes} bytes`,
      文件类型: generated.mime,
      storage: {
        videoAsset: {
          localOutput: generated.localOutput,
          fileName: generated.fileName,
          bytes: generated.bytes,
          sha256: generated.sha256,
          mime: generated.mime,
          generationMode: "video_generated",
          sourceArtifactId: sourceArtifact.id,
        },
      },
    },
  };
}

async function resolveExternalSourceArtifact(
  input: {
    service: WorkbenchService;
    project: ProjectRecord;
    artifacts: ArtifactRecord[];
    pendingPlan: PendingDeliveryPlanSnapshot | null;
  },
  capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate",
) {
  const approvedSource = findExternalSourceArtifact(capabilityId, input.artifacts);
  if (approvedSource) return approvedSource;

  return null;
}

function findExternalSourceArtifact(capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate", artifacts: ArtifactRecord[]) {
  const candidates = [...artifacts].reverse().filter((artifact) => artifact.isApproved && artifact.status === "approved");
  if (capabilityId === "coze_ppt") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_design_draft" && artifact.kind === "ppt_design_draft") ?? null;
  }
  if (capabilityId === "image_asset") {
    return candidates.find((artifact) => artifact.nodeKey === "ppt_draft" && artifact.kind === "ppt_draft") ?? null;
  }
  return candidates.find((artifact) => artifact.nodeKey === "video_segment_plan" && artifact.kind === "video_segment_plan") ?? null;
}

function unsupportedExternalCapabilityMessage(capabilityId: string) {
  if (capabilityId === "asset_image_generate") return "视频资产图需要接入真实图片生成后才能执行，我没有保存占位成果。";
  return "最终视频拼接需要接入真实拼接流程后才能执行，我没有保存占位成果。";
}

function externalMissingSourceMessage(capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate") {
  if (capabilityId === "coze_ppt") return "需要先生成 PPT 设计稿，才能生成真实 PPTX 文件。";
  if (capabilityId === "image_asset") return "需要先生成并确认 PPT 大纲，才能生成真实课堂视觉图。";
  return "需要先生成并确认分镜、资产图和分镜视频计划，才能生成真实分镜视频。";
}

function externalSuccessMessage(capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate", title: string) {
  if (capabilityId === "coze_ppt") return `已生成「${title}」，这是真实 PPTX 文件，请下载核对。`;
  if (capabilityId === "image_asset") return `已生成「${title}」，这是真实课堂视觉图，请核对画面内容。`;
  return `已生成「${title}」，这是真实 MP4 分镜视频，请播放核对。`;
}

function externalFailedMessage(capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate", error?: unknown) {
  const detail = error instanceof Error ? error.message : "";
  if (capabilityId === "coze_ppt" && detail.includes("PPT 设计稿未逐页完整")) return detail;
  if (capabilityId === "coze_ppt") return "真实 PPTX 服务暂时没有生成成功，我没有保存占位成果。请稍后重试或检查服务配置。";
  if (capabilityId === "image_asset") return "真实图片服务暂时没有生成成功，我没有保存占位成果。请稍后重试或检查服务配置。";
  return "真实视频服务暂时没有生成成功，我没有保存占位成果。请稍后重试或检查服务配置。";
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

function createToolFailureObservationMetadata(input: {
  projectId: string;
  sourceMessageId?: string;
  jobId?: string;
  capabilityId: CapabilityId;
  expectedArtifactKind?: string;
  kind: ToolObservationKind;
  status: AgentHarnessBudgetEventStatus;
  teacherSafeSummary: string;
  internalReasonSanitized: string;
  retryable: boolean;
}): Record<string, unknown> {
  const observation = createToolObservation({
    projectId: input.projectId,
    sourceMessageId: input.sourceMessageId,
    jobId: input.jobId,
    capabilityId: input.capabilityId,
    expectedArtifactKind: input.expectedArtifactKind,
    kind: input.kind,
    teacherSafeSummary: input.teacherSafeSummary,
    internalReasonSanitized: input.internalReasonSanitized,
    retryPolicy: {
      retryable: input.retryable,
      nextAction: input.retryable ? "retry_later" : input.kind === "quality_gate_failed" ? "fix_inputs" : "ask_teacher",
    },
  });

  return {
    ...appendToolObservationMetadata(undefined, observation),
    agentHarnessBudgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: input.capabilityId,
      expectedArtifactKind: input.expectedArtifactKind,
      status: input.status,
      kind: input.kind,
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
  if (candidate.status !== "pending" && candidate.status !== "confirmed") return null;
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
