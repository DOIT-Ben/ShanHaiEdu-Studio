"use client";

import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ConversationNavigatorProps = {
  messages: ChatMessage[];
  activeId?: string;
  onJump: (id: string) => void;
};

function messageLabel(message: ChatMessage) {
  return message.speaker === "assistant" ? "AI 回复" : "我的消息";
}

function messagePreview(message: ChatMessage) {
  return [message.title, message.body].filter(Boolean).join(" ").slice(0, 86);
}

export function ConversationNavigator({ messages, activeId, onJump }: ConversationNavigatorProps) {
  return (
    <nav className="sticky top-4 hidden h-[520px] w-8 shrink-0 md:block" aria-label="对话导航">
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
      <div className="relative flex h-full flex-col justify-center gap-4">
        {messages.slice(0, 3).map((message) => {
          const active = message.id === activeId;
          return (
            <div key={message.id} className="group relative">
              <button
                type="button"
                aria-label={`跳转到${messageLabel(message)}`}
                onClick={() => onJump(message.id)}
                className={cn(
                  "relative z-10 flex h-8 w-6 items-center justify-center rounded-md outline-none transition duration-150 ease-out hover:bg-[#f4f4f4] focus-visible:ring-2 focus-visible:ring-ring/35",
                )}
              >
                <span
                  className={cn(
                    "h-px w-4 rounded-full bg-muted-foreground/35 transition-all duration-150 ease-out group-hover:w-5 group-hover:bg-foreground/55",
                    active && "h-1.5 w-1.5 rounded-full bg-foreground/60",
                  )}
                />
              </button>
              <div className="pointer-events-none absolute left-8 top-1/2 z-30 w-[320px] -translate-y-1/2 translate-x-1 rounded-xl border bg-card px-3 py-2 opacity-0 shadow-[0_12px_34px_rgba(0,0,0,0.08)] transition duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100">
                <div className="text-xs font-medium text-foreground">{messageLabel(message)}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{messagePreview(message)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
