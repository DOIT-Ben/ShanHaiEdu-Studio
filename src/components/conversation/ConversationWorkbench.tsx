"use client";

import { useEffect, useRef } from "react";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { PromptComposer } from "@/components/conversation/PromptComposer";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import { deriveWorkbenchStageIndex, type WorkbenchExecutionFeedback } from "@/lib/workbench-progress";

type ConversationWorkbenchProps = {
  project: ProjectItem | null;
  currentUser?: PasswordAuthUser | null;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  compact: boolean;
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  input: string;
  reference: string | null;
  composerSubmitting: boolean;
  projectBusy: boolean;
  executionFeedback: WorkbenchExecutionFeedback | null;
  notice: string | null;
  composerNotice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onSend: () => void;
  onQuickReplySelect?: (value: string, actionId?: string) => void;
  onRetry: () => void;
  onOpenArtifacts: () => void;
  onOpenMembers?: () => void;
  onOpenFeedback: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
};

export function ConversationWorkbench({
  project,
  currentUser,
  messages,
  artifacts,
  compact,
  loadState,
  errorMessage,
  input,
  reference,
  composerSubmitting,
  projectBusy,
  executionFeedback,
  notice,
  composerNotice,
  onInputChange,
  onClearReference,
  onAttachFile,
  onAttachFileError,
  onSend,
  onQuickReplySelect,
  onRetry,
  onOpenArtifacts,
  onOpenMembers,
  onOpenFeedback,
  onOpenUserManagement,
  onLogout,
}: ConversationWorkbenchProps) {
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, composerSubmitting, projectBusy]);

  function registerMessage(id: string, node: HTMLElement | null) {
    messageRefs.current[id] = node;
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar
        project={project}
        currentUser={currentUser}
        compact={compact}
        onOpenArtifacts={onOpenArtifacts}
        onOpenMembers={onOpenMembers}
        onOpenFeedback={onOpenFeedback}
        onOpenUserManagement={onOpenUserManagement}
        onLogout={onLogout}
      />
      <StageProgress activeIndex={deriveWorkbenchStageIndex({ project, artifacts, executionFeedback })} compact={compact} />
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
                正在取回项目内容…
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
              <ChatTranscript
                messages={messages}
                artifacts={artifacts}
                projectId={project?.id ?? ""}
                projectBusy={projectBusy}
                executionFeedback={executionFeedback}
                registerMessage={registerMessage}
                onQuickReplySelect={onQuickReplySelect}
                onOpenFeedback={onOpenFeedback}
              />
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
        composerSubmitting={composerSubmitting}
        projectBusy={projectBusy}
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
