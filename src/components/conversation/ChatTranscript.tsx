"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  sending?: boolean;
  registerMessage?: (id: string, node: HTMLElement | null) => void;
};

export function ChatTranscript({ messages, sending = false, registerMessage }: ChatTranscriptProps) {
  return (
    <div className="space-y-7">
      {messages.map((message) => {
        const assistant = message.speaker === "assistant";
        return assistant ? (
          <AssistantMessage key={message.id} message={message} registerMessage={registerMessage} />
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
  registerMessage,
}: {
  message: ChatMessage;
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
          <AssistantMessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
        </div>
      </div>
    </article>
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
      <svg viewBox="0 0 32 32" className="h-6 w-6" role="img">
        <path d="M7 22V9.5c0-1.1.8-1.9 1.9-1.9H24v15.1H8.9C7.8 22.7 7 22.2 7 22Z" fill="#ffffff" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 20.5c2.4-4 4.4-6.1 6-6.1 1.2 0 2.1 1.1 3 2.3.8 1.1 1.6 2.1 3 2.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M11 11.2h8.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        <path d="M23.5 7.6v15.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" opacity="0.45" />
        <path d="M24.4 9.1h1.9M25.35 8.15v1.9" stroke="#2aa889" strokeLinecap="round" strokeWidth="1.2" />
      </svg>
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
