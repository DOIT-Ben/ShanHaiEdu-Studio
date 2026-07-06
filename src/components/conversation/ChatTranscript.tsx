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
    <div className="space-y-10">
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
    <article ref={(node) => registerMessage?.(message.id, node)} className="scroll-mt-24 flex justify-end">
      <div className="max-w-[760px] rounded-2xl bg-[#f3f3f3] px-5 py-3.5 text-sm leading-7 text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.025)]">
        {message.body}
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
    <article ref={(node) => registerMessage?.(message.id, node)} className="group scroll-mt-24 max-w-[820px]">
      <div className="mb-3 flex items-center gap-3 text-sm">
        <span className="font-medium">ShanHaiEdu AI</span>
        <span className="text-muted-foreground">10:24</span>
      </div>
      <div className={cn("space-y-3 text-sm leading-7 text-foreground", message.tone === "focus" && "text-foreground")}>
        {message.title && <p>{message.title}</p>}
        <p>{message.body}</p>
      </div>
      <AssistantMessageActions text={[message.title, message.body].filter(Boolean).join("\n")} />
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
