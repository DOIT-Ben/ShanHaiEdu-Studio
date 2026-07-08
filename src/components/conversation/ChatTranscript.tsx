"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, FileText } from "lucide-react";
import type { ArtifactItem, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  artifacts?: ArtifactItem[];
  sending?: boolean;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
};

export function ChatTranscript({ messages, artifacts = [], sending = false, registerMessage }: ChatTranscriptProps) {
  return (
    <div className="space-y-7">
      {messages.map((message) => {
        const assistant = message.speaker === "assistant";
        const artifact = assistant ? findInlineArtifact(message, artifacts) : null;
        return assistant ? (
          <AssistantMessage key={message.id} message={message} artifact={artifact} registerMessage={registerMessage} />
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
          className="whitespace-pre-wrap rounded-2xl bg-[#f1f1f1] px-4 py-3 text-sm leading-7 text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)] sm:px-5"
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
}: {
  message: ChatMessage;
  artifact: ArtifactItem | null;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
}) {
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
              "space-y-3 whitespace-pre-wrap rounded-2xl border border-[#d7ebe5] bg-card px-4 py-3 text-sm leading-7 text-foreground shadow-[0_12px_30px_rgba(29,74,66,0.055)] sm:px-5",
              message.tone === "focus" && "border-[#b9ddd2] shadow-[0_16px_34px_rgba(29,74,66,0.075)]",
            )}
          >
            {message.title && <p className="font-medium">{message.title}</p>}
            <p>{message.body}</p>
          </div>
          {artifact && <GeneratedArtifactInline item={artifact} />}
          <AssistantMessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
        </div>
      </div>
    </article>
  );
}

function findInlineArtifact(message: ChatMessage, artifacts: ArtifactItem[]) {
  if (artifacts.length === 0) return null;
  const text = `${message.title ?? ""}\n${message.body}`;
  if (!/(已生成|生成|产物|草稿|说明书|教案|大纲|视频|交付)/.test(text)) return null;

  const directlyMentioned = artifacts.find((item) => text.includes(item.title));
  if (directlyMentioned && directlyMentioned.status !== "not_started") return directlyMentioned;

  return (
    artifacts.find((item) => item.status === "needs_review") ??
    artifacts.find((item) => item.status === "stale") ??
    artifacts.find((item) => item.status === "approved") ??
    artifacts.find((item) => item.status !== "not_started") ??
    null
  );
}

function GeneratedArtifactInline({ item }: { item: ArtifactItem }) {
  const [expanded, setExpanded] = useState(false);
  const contentEntries = Object.entries(item.content).slice(0, 2);

  return (
    <div
      data-generated-artifact-inline
      className="mt-3 max-w-[680px] rounded-xl border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm shadow-[0_10px_26px_rgba(29,74,66,0.045)]"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#cae2db] bg-white text-[#32685d]">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#32685d]">生成内容已进入产物链</span>
            <span className="rounded-full border border-[#d7ebe5] bg-white px-2 py-0.5 text-xs text-muted-foreground">{item.title}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-foreground">{item.summary}</p>
          {item.previewFields.length > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {item.previewFields.slice(0, 2).map((field) => (
                <div key={field.label} className="min-w-0 rounded-md bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
                  <div className="text-xs text-muted-foreground">{field.label}</div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-foreground">{field.value}</div>
                </div>
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
              {item.previewFields.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {item.previewFields.slice(0, 4).map((field) => (
                    <div key={field.label} className="min-w-0 rounded-md bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
                      <div className="text-xs text-muted-foreground">{field.label}</div>
                      <div className="mt-0.5 text-xs leading-5 text-foreground">{field.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {contentEntries.length > 0 && (
                <div className="space-y-2">
                  {contentEntries.map(([title, value]) => (
                    <div key={title} className="rounded-md bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgba(43,112,97,0.08)]">
                      <div className="text-xs text-muted-foreground">{title}</div>
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-foreground">
                        {Array.isArray(value) ? value.join("\n") : value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs leading-5 text-muted-foreground">上游来源：{item.sourceTitles.join("、") || "当前项目配置"}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantThinking() {
  return (
    <article data-ai-thinking className="scroll-mt-24 flex justify-start" aria-live="polite" aria-label="AI 正在回复">
      <div className="flex max-w-[88%] items-start gap-3 sm:max-w-[620px]">
        <ShanHaiMark active />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">ShanHaiEdu AI</span>
          </div>
          <div className="inline-flex items-center gap-3 rounded-2xl border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm text-muted-foreground shadow-[0_12px_30px_rgba(29,74,66,0.05)]">
            <span>正在整理回复</span>
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span className="typing-dot" />
              <span className="typing-dot [animation-delay:140ms]" />
              <span className="typing-dot [animation-delay:280ms]" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
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
