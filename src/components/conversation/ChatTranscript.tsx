"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { ArtifactItem, ChatDeliveryPlan, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GeneratingIndicator } from "@/components/conversation/messages/GeneratingIndicator";
import { MessageActions } from "@/components/conversation/messages/MessageActions";
import { QuickReplySuggestions } from "@/components/conversation/messages/QuickReplySuggestions";
import { ArtifactDownloadActions } from "@/components/artifacts/ArtifactDownloadActions";
import type { WorkbenchExecutionFeedback } from "@/lib/workbench-progress";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  artifacts?: ArtifactItem[];
  projectId: string;
  projectBusy?: boolean;
  executionFeedback?: WorkbenchExecutionFeedback | null;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
  onQuickReplySelect?: (value: string, actionId?: string) => void;
};

export function ChatTranscript({ messages, artifacts = [], projectId, projectBusy = false, executionFeedback = null, registerMessage, onQuickReplySelect }: ChatTranscriptProps) {
  return (
    <div className="space-y-7">
      {messages.map((message) => {
        const assistant = message.speaker === "assistant";
        const artifact = assistant ? findInlineArtifact(message, artifacts) : null;
        return assistant ? (
          <AssistantMessage
            key={message.id}
            message={message}
            artifact={artifact}
            projectId={projectId}
            registerMessage={registerMessage}
            onQuickReplySelect={onQuickReplySelect}
          />
        ) : (
          <TeacherMessage key={message.id} message={message} registerMessage={registerMessage} />
        );
      })}
      {projectBusy && <AssistantThinking label={executionFeedback?.label} />}
    </div>
  );
}

function TeacherMessage({
  message,
  registerMessage,
}: {
  message: ChatMessage;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
}) {
  return (
    <article
      ref={(node) => registerMessage?.(message.id, node)}
      data-message-role={message.speaker}
      className="scroll-mt-24 flex justify-end"
    >
      <div className="flex max-w-[78%] flex-col items-end gap-1.5 sm:max-w-[680px]">
        <span className="px-1 text-xs text-muted-foreground">你</span>
        {message.turnStatusLabel && (
          <span data-turn-status={message.turnStatus} className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {message.turnStatusLabel}
          </span>
        )}
        <div
          data-chat-bubble="user"
          className="break-words whitespace-pre-wrap rounded-2xl bg-[#f1f1f1] px-4 py-3 text-sm leading-7 text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)] sm:px-5"
        >
          {message.body}
        </div>
      </div>
    </article>
  );
}

function AssistantMessage({
  message,
  artifact,
  projectId,
  registerMessage,
  onQuickReplySelect,
}: {
  message: ChatMessage;
  artifact: ArtifactItem | null;
  projectId: string;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
  onQuickReplySelect?: (value: string, actionId?: string) => void;
}) {
  const quickReplies = getQuickReplyChoices(message, artifact);

  return (
    <article
      ref={(node) => registerMessage?.(message.id, node)}
      data-message-role={message.speaker}
      className="group scroll-mt-24 flex justify-start"
    >
      <div className="flex max-w-[88%] items-start gap-3 sm:max-w-[790px]">
        <ShanHaiMark />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">ShanHaiEdu AI</span>
            {message.timeLabel && <span>{message.timeLabel}</span>}
          </div>
          <div
            data-chat-bubble="assistant"
            className={cn(
              "space-y-3 break-words whitespace-pre-wrap rounded-2xl border border-[#d7ebe5] bg-card px-4 py-3 text-sm leading-7 text-foreground shadow-[0_12px_30px_rgba(29,74,66,0.055)] sm:px-5",
              message.tone === "focus" && "border-[#b9ddd2] shadow-[0_16px_34px_rgba(29,74,66,0.075)]",
            )}
          >
            {message.title && <p className="font-medium">{message.title}</p>}
            <p>{message.body}</p>
          </div>
          {message.deliveryPlan && <DeliveryPlanCard plan={message.deliveryPlan} />}
          {artifact && <TeacherArtifactCard projectId={projectId} item={artifact} />}
          {quickReplies.length > 0 && (
            <QuickReplyChoices choices={quickReplies} onSelect={onQuickReplySelect} />
          )}
          <MessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
        </div>
      </div>
    </article>
  );
}

function DeliveryPlanCard({ plan }: { plan: ChatDeliveryPlan }) {
  return (
    <div className="mt-3 max-w-[720px] rounded-xl border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm shadow-[0_10px_26px_rgba(29,74,66,0.045)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[#32685d]">备课推进计划</span>
        <span className="rounded-full border border-[#d7ebe5] bg-white px-2 py-0.5 text-xs text-muted-foreground">{plan.title}</span>
      </div>
      <p className="mt-1 text-sm leading-6 text-foreground">{plan.summary}</p>
      <ol className="mt-3 space-y-2">
        {plan.steps.map((step, index) => (
          <li key={step.id} className="flex gap-3 rounded-lg bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef8f5] text-[11px] font-medium text-[#32685d]">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{step.title}</span>
                <span className="rounded-full bg-[#f2f7f5] px-2 py-0.5 text-xs text-muted-foreground">{step.statusLabel}</span>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.teacherDescription}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function findInlineArtifact(message: ChatMessage, artifacts: ArtifactItem[]) {
  if (artifacts.length === 0) return null;
  if (!message.artifactRefs?.length) return null;
  return artifacts.find((item) => item.artifactId && message.artifactRefs?.includes(item.artifactId)) ?? null;
}

type QuickReplyChoice = {
  label: string;
  value: string;
  actionId?: string;
  recommended?: boolean;
};

function getQuickReplyChoices(message: ChatMessage, _artifact: ArtifactItem | null): QuickReplyChoice[] {
  if (message.quickReplies?.length) {
    return message.quickReplies.map((reply) => ({
      label: reply.label,
      value: reply.prompt,
      actionId: reply.actionId,
      recommended: reply.recommended,
    }));
  }
  return [];
}

function QuickReplyChoices({
  choices,
  onSelect,
}: {
  choices: QuickReplyChoice[];
  onSelect?: (value: string, actionId?: string) => void;
}) {
  return <QuickReplySuggestions choices={choices.map((choice) => ({ label: choice.label, prompt: choice.value, actionId: choice.actionId, recommended: choice.recommended }))} onSelect={onSelect} />;
}

function TeacherArtifactCard({ projectId, item }: { projectId: string; item: ArtifactItem }) {
  const [expanded, setExpanded] = useState(false);
  const readableLines = Object.values(item.content)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(String)
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div
      data-teacher-artifact-card
      className="mt-3 max-w-[680px] rounded-xl border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm shadow-[0_10px_26px_rgba(29,74,66,0.045)]"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#cae2db] bg-white text-[#32685d]">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#32685d]">已整理出一版备课成果</span>
            <span className="rounded-full border border-[#d7ebe5] bg-white px-2 py-0.5 text-xs text-muted-foreground">{item.title}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground">{item.summary}</p>
          {item.previewFields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.previewFields.slice(0, 3).map((field) => (
                <span key={field.label} className="rounded-md bg-white px-2.5 py-1 text-xs text-muted-foreground shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
                  <span className="break-words">{field.label}：{field.value}</span>
                </span>
              ))}
            </div>
          )}
          <ArtifactDownloadActions projectId={projectId} item={item} variant="inline" />
          <button
            type="button"
            data-inline-artifact-toggle
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[#32685d] transition hover:bg-[#eef8f5] focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/35"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                收起
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                展开查看
              </>
            )}
          </button>
          {expanded && (
            <div data-inline-artifact-expanded className="mt-3 space-y-3 border-t border-[#d7ebe5] pt-3">
              {readableLines.length > 0 && (
                <div className="space-y-2">
                  {readableLines.map((line, index) => (
                    <div key={`${item.key}-${index}`} className="rounded-md bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
                      <p className="break-words whitespace-pre-wrap text-xs leading-5 text-foreground">
                        {line}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantThinking({ label }: { label?: string }) {
  return <GeneratingIndicator mark={<ShanHaiMark active />} label={label} />;
}

function ShanHaiMark({ active = false }: { active?: boolean }) {
  return (
    <div
      data-assistant-logo
      className={cn(
        "mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#cae2db] bg-[#f8fffc] text-[#32685d] shadow-[0_10px_24px_rgba(29,74,66,0.1)]",
        active && "border-[#8fcbbb] bg-[#f0fffa] shadow-[0_12px_28px_rgba(29,74,66,0.14)]",
      )}
      aria-hidden="true"
    >
      <img src="/brand/shanhai-ai-logo-256.png" alt="" className="h-full w-full rounded-xl object-cover" />
    </div>
  );
}
