"use client";

import { useState } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenFeedback } from "@/lib/feedback-contracts";

type MessageActionsProps = {
  text: string;
  projectId: string;
  messageId: string;
  onOpenFeedback?: OpenFeedback;
};

export function MessageActions({ text, projectId, messageId, onOpenFeedback }: MessageActionsProps) {
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
    <div
      data-message-actions
      data-message-id={messageId}
      className="mt-3 flex min-h-7 flex-wrap items-center gap-1 opacity-100 transition-opacity duration-150 ease-out [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
    >
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={copyText} aria-label="复制回复">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-feedback-origin="message_helpful"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => onOpenFeedback?.({ origin: "message_helpful", projectId, messageId })}
        aria-label="这条有帮助"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-feedback-origin="message_unhelpful"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => onOpenFeedback?.({ origin: "message_unhelpful", projectId, messageId })}
        aria-label="这条没帮上"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
