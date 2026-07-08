"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, FileText } from "lucide-react";
import type { ArtifactItem, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GeneratingIndicator } from "@/components/conversation/messages/GeneratingIndicator";
import { QuickReplySuggestions } from "@/components/conversation/messages/QuickReplySuggestions";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  artifacts?: ArtifactItem[];
  sending?: boolean;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
  onQuickReplySelect?: (value: string) => void;
};

export function ChatTranscript({ messages, artifacts = [], sending = false, registerMessage, onQuickReplySelect }: ChatTranscriptProps) {
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
            registerMessage={registerMessage}
            onQuickReplySelect={onQuickReplySelect}
          />
        ) : (
          <TeacherMessage key={message.id} message={message} registerMessage={registerMessage} />
        );
      })}
      {sending && <AssistantThinking />}
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
  registerMessage,
  onQuickReplySelect,
}: {
  message: ChatMessage;
  artifact: ArtifactItem | null;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
  onQuickReplySelect?: (value: string) => void;
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
          {artifact && <TeacherArtifactCard item={artifact} />}
          {!artifact && quickReplies.length > 0 && (
            <QuickReplyChoices choices={quickReplies} onSelect={onQuickReplySelect} />
          )}
          <AssistantMessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
        </div>
      </div>
    </article>
  );
}

function findInlineArtifact(message: ChatMessage, artifacts: ArtifactItem[]) {
  if (artifacts.length === 0) return null;
  const text = `${message.title ?? ""}\n${message.body}`;
  if (!hasGeneratedSignal(text)) return null;
  const generatedArtifacts = artifacts.filter((item) => {
    if (!item.artifactId) return null;
    return item.status !== "not_started";
  });

  const directlyMentioned = generatedArtifacts.find((item) => text.includes(item.title));
  if (directlyMentioned) {
    return directlyMentioned;
  }

  const candidate =
    generatedArtifacts.find((item) => item.status === "needs_review") ??
    generatedArtifacts.find((item) => item.status === "stale") ??
    generatedArtifacts.find((item) => item.status === "approved") ??
    null;
  return candidate;
}

function hasGeneratedSignal(text: string) {
  return /已完成|已整理|已进入|可确认|需求规格/.test(text);
}

type QuickReplyChoice = {
  label: string;
  value: string;
  recommended?: boolean;
};

function getQuickReplyChoices(message: ChatMessage, artifact: ArtifactItem | null): QuickReplyChoice[] {
  if (artifact) return [];
  if (message.quickReplies?.length) {
    return message.quickReplies.map((reply) => ({
      label: reply.label,
      value: reply.prompt,
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
  onSelect?: (value: string) => void;
}) {
  return <QuickReplySuggestions choices={choices.map((choice) => ({ label: choice.label, prompt: choice.value, recommended: choice.recommended }))} onSelect={onSelect} />;
}

function TeacherArtifactCard({ item }: { item: ArtifactItem }) {
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

function AssistantThinking() {
  return <GeneratingIndicator mark={<ShanHaiMark active />} />;
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

function AssistantMessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-3 flex h-7 items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={copyText} aria-label="复制回复">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
