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
        <div className="mx-auto w-full max-w-5xl px-8 pb-32 lg:pb-8">
          <div className="rounded-xl border bg-[#fafafa] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="space-y-7">
              {notice && <div className="rounded-lg border bg-card px-4 py-3 text-sm text-foreground">{notice}</div>}
              <ChatTranscript messages={messages} />
              <GenerationPanel onConfirmIntro={onConfirmIntro} onRecover={onRecover} />
            </div>
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
