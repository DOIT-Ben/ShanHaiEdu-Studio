import type { AgentProjectContext, AgentRuntime } from "@/server/agent-runtime/types";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import type { CapabilityToolPlan, DeliveryPlan, MainAgentTurn } from "@/server/capabilities/types";
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
};

type PendingDeliveryPlanSnapshot = PendingDeliveryPlanMetadata & {
  messageId: string;
  messageMetadata: Record<string, unknown>;
};

export type ConversationTurnInput = {
  role?: "teacher" | "assistant" | "system";
  content: string;
  reference?: string;
  artifactRefs?: string[];
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
};

export function createConversationTurnService(options: ConversationTurnServiceOptions) {
  const agent = options.agent ?? createDeterministicMainConversationAgent();

  return {
    async createTurn(projectId: string, input: ConversationTurnInput): Promise<MessageTurnResponse> {
      const teacherContent = input.content.trim();
      const reference = input.reference?.trim() ?? "";
      const content = reference ? `${teacherContent}\n\n引用：${reference}` : teacherContent;
      const message = await options.service.addMessage(projectId, {
        role: input.role === "assistant" || input.role === "system" ? input.role : "teacher",
        content,
        artifactRefs: input.artifactRefs ?? [],
      });

      if (message.role !== "teacher") {
        return { message };
      }

      const project = await options.service.getProject(projectId);
      const messages = await options.service.getMessages(projectId);
      const artifacts = await options.service.getArtifacts(projectId);
      const availableArtifactKinds = artifacts.map((artifact) => artifact.kind);

      if (isTeacherConfirmation(teacherContent)) {
        return runConfirmedFirstArtifact({
          service: options.service,
          runtime: options.runtime,
          agent,
          project,
          messages,
          availableArtifactKinds,
          reference,
          confirmationMessage: message,
          teacherContent,
        });
      }

      const agentTurn = await agent.respond({
        userMessage: teacherContent,
        availableArtifactKinds,
        projectContext: toMainAgentProjectContext(project),
      });
      const assistantMessage = await options.service.addMessage(projectId, {
        role: "assistant",
        content: formatAssistantContent(agentTurn.assistantMessage),
        metadata: createPendingDeliveryPlanMetadata(agentTurn, teacherContent),
      });

      return { message, assistantMessage, agentTurn };
    },
  };
}

async function runConfirmedFirstArtifact(input: {
  service: WorkbenchService;
  runtime: AgentRuntime;
  agent: MainConversationAgent;
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  availableArtifactKinds: string[];
  reference: string;
  confirmationMessage: ConversationMessageRecord;
  teacherContent: string;
}): Promise<MessageTurnResponse> {
  const pendingPlan = findPendingDeliveryPlan(input.messages);
  const generationUserMessage = pendingPlan?.teacherRequest ?? input.teacherContent;
  const plannedTurn = pendingPlan ? toPendingMainAgentTurn(pendingPlan) : await input.agent.respond({
    userMessage: generationUserMessage,
    availableArtifactKinds: input.availableArtifactKinds,
    projectContext: toMainAgentProjectContext(input.project),
  });

  if (!pendingPlan || plannedTurn.state !== "awaiting_confirmation" || !plannedTurn.toolPlan?.requiresConfirmation) {
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
    return { message: input.confirmationMessage, assistantMessage, agentTurn: blockedTurn };
  }

  const result = await runCapabilityWithAgentRuntime({
    runtime: input.runtime,
    projectId: input.project.id,
    capabilityId: plannedTurn.toolPlan.capabilityId,
    userMessage: input.reference ? `${generationUserMessage}\n\n引用：${input.reference}` : generationUserMessage,
    projectContext: toAgentRuntimeProjectContext(input.project, generationUserMessage),
  });

  if (result.status !== "succeeded") {
    const assistantPrompt = result.status === "failed" ? result.userMessage : result.assistantPrompt;
    const failedTurn: MainAgentTurn = {
      ...plannedTurn,
      assistantMessage: { body: assistantPrompt },
      state: result.status === "needs_input" ? "needs_input" : result.retryable ? "failed_retryable" : "failed_blocked",
      shouldRunToolNow: true,
      artifactRefs: [],
    };
    const assistantMessage = await input.service.addMessage(input.project.id, {
      role: "assistant",
      content: assistantPrompt,
    });
    return { message: input.confirmationMessage, assistantMessage, agentTurn: failedTurn, result };
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
  const succeededTurn: MainAgentTurn = {
    ...plannedTurn,
    assistantMessage: { body: result.assistantSummary },
    state: "succeeded",
    deliveryPlan: plannedTurn.deliveryPlan ? markDeliveryStepSucceeded(plannedTurn.deliveryPlan, plannedTurn.toolPlan.capabilityId) : undefined,
    shouldRunToolNow: true,
    artifactRefs: [artifact.id],
  };
  await input.service.updateMessageMetadata(input.project.id, pendingPlan.messageId, {
    ...pendingPlan.messageMetadata,
    pendingDeliveryPlan: {
      ...pendingPlan,
      status: "confirmed",
      messageId: undefined,
      messageMetadata: undefined,
    },
  });
  const assistantMessage = await input.service.addMessage(input.project.id, {
    role: "assistant",
    content: result.assistantSummary,
    artifactRefs: [artifact.id],
  });

  return {
    message: input.confirmationMessage,
    assistantMessage,
    agentTurn: succeededTurn,
    artifact,
  };
}

function markDeliveryStepSucceeded(deliveryPlan: NonNullable<MainAgentTurn["deliveryPlan"]>, capabilityId: string) {
  return {
    ...deliveryPlan,
    steps: deliveryPlan.steps.map((step) =>
      step.capabilityId === capabilityId ? { ...step, status: "succeeded" as const } : step,
    ),
  };
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function isTeacherConfirmation(content: string) {
  const text = content.trim();
  return /确认开始|开始生成|直接生成|按默认生成|确认生成|可以生成|开始吧|没问题/.test(text);
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

function parsePendingDeliveryPlanMetadata(value: unknown): PendingDeliveryPlanMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PendingDeliveryPlanMetadata>;
  if (candidate.status !== "pending" && candidate.status !== "confirmed") return null;
  if (typeof candidate.teacherRequest !== "string" || !candidate.teacherRequest.trim()) return null;
  if (!candidate.toolPlan || typeof candidate.toolPlan !== "object") return null;
  if (candidate.deliveryPlan !== undefined && (typeof candidate.deliveryPlan !== "object" || Array.isArray(candidate.deliveryPlan))) return null;
  if (candidate.runtimeKind !== "openai" && candidate.runtimeKind !== "deterministic") return null;

  return {
    status: candidate.status,
    teacherRequest: candidate.teacherRequest,
    toolPlan: candidate.toolPlan as CapabilityToolPlan,
    deliveryPlan: candidate.deliveryPlan as DeliveryPlan | undefined,
    runtimeKind: candidate.runtimeKind,
  };
}

function toPendingMainAgentTurn(pendingPlan: PendingDeliveryPlanMetadata): MainAgentTurn {
  return {
    assistantMessage: { body: pendingPlan.toolPlan.reasonForUser },
    state: "awaiting_confirmation",
    quickReplies: [],
    recommendedOptions: [],
    toolPlan: pendingPlan.toolPlan,
    deliveryPlan: pendingPlan.deliveryPlan,
    shouldRunToolNow: false,
    runtimeKind: pendingPlan.runtimeKind,
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
