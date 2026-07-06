"use client";

import type { ChatMessage } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { GenerationPanel } from "@/components/conversation/GenerationPanel";
import { PromptComposer } from "@/components/conversation/PromptComposer";

type ConversationWorkbenchProps = {
  messages: ChatMessage[];
  input: string;
  reference: string | null;
  notice: string | null;
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
  onInputChange,
  onClearReference,
  onSend,
  onConfirmIntro,
  onRecover,
}: ConversationWorkbenchProps) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar />
      <StageProgress activeIndex={2} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-8 pb-36 pt-4 lg:pb-10">
          <div className="mx-auto max-w-[980px] space-y-10">
            {notice && (
              <div className="inline-flex max-w-full rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
                {notice}
              </div>
            )}
            <ChatTranscript messages={messages} />
            <GenerationPanel onConfirmIntro={onConfirmIntro} onRecover={onRecover} />
          </div>
        </div>
      </ScrollArea>
      <PromptComposer
        value={input}
        reference={reference}
        onChange={onInputChange}
        onClearReference={onClearReference}
        onSend={onSend}
      />
    </main>
  );
}
