"use client";

import { useMemo, useRef, type ChangeEvent } from "react";
import {
  ArrowUp,
  ChevronRight,
  FileText,
  LoaderCircle,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";

import { GeneratingIndicator } from "@/components/conversation/messages/GeneratingIndicator";
import { MessageActions } from "@/components/conversation/messages/MessageActions";
import { QuickReplySuggestions } from "@/components/conversation/messages/QuickReplySuggestions";
import { buildWelcomePromptSuggestions } from "@/components/conversation/composer/composer-contracts";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import type { ArtifactItem, ChatDeliveryPlan, ChatMessage, WorkbenchLoadState } from "@/lib/types";
import type { WorkbenchExecutionFeedback } from "@/lib/workbench-execution-feedback";
import { cn } from "@/lib/utils";
import { createShanHaiMessagePartComponents } from "@/components/conversation/assistant-ui/MessagePartRenderers";
import type { ShanHaiAssistantMessageCustom } from "@/components/conversation/assistant-ui/message-adapter";

export type ShanHaiThreadProps = {
  projectId: string;
  artifacts: ArtifactItem[];
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  projectBusy: boolean;
  hasAgentActivity?: boolean;
  composerSubmitting: boolean;
  executionFeedback: WorkbenchExecutionFeedback | null;
  notice: string | null;
  composerNotice: string | null;
  reference: string | null;
  generationIntensityLabel: string;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onComposerInputChange: (value: string) => void;
  onSelectAction: (prompt: string, actionId?: string) => void;
  onRecoverCheckpoint: (checkpointId: string) => void | Promise<void>;
  onOpenArtifact: (artifactId: string) => void;
  onRetry: () => void;
  onOpenFeedback: OpenFeedback;
  onSetMessageReaction?: (messageId: string, value: ChatMessage["reaction"] | null) => void | Promise<void>;
  onOpenSettings?: () => void;
};

export function ShanHaiThread(props: ShanHaiThreadProps) {
  const partComponents = useMemo(() => createShanHaiMessagePartComponents({
    artifacts: props.artifacts,
    onOpenArtifact: props.onOpenArtifact,
    onSelectAction: props.onSelectAction,
    onRecoverCheckpoint: props.onRecoverCheckpoint,
    onRetryLoad: props.onRetry,
  }), [props.artifacts, props.onOpenArtifact, props.onRecoverCheckpoint, props.onRetry, props.onSelectAction]);
  const messageComponents = useMemo(() => ({
    UserMessage,
    AssistantMessage: () => <AssistantMessage {...props} partComponents={partComponents} />,
  }), [partComponents, props]);

  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col bg-card">
      <ThreadPrimitive.Viewport
        autoScroll
        data-assistant-ui-scroll-viewport
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-[880px] px-4 pb-36 pt-5 sm:px-6">
          <div className="mx-auto max-w-[800px] space-y-4">
            <ThreadNotice {...props} />
            <ThreadPrimitive.Empty>
              <WelcomeEmptyState onSelect={(prompt) => props.onSelectAction(prompt)} />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={messageComponents} />
            {props.projectBusy && !props.hasAgentActivity && <GeneratingIndicator label={props.executionFeedback?.label} mark={<XiaoKuMark active />} />}
          </div>
        </div>
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 z-10 border-t border-[#edf0ef] bg-card px-4 pb-4 pt-3 sm:px-8">
          <ShanHaiComposer {...props} />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function ThreadNotice({ loadState, errorMessage, notice, onRetry }: Pick<ShanHaiThreadProps, "loadState" | "errorMessage" | "notice" | "onRetry">) {
  if (loadState === "loading") return <div className="inline-flex rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">正在取回项目内容…</div>;
  if (loadState === "error") {
    return (
      <div className="flex max-w-[560px] items-center justify-between gap-3 rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">
        <span>{errorMessage ?? "项目内容暂时没有取回，请稍后再试。"}</span>
        <button type="button" className="shrink-0 text-foreground underline-offset-4 hover:underline" onClick={onRetry}>重试</button>
      </div>
    );
  }
  return notice ? <div className="inline-flex max-w-full rounded-md bg-[#f5f5f5] px-3 py-2 text-sm text-muted-foreground">{notice}</div> : null;
}

function UserMessage() {
  const custom = useMessageCustom();
  const showTurnStatus = Boolean(custom.turnStatusLabel && (custom.turnStatus === "queued" || custom.turnStatus === "canceled"));
  return (
    <MessagePrimitive.Root data-message-role="teacher" className="flex scroll-mt-24 justify-end">
      <div className="flex max-w-[82%] flex-col items-end gap-1.5 sm:max-w-[620px]">
        <div data-chat-bubble="user" className="break-words rounded-2xl bg-[#f1f1f1] px-4 py-2.5 text-sm leading-6 text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)]">
          <MessagePrimitive.Parts components={{ Text: UserPlainText }} />
        </div>
        {showTurnStatus && <span data-turn-status={custom.turnStatus} className="px-1 text-xs text-muted-foreground" aria-live="polite">{custom.turnStatusLabel}</span>}
      </div>
    </MessagePrimitive.Root>
  );
}

function UserPlainText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap">{text}</p>;
}

function AssistantMessage(props: ShanHaiThreadProps & { partComponents?: ReturnType<typeof createShanHaiMessagePartComponents> }) {
  const custom = useMessageCustom();
  const liveResponse = custom.projectionKind === "agent-response";
  const messageContent = useAuiState((state) => state.message.content);
  const hasArtifactPart = messageContent.some((part) => part.type === "data" && part.name === "shanhai.artifact-ref");
  const hasPlanPart = messageContent.some((part) => part.type === "data" && part.name === "shanhai.plan");
  const liveActivityStatuses = messageContent.flatMap((part) => {
    if (part.type !== "data" || part.name !== "shanhai.activity" || !isRecord(part.data)) return [];
    return typeof part.data.status === "string" ? [part.data.status] : [];
  });
  const liveRunning = liveActivityStatuses.some((status) => status === "running" || status === "queued" || status === "waiting");
  const liveFailed = liveActivityStatuses.some((status) => status === "failed" || status === "blocked");
  const fallbackArtifact = !hasArtifactPart ? props.artifacts.find((item) => item.artifactId && custom.artifactRefs.includes(item.artifactId)) : undefined;
  const partComponents = props.partComponents ?? createShanHaiMessagePartComponents({
    artifacts: props.artifacts,
    onOpenArtifact: props.onOpenArtifact,
    onSelectAction: props.onSelectAction,
    onRecoverCheckpoint: props.onRecoverCheckpoint,
    onRetryLoad: props.onRetry,
  });

  if (custom.projectionKind === "agent-activity") {
    return (
      <MessagePrimitive.Root data-message-role="assistant-activity" className="flex scroll-mt-24 justify-start" aria-live="polite">
        <div className="flex w-full max-w-[760px] items-start gap-3">
          <XiaoKuMark active={liveRunning} />
          <div data-agent-progress-timeline className="min-w-0 flex-1 pt-0.5 text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">小酷</span>
              <span data-agent-live-state={liveRunning ? "running" : liveFailed ? "paused" : "settled"} className="inline-flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", liveRunning ? "bg-[#4d8f82] shadow-[0_0_0_3px_rgba(77,143,130,0.10)]" : liveFailed ? "bg-[#b85b4d]" : "bg-[#8b9591]")} />
                {liveRunning ? "实时处理中" : liveFailed ? "已暂停，失败位置已保存" : "本轮进度"}
              </span>
            </div>
            <div className="space-y-1 rounded-md bg-[#f8faf9] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(92,126,116,0.10)]">
              <MessagePrimitive.Parts components={partComponents} />
              {liveRunning && <span data-agent-stream-caret aria-hidden="true" className="ml-1 inline-block h-4 w-[2px] translate-y-[3px] rounded-full bg-[#367d6d]" />}
            </div>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root data-message-role="assistant" className="group flex scroll-mt-24 justify-start">
      <div className="flex max-w-[92%] items-start gap-3 sm:max-w-[760px]">
        <XiaoKuMark active={liveResponse} />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">小酷</span>
            {custom.timeLabel && <span>{custom.timeLabel}</span>}
          </div>
          <div
            data-chat-bubble="assistant"
            className={cn("space-y-3 break-words px-1 py-0.5 text-sm leading-7 text-foreground", custom.tone === "focus" && "border-l-2 border-[#b9ddd2] pl-3")}
          >
            {custom.title && <p className="font-medium">{custom.title}</p>}
            <MessagePrimitive.Parts components={partComponents} />
            {liveResponse && <span data-agent-stream-caret aria-hidden="true" className="ml-1 inline-block h-4 w-[2px] translate-y-[3px] rounded-full bg-[#367d6d]" />}
          </div>
          {!hasPlanPart && custom.deliveryPlan && <DeliveryPlanSummary plan={custom.deliveryPlan} />}
          {fallbackArtifact && <LegacyArtifactReference item={fallbackArtifact} onOpenArtifact={props.onOpenArtifact} />}
          {custom.quickReplies.length > 0 && <QuickReplySuggestions choices={custom.quickReplies.map((reply) => ({ label: reply.label, prompt: reply.prompt, actionId: reply.actionId, recommended: reply.recommended }))} onSelect={props.onSelectAction} />}
          <MessageActions
            text={[custom.title, custom.body].filter(Boolean).join("\n")}
            projectId={props.projectId}
            messageId={custom.projectMessageId}
            onOpenFeedback={props.onOpenFeedback}
            reaction={custom.reaction}
            onSetReaction={props.onSetMessageReaction}
          />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function useMessageCustom() {
  return useAuiState((state) => state.message.metadata.custom as unknown as ShanHaiAssistantMessageCustom);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function DeliveryPlanSummary({ plan }: { plan: ChatDeliveryPlan }) {
  return (
    <div data-delivery-plan className="mt-3 max-w-[720px] rounded-md border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm">
      <p className="font-medium text-foreground">{plan.title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{plan.summary}</p>
      {plan.steps.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{plan.steps.filter((step) => step.status === "succeeded").length} / {plan.steps.length} 项已完成</p>}
    </div>
  );
}

function LegacyArtifactReference({ item, onOpenArtifact }: { item: ArtifactItem; onOpenArtifact: (artifactId: string) => void }) {
  if (!item.artifactId) return null;
  return (
    <button type="button" data-teacher-artifact-card onClick={() => onOpenArtifact(item.artifactId!)} className="mt-3 flex w-full max-w-[680px] items-start gap-3 rounded-md border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-left hover:border-[#b9ddd2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#32685d]" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{item.title}</span>
        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.summary}</span>
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ShanHaiComposer({ reference, composerNotice, projectBusy, composerSubmitting, generationIntensityLabel, onClearReference, onAttachFile, onAttachFileError, onComposerInputChange, onOpenSettings }: ShanHaiThreadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function attachFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      onAttachFileError("这份资料太大了，请换成 512KB 以内的文本文件。");
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (!text) {
        onAttachFileError("这份资料没有读取到文本内容。");
        return;
      }
      onAttachFile(file.name || "参考资料.txt", text.slice(0, 12000));
      if (text.length > 12000) onAttachFileError("资料较长，本轮已读取前 12000 个字符。");
    } catch {
      onAttachFileError("这份资料暂时没有读取成功，请换一个文本文件或直接粘贴关键内容。");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[800px]">
      {reference && (
        <div className="mb-2 flex max-w-full items-start justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <p className="line-clamp-2 min-w-0 text-xs leading-5 text-foreground"><span className="font-medium text-muted-foreground">引用：</span>{reference}</p>
          <button type="button" onClick={onClearReference} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white hover:text-foreground" aria-label="移除引用"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <ComposerPrimitive.Root data-composer-surface className="rounded-[22px] border border-[#dfe1e3] bg-card px-3 py-2 shadow-[0_14px_38px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] hover:border-[#c9cccf] focus-within:border-[#9ca3a8] focus-within:shadow-[0_18px_50px_rgba(0,0,0,0.085)]">
        <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.csv,.json,.text,text/*" className="hidden" onChange={attachFile} aria-label="选择资料" disabled={composerSubmitting} />
        <ComposerPrimitive.Input
          name="lesson-workbench-prompt"
          onChange={(event) => onComposerInputChange(event.currentTarget.value)}
          aria-label={projectBusy ? "正在生成中，也可以继续输入下一步要求" : "输入备课要求"}
          placeholder="输入备课要求，或和小酷聊聊这节课"
          disabled={composerSubmitting}
          addAttachmentOnPaste={false}
          minRows={1}
          maxRows={8}
          className="max-h-48 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/75"
        />
        <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-1">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label="添加资料" title="添加资料" disabled={composerSubmitting} onClick={() => fileInputRef.current?.click()} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-[#f0f1f2] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45 disabled:opacity-45">
              <Paperclip className="h-4 w-4" />
            </button>
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" aria-live="polite">{composerNotice ?? (projectBusy ? "正在生成中，你可以继续输入下一条要求。" : null)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label="选择生成强度" onClick={onOpenSettings} className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-foreground transition hover:bg-[#f0f1f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45">
              <Sparkles className="h-3.5 w-3.5 text-[#367d6d]" />
              <span>生成强度 · {generationIntensityLabel}</span>
            </button>
            <ComposerPrimitive.Send aria-label={composerSubmitting ? "正在发送" : projectBusy ? "加入队列" : "发送"} title={composerSubmitting ? "正在发送" : projectBusy ? "加入队列" : "发送"} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#191c20] text-white transition hover:bg-[#30343a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45 disabled:cursor-not-allowed disabled:opacity-55">
              {composerSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </ComposerPrimitive.Send>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function WelcomeEmptyState({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <section className="max-w-[720px] pt-3 text-foreground" aria-label="开始备课">
      <div className="mb-5 flex items-center gap-3">
        <XiaoKuMark />
        <div className="min-w-0"><h2 className="text-xl font-semibold tracking-normal">你好，我是小酷</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">说清年级、主题和想要的产物，我会陪你把这节课准备好。</p></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {buildWelcomePromptSuggestions().map((suggestion) => (
          <button key={suggestion.label} type="button" onClick={() => onSelect(suggestion.prompt)} className="min-h-[86px] rounded-md border bg-card px-3 py-2 text-left transition hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-sm font-medium">{suggestion.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{suggestion.prompt}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function XiaoKuMark({ active = false }: { active?: boolean }) {
  return <span data-assistant-logo className={cn("flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#dce2e0] bg-card", active && "shadow-[0_10px_24px_rgba(24,64,55,0.14)]")} aria-hidden="true"><img src="/brand/xiaoku-avatar.png" alt="" className="h-full w-full object-cover" /></span>;
}
