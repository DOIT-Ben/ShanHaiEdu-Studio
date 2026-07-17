"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";

import type { ChatMessage } from "@/lib/types";
import type { SubmitConversationMessageInput } from "@/hooks/useWorkbenchController";
import { ShanHaiThread, type ShanHaiThreadProps } from "@/components/conversation/assistant-ui/ShanHaiThread";
import { chatMessageToAssistantUi, messageBodyFromAssistantUi } from "@/components/conversation/assistant-ui/message-adapter";
import { useProjectAgentEvents } from "@/components/conversation/assistant-ui/useProjectAgentEvents";
import { hasCurrentTurnAgentProjection, mergeTeacherAgentEventsIntoMessages } from "@/lib/teacher-agent-events";
import type { TeacherAgentEvent } from "@/lib/teacher-agent-events";

type ShanHaiAssistantRuntimeProps = ShanHaiThreadProps & {
  messages: ChatMessage[];
  input: string;
  artifactRefs: string[];
  confirmedActionId: string | null;
  submitConversationMessage: (submission: SubmitConversationMessageInput) => Promise<void>;
  onAgentEvent: (event: TeacherAgentEvent) => Promise<number | null>;
  onAgentStreamError: () => void | Promise<void>;
};

export function ShanHaiAssistantRuntime({
  messages,
  input,
  artifactRefs,
  confirmedActionId,
  submitConversationMessage,
  onAgentEvent,
  onAgentStreamError,
  ...threadProps
}: ShanHaiAssistantRuntimeProps) {
  const agentEvents = useProjectAgentEvents(threadProps.projectId, onAgentEvent, onAgentStreamError);
  const runtimeMessages = useMemo(
    () => mergeTeacherAgentEventsIntoMessages(messages, agentEvents),
    [agentEvents, messages],
  );
  const hasLiveAgentProjection = hasCurrentTurnAgentProjection(messages, agentEvents);
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages: runtimeMessages,
    convertMessage: chatMessageToAssistantUi,
    isLoading: threadProps.loadState === "loading",
    // The server queue owns concurrent turns; the UI must remain steerable while a turn is running.
    isRunning: false,
    isSendDisabled: threadProps.composerSubmitting,
    unstable_enableToolInvocations: false,
    unstable_capabilities: { copy: false },
    onNew: async (message: AppendMessage) => {
      if (message.role !== "user") return;
      const body = messageBodyFromAssistantUi(message.content);
      await submitConversationMessage({
        body,
        reference: threadProps.reference,
        artifactRefs,
        ...(confirmedActionId ? { confirmedActionId } : {}),
      });
    },
  });
  const lastAppliedExternalInput = useRef("");

  useEffect(() => {
    if (input === lastAppliedExternalInput.current) return;
    lastAppliedExternalInput.current = input;
    runtime.thread.composer.setText(input);
  }, [input, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ShanHaiThread {...threadProps} hasAgentActivity={hasLiveAgentProjection} />
    </AssistantRuntimeProvider>
  );
}
