"use client";

import { useState } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import { cn } from "@/lib/utils";

type MessageActionsProps = {
  text: string;
  projectId: string;
  messageId: string;
  onOpenFeedback?: OpenFeedback;
  reaction?: "helpful" | "unhelpful";
  onSetReaction?: (messageId: string, value: "helpful" | "unhelpful" | null) => void | Promise<void>;
};

export function MessageActions({ text, projectId, messageId, onOpenFeedback, reaction, onSetReaction }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [reactionAnnouncement, setReactionAnnouncement] = useState("");

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function setReaction(value: "helpful" | "unhelpful") {
    if (reacting) return;
    const previousReaction = reaction;
    setReacting(true);
    try {
      if (onSetReaction) {
        await onSetReaction(messageId, previousReaction === value ? null : value);
        setReactionAnnouncement(
          previousReaction === value
            ? "已取消评价"
            : previousReaction
              ? `已改为${value === "helpful" ? "点赞" : "点踩"}`
              : `已${value === "helpful" ? "点赞" : "点踩"}`,
        );
      }
      else onOpenFeedback?.({ origin: value === "helpful" ? "message_helpful" : "message_unhelpful", projectId, messageId });
    } catch {
      setReactionAnnouncement("评价保存失败，请重试");
    } finally {
      setReacting(false);
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
      {copied && <span role="status" className="text-xs text-muted-foreground">已复制</span>}
      <Button
        variant="ghost"
        size="icon"
        data-feedback-origin="message_helpful"
        className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", reaction === "helpful" && "bg-[#e8f4ef] text-[#226452] hover:bg-[#e8f4ef] hover:text-[#226452]")}
        onClick={() => void setReaction("helpful")}
        disabled={reacting}
        aria-pressed={reaction === "helpful"}
        aria-label="这条有帮助"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-feedback-origin="message_unhelpful"
        className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", reaction === "unhelpful" && "bg-[#fff0ec] text-[#a44234] hover:bg-[#fff0ec] hover:text-[#a44234]")}
        onClick={() => void setReaction("unhelpful")}
        disabled={reacting}
        aria-pressed={reaction === "unhelpful"}
        aria-label="这条没帮上"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
      <span role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-xs text-muted-foreground">
        {reactionAnnouncement}
      </span>
    </div>
  );
}
