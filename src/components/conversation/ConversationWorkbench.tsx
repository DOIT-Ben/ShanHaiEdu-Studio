"use client";

import { useEffect, useRef } from "react";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { PromptComposer } from "@/components/conversation/PromptComposer";
import type { PasswordAuthUser } from "@/lib/auth-api";

type ConversationWorkbenchProps = {
  project: ProjectItem | null;
  currentUser?: PasswordAuthUser | null;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  input: string;
  reference: string | null;
  sending: boolean;
  notice: string | null;
  composerNotice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onSend: () => void;
  onRetry: () => void;
  onOpenArtifacts: () => void;
  onLogout?: () => Promise<void>;
};

export function ConversationWorkbench({
  project,
  currentUser,
  messages,
  artifacts,
  loadState,
  errorMessage,
  input,
  reference,
  sending,
  notice,
  composerNotice,
  onInputChange,
  onClearReference,
  onAttachFile,
  onAttachFileError,
  onSend,
  onRetry,
  onOpenArtifacts,
  onLogout,
}: ConversationWorkbenchProps) {
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  function registerMessage(id: string, node: HTMLElement | null) {
    messageRefs.current[id] = node;
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar project={project} currentUser={currentUser} onOpenArtifacts={onOpenArtifacts} onLogout={onLogout} />
      <StageProgress activeIndex={stageIndexFromProject(project)} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1040px] px-4 pb-36 pt-4 sm:px-6 lg:pb-10">
          <div className="mx-auto max-w-[920px] space-y-8">
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
              <ChatTranscript messages={messages} artifacts={artifacts} sending={sending} registerMessage={registerMessage} />
            ) : (
              loadState !== "loading" && (
                <div className="max-w-[640px] rounded-2xl border bg-card px-5 py-4 text-sm leading-7 text-muted-foreground shadow-[0_10px_28px_rgba(0,0,0,0.035)]">
                  直接告诉我你要准备哪节公开课，比如“五年级数学百分数，生成教案、PPT 大纲和导入视频方案”。
                </div>
              )
            )}
            <div ref={scrollAnchorRef} data-chat-scroll-anchor className="h-1" />
          </div>
        </div>
      </ScrollArea>
      <PromptComposer
        value={input}
        reference={reference}
        sending={sending}
        notice={composerNotice}
        onChange={onInputChange}
        onClearReference={onClearReference}
        onAttachFile={onAttachFile}
        onAttachFileError={onAttachFileError}
        onSend={onSend}
      />
    </main>
  );
}

function stageIndexFromProject(project: ProjectItem | null) {
  const step = project?.currentStep ?? "";
  if (/教材|教案|教学/.test(step)) return 1;
  if (/PPT|图片|视频|导入|资源/.test(step)) return 2;
  if (/检查|优化|重审/.test(step)) return 3;
  if (/交付|完成/.test(step)) return 4;
  return 0;
}
