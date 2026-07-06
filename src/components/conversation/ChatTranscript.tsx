import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChatTranscriptProps = {
  messages: ChatMessage[];
};

export function ChatTranscript({ messages }: ChatTranscriptProps) {
  return (
    <div className="space-y-7">
      {messages.slice(0, 2).map((message) => {
        const assistant = message.speaker === "assistant";
        return (
          <article key={message.id} className="flex gap-4">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm",
                assistant ? "bg-primary" : "bg-slate-600",
              )}
            >
              {assistant ? "AI" : "T"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-3">
                <span className="font-semibold">{assistant ? "ShanHaiEdu AI" : "您"}</span>
                <span className="text-sm text-muted-foreground">10:24</span>
              </div>
              <div className="max-w-[720px] rounded-xl border bg-card px-5 py-4 text-sm leading-7 shadow-sm">
                {message.title && <div className="mb-1 font-semibold">{message.title}</div>}
                <p>{message.body}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

