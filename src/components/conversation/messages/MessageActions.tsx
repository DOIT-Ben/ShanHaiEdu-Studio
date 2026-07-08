"use client";

import { useState } from "react";
import { Check, Copy, MoreHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";

type MessageActionsProps = {
  text: string;
};

export function MessageActions({ text }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function recordFeedback() {
    setFeedbackNote("已在本页记下，反馈入口暂未开放。");
  }

  function showMoreNotice() {
    setFeedbackNote("更多操作暂未开放。");
  }

  return (
    <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={copyText} aria-label="复制回复">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={recordFeedback} aria-label="这条有帮助">
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={recordFeedback} aria-label="这条没帮上">
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={showMoreNotice} aria-label="更多操作">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
      {feedbackNote && (
        <span role="status" className="ml-1 text-xs text-muted-foreground" data-message-action-note>
          {feedbackNote}
        </span>
      )}
    </div>
  );
}
