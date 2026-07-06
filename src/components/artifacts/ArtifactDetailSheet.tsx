"use client";

import { Clipboard, CheckCircle2, RotateCcw, SendToBack, ShieldAlert } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

type ArtifactDetailSheetProps = {
  item: ArtifactItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onConfirm: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
};

export function ArtifactDetailSheet({
  item,
  open,
  onOpenChange,
  onCopy,
  onUseAsInput,
  onConfirm,
  onRegenerate,
}: ArtifactDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {item && (
          <>
            <div className="border-b px-5 py-5">
              <div className="flex items-center gap-2 pr-8">
                <SheetTitle className="title-md">{item.title}</SheetTitle>
                <Badge tone={item.status === "approved" ? "success" : item.status === "blocked" ? "danger" : "warning"}>
                  {item.status === "approved" ? "已确认" : item.status === "blocked" ? "需处理" : "演示数据"}
                </Badge>
              </div>
              <SheetDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                {item.summary}
              </SheetDescription>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-5">
                <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm leading-6 text-warning">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    当前内容是前端演示数据
                  </div>
                  <p className="mt-1 text-xs leading-5">它用于验证工作台体验，不代表真实生成结果。</p>
                </div>
                <section>
                  <h3 className="mb-2 text-sm font-semibold">关键字段</h3>
                  <div className="grid gap-2">
                    {item.previewFields.map((field) => (
                      <div key={field.label} className="rounded-md border bg-background p-3">
                        <div className="text-xs font-medium text-muted-foreground">{field.label}</div>
                        <div className="mt-1 text-sm leading-6">{field.value}</div>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold">完整产物摘要</h3>
                  <div className="space-y-2">
                    {Object.entries(item.content).map(([key, value]) => (
                      <div key={key} className="rounded-md border bg-card p-3">
                        <div className="text-xs font-medium text-muted-foreground">{key}</div>
                        {Array.isArray(value) ? (
                          <ul className="mt-2 space-y-1 text-sm leading-6">
                            {value.map((entry) => (
                              <li key={entry}>{entry}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm leading-6">{value}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 border-t p-4">
              <Button variant="secondary" disabled={!item.actions.canCopy} onClick={() => onCopy(item)}>
                <Clipboard className="h-4 w-4" />
                复制关键内容
              </Button>
              <Button variant="secondary" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
                <SendToBack className="h-4 w-4" />
                作为下一步输入
              </Button>
              {item.actions.canConfirm && (
                <Button variant="bronze" onClick={() => onConfirm(item)}>
                  <CheckCircle2 className="h-4 w-4" />
                  确认并进入下一步
                </Button>
              )}
              {item.actions.canRegenerate && (
                <Button variant="ghost" onClick={() => onRegenerate(item)}>
                  <RotateCcw className="h-4 w-4" />
                  重做
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

