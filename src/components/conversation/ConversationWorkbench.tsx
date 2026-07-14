"use client";

import { useEffect, useRef } from "react";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import { StageProgress } from "@/components/conversation/StageProgress";
import { ChatTranscript } from "@/components/conversation/ChatTranscript";
import { PromptComposer } from "@/components/conversation/PromptComposer";
import { buildWelcomePromptSuggestions } from "@/components/conversation/composer/composer-contracts";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import { deriveWorkbenchStageIndex, type WorkbenchExecutionFeedback } from "@/lib/workbench-progress";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { generationIntensityLabel } from "@/lib/generation-intensity";

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
  onSetMessageReaction?: (messageId: string, value: ChatMessage["reaction"] | null) => void | Promise<void>;
  onRetry: () => void;
  onOpenArtifacts: () => void;
  onOpenMembers?: () => void;
  onOpenFeedback: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
  xiaokuResponseStyle: XiaoKuResponseStyle;
  onOpenXiaoKuSettings?: () => void;
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
  onSetMessageReaction,
  onRetry,
  onOpenArtifacts,
  onOpenMembers,
  onOpenFeedback,
  onOpenUserManagement,
  onLogout,
  xiaokuResponseStyle,
  onOpenXiaoKuSettings,
}: ConversationWorkbenchProps) {
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: compact ? "auto" : "smooth", block: "end" });
  }, [compact, messages.length, composerSubmitting, projectBusy]);

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
        onOpenXiaoKuSettings={onOpenXiaoKuSettings}
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
                onSetMessageReaction={onSetMessageReaction}
              />
            ) : (
              loadState !== "loading" && (
                <WelcomeEmptyState onSelect={(suggestion) => onInputChange(suggestion.prompt)} />
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
        generationIntensityLabel={generationIntensityLabel(project?.generationIntensity)}
        onOpenSettings={onOpenXiaoKuSettings}
      />
    </main>
  );
}

type WelcomeSuggestion = ReturnType<typeof buildWelcomePromptSuggestions>[number];

function WelcomeEmptyState({ onSelect }: { onSelect: (suggestion: WelcomeSuggestion) => void }) {
  const suggestions = buildWelcomePromptSuggestions();

  return (
    <section className="max-w-[720px] pt-3 text-foreground" aria-label="开始备课">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#dce2e0] bg-card">
          <img src="/brand/xiaoku-avatar.png" alt="小酷" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-normal text-foreground">你好，我是小酷</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">说清年级、主题和想要的产物，我会陪你把这节课准备好。</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            className="min-h-[86px] rounded-lg border bg-card px-3 py-2 text-left transition hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(suggestion)}
          >
            <span className="block text-sm font-medium text-foreground">{suggestion.label}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{suggestion.prompt}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
