import type { AgentRuntime } from "@/server/agent-runtime/types";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import {
  createConfiguredBusinessToolSkillRuntime,
  type BusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import type { ExecutionIdentitySnapshot, ProjectExecutionFence } from "@/server/workbench/types";

import { createControlPlaneStore } from "./control-plane-store";
import { executeTeacherMessageTurn } from "./conversation-turn-execution";
import type {
  ControlPlaneStore,
  MessageTurnResponse,
  WorkbenchService,
} from "./conversation-turn-types";
import type { MainConversationAgent } from "./main-conversation-agent";

export { capabilityTeacherLabel } from "./conversation-turn-progress";
export type { MessageTurnResponse } from "./conversation-turn-types";

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
      if (message.role !== "teacher") return { message };
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

    async executeQueuedTurn(
      projectId: string,
      input: ExecuteQueuedConversationTurnInput,
    ): Promise<MessageTurnResponse> {
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
        confirmedActionId: typeof message.metadata.confirmedActionId === "string"
          ? message.metadata.confirmedActionId
          : undefined,
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
