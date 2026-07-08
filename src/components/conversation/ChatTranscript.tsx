"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ChatTranscriptProps = {
  messages: ChatMessage[];
  registerMessage?: (id: string, node: HTMLElement | null) => void;
};

export function ChatTranscript({ messages, registerMessage }: ChatTranscriptProps) {
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
      <div className="max-w-[88%] sm:max-w-[760px]">
        <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">ShanHaiEdu AI</span>
          {message.timeLabel && <span>{message.timeLabel}</span>}
        </div>
        <div
          data-chat-bubble="assistant"
          className={cn(
            "space-y-3 whitespace-pre-wrap rounded-2xl border bg-card px-4 py-3 text-sm leading-7 text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.04)] sm:px-5",
            message.tone === "focus" && "border-input",
          )}
        >
          {message.title && <p className="font-medium">{message.title}</p>}
          <p>{message.body}</p>
        </div>
        <AssistantMessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
      </div>
    </article>
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
