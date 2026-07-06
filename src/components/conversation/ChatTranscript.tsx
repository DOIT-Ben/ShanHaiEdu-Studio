import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChatTranscriptProps = {
  messages: ChatMessage[];
};

export function ChatTranscript({ messages }: ChatTranscriptProps) {
  return (
    <div className="space-y-6">
      {messages.slice(0, 2).map((message) => {
        const assistant = message.speaker === "assistant";
        return (
          <article key={message.id} className="flex gap-3">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-medium text-muted-foreground",
                assistant && "text-foreground",
              )}
            >
              {assistant ? "AI" : "T"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-3">
                <span className="font-medium">{assistant ? "ShanHaiEdu AI" : "您"}</span>
                <span className="text-sm text-muted-foreground">10:24</span>
              </div>
              <div className="max-w-[760px] rounded-lg border bg-card px-5 py-4 text-sm leading-7">
                {message.title && <div className="mb-1 font-medium">{message.title}</div>}
                <p>{message.body}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
