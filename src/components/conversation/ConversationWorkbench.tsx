"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, WorkbenchLoadState } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { GenerationPanel } from "@/components/conversation/GenerationPanel";
import { PromptComposer } from "@/components/conversation/PromptComposer";
import { ConversationNavigator } from "@/components/conversation/ConversationNavigator";
import type { PasswordAuthUser } from "@/lib/auth-api";

type ConversationWorkbenchProps = {
  currentUser?: PasswordAuthUser | null;
  messages: ChatMessage[];
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  input: string;
  reference: string | null;
  notice: string | null;
  composerNotice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onSend: () => void;
  onRetry: () => void;
  onConfirmIntro: () => void;
  onRecover: () => void;
  onLogout?: () => Promise<void>;
};

export function ConversationWorkbench({
  currentUser,
  messages,
  loadState,
  errorMessage,
  input,
  reference,
  notice,
  composerNotice,
  onInputChange,
  onClearReference,
  onSend,
  onRetry,
  onConfirmIntro,
  onRecover,
  onLogout,
}: ConversationWorkbenchProps) {
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeMessageId, setActiveMessageId] = useState(messages[0]?.id);

  useEffect(() => {
    setActiveMessageId(messages[0]?.id);
  }, [messages]);

  function registerMessage(id: string, node: HTMLElement | null) {
    messageRefs.current[id] = node;
  }

  function jumpToMessage(id: string) {
    setActiveMessageId(id);
    messageRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar currentUser={currentUser} onLogout={onLogout} />
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
              {loadState === "loading" && (
                <div className="inline-flex max-w-full rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
                  正在取回项目内容...
                </div>
              )}
              {loadState === "error" && (
                <div className="flex max-w-[560px] items-center justify-between gap-3 rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
                  <span>{errorMessage ?? "项目内容暂时没有取回，请稍后再试。"}</span>
                  <button type="button" className="shrink-0 text-foreground underline-offset-4 hover:underline" onClick={onRetry}>
                    重试
                  </button>
                </div>
              )}
              {messages.length > 0 ? (
                <ChatTranscript messages={messages} registerMessage={registerMessage} />
              ) : (
                loadState !== "loading" && (
                  <div className="max-w-[560px] rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
                    还没有对话。请描述年级、课题和希望生成的材料。
                  </div>
                )
              )}
              {messages.length > 0 && <GenerationPanel onConfirmIntro={onConfirmIntro} onRecover={onRecover} />}
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
