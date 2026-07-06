"use client";

import { AlertTriangle, CheckCircle2, Clock, Film, Sparkles } from "lucide-react";
import type { ChatMessage, StepDefinition } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PromptComposer } from "@/components/conversation/PromptComposer";

type ConversationWorkbenchProps = {
  steps: StepDefinition[];
  messages: ChatMessage[];
  input: string;
  reference: string | null;
  notice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onSend: () => void;
  onConfirmIntro: () => void;
  onRecover: () => void;
};

export function ConversationWorkbench({
  steps,
  messages,
  input,
  reference,
  notice,
  onInputChange,
  onClearReference,
  onSend,
  onConfirmIntro,
  onRecover,
}: ConversationWorkbenchProps) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b bg-background/95 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>山海媒体工作台</span>
              <span>/</span>
              <span>认识三角形公开课</span>
              <span>/</span>
              <span className="text-foreground">导入视频策划卡</span>
            </div>
            <h1 className="title-lg mt-3">认识三角形公开课</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              将使用已确认的教材证据和教案，生成独立、有吸引力、能自然接回课堂的导入视频。
            </p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground">整体进度</div>
            <div className="mt-1 text-base font-semibold text-foreground">3 / 7</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {steps.slice(0, 4).map((step, index) => (
            <div key={step.key} className={cn("flex items-center gap-2", index === 2 && "text-foreground")}>
              <span>{step.label}</span>
              {index < 3 && <span>/</span>}
            </div>
          ))}
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          {notice && (
            <div className="rounded-lg border bg-card px-4 py-3 text-sm text-foreground">
              {notice}
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "max-w-[82%] rounded-xl border p-4 shadow-sm",
                message.speaker === "teacher" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-card",
                message.tone === "focus" && "border-border bg-card",
                message.tone === "warning" && "border-border bg-card",
              )}
            >
              {message.title && <h2 className="text-sm font-semibold">{message.title}</h2>}
              <p className={cn("text-sm leading-7", message.title && "mt-2")}>{message.body}</p>
            </article>
          ))}
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-bronze">
                  <Film className="h-4 w-4" />
                  <h2 className="title-md">导入视频候选方案</h2>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  这是一支独立开场短片，目标是抓住学生注意力，再通过课程锚点回到课堂。
                </p>
              </div>
              <Badge tone="bronze">等待确认</Badge>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {["城市里的三角形力量", "纸条挑战实验", "屋顶为什么不倒"].map((title, index) => (
                <div
                  key={title}
                  className={cn(
                    "rounded-lg border p-4 transition duration-150 hover:-translate-y-0.5 hover:border-bronze/40 hover:shadow-sm",
                    index === 0 ? "border-bronze/35 bg-bronze/5" : "bg-background",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{title}</h3>
                    {index === 0 && <Badge tone="bronze">推荐</Badge>}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {index === 0
                      ? "桥梁、塔吊、屋顶连续出现，最后追问共同点。"
                      : index === 1
                        ? "用纸条围图形，学生先猜哪种形状最稳。"
                        : "从校园屋顶观察切入，找到隐藏的三角形。"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-background p-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-bronze" />
                  课程锚点
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  视频最后通过“为什么这些地方都反复出现三角形”接回本课观察任务。
                </p>
              </div>
              <div className="rounded-lg border bg-muted/45 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle className="h-4 w-4" />
                  不提前讲解
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  视频不讲三角形定义、边和角的结论，把探究留给课堂。
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="bronze" onClick={onConfirmIntro}>
                <CheckCircle2 className="h-4 w-4" />
                确认这个方案
              </Button>
              <Button variant="secondary">
                <Clock className="h-4 w-4" />
                换一组方向
              </Button>
              <Button variant="ghost" onClick={onRecover}>
                查看失败恢复示例
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
      <PromptComposer
        value={input}
        reference={reference}
        onChange={onInputChange}
        onClearReference={onClearReference}
        onSend={onSend}
      />
    </main>
  );
}
