"use client";

import { useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { GenerationPanel } from "@/components/conversation/GenerationPanel";
import { PromptComposer } from "@/components/conversation/PromptComposer";
import { ConversationNavigator } from "@/components/conversation/ConversationNavigator";

type ConversationWorkbenchProps = {
  messages: ChatMessage[];
  input: string;
  reference: string | null;
  notice: string | null;
  composerNotice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onSend: () => void;
  onConfirmIntro: () => void;
  onRecover: () => void;
};

export function ConversationWorkbench({
  messages,
  input,
  reference,
  notice,
  composerNotice,
  onInputChange,
  onClearReference,
  onSend,
  onConfirmIntro,
  onRecover,
}: ConversationWorkbenchProps) {
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeMessageId, setActiveMessageId] = useState(messages[0]?.id);

  function registerMessage(id: string, node: HTMLElement | null) {
    messageRefs.current[id] = node;
  }

  function jumpToMessage(id: string) {
    setActiveMessageId(id);
    messageRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar />
      <StageProgress activeIndex={2} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-6xl gap-4 px-6 pb-36 pt-4 lg:pb-10">
          <ConversationNavigator messages={messages} activeId={activeMessageId} onJump={jumpToMessage} />
          <div className="min-w-0 flex-1">
            <div className="mx-auto max-w-[980px] space-y-10">
              {notice && (
                <div className="inline-flex max-w-full rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
                  {notice}
                </div>
              )}
              <ChatTranscript messages={messages} registerMessage={registerMessage} />
              <GenerationPanel onConfirmIntro={onConfirmIntro} onRecover={onRecover} />
            </div>
          </div>
        </div>
      </ScrollArea>
      <PromptComposer
        value={input}
        reference={reference}
        notice={composerNotice}
        onChange={onInputChange}
        onClearReference={onClearReference}
        onSend={onSend}
      />
    </main>
  );
}
