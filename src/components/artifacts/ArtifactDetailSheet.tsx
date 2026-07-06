"use client";

import { Clipboard, Eye, Image as ImageIcon, SendToBack } from "lucide-react";
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

function PreviewThumb({ label }: { label: string }) {
  return (
    <div>
      <div className="aspect-[4/3] rounded-lg border bg-muted" />
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

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
      <SheetContent className="max-w-[520px]">
        {item && (
          <>
            <div className="border-b px-5 py-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <SheetTitle className="title-md">{item.title}</SheetTitle>
                  <SheetDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.summary}
                  </SheetDescription>
                </div>
                <Badge tone={item.status === "blocked" ? "danger" : "neutral"}>
                  {item.status === "blocked" ? "需处理" : item.status === "needs_review" ? "待确认" : "已保存"}
                </Badge>
              </div>
              <div className="mt-5 flex gap-5 border-b text-sm">
                {["摘要", "来源对话", "页面脚本", "图片", "提示词"].map((tab, index) => (
                  <button
                    key={tab}
                    type="button"
                    className={index === 0 ? "border-b-2 border-foreground pb-2 font-medium text-foreground" : "pb-2 text-muted-foreground"}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-5">
                <section>
                  <h3 className="mb-3 text-sm font-semibold">生成来源</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-xs text-muted-foreground">上游产物</div>
                      <div className="mt-1">{item.sourceTitles.join("、") || "项目配置"}</div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-xs text-muted-foreground">更新时间</div>
                      <div className="mt-1">{item.updatedAt}</div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">缩略预览</h3>
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4" />
                      查看全部
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <PreviewThumb label="1" />
                    <PreviewThumb label="2" />
                    <PreviewThumb label="3" />
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold">可复用内容</h3>
                  <div className="space-y-2">
                    {Object.entries(item.content).map(([key, value]) => (
                      <div key={key} className="rounded-lg border bg-card p-3">
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
                复制
              </Button>
              <Button variant="secondary" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
                <SendToBack className="h-4 w-4" />
                作为输入
              </Button>
              <Button variant="secondary">
                <ImageIcon className="h-4 w-4" />
                查看图片
              </Button>
              {item.actions.canConfirm && <Button onClick={() => onConfirm(item)}>确认使用</Button>}
              {item.actions.canRegenerate && (
                <Button variant="ghost" onClick={() => onRegenerate(item)}>
                  调整后重做
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
