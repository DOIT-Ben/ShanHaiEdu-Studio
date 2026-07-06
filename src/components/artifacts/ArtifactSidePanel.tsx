"use client";

import { useState } from "react";
import { Clipboard, PanelRightClose, SendToBack, Maximize2 } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/components/artifacts/MarkdownPreview";
import { ResizableHandle } from "@/components/artifacts/ResizableHandle";

type ArtifactSidePanelProps = {
  item: ArtifactItem | null;
  open: boolean;
  onClose: () => void;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpenDetail: (item: ArtifactItem) => void;
};

export function ArtifactSidePanel({
  item,
  open,
  onClose,
  onCopy,
  onUseAsInput,
  onOpenDetail,
}: ArtifactSidePanelProps) {
  const [width, setWidth] = useState(380);

  return (
    <aside
      className="relative hidden h-full shrink-0 overflow-hidden border-l bg-card transition-[width] duration-300 ease-out lg:block"
      style={{ width: open && item ? width : 0 }}
      aria-hidden={!open}
    >
      {open && item && (
        <div className="relative flex h-full min-w-[300px] flex-col">
          <ResizableHandle width={width} onChange={setWidth} />
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{item.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">产物预览 · {item.updatedAt}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="打开完整详情" onClick={() => onOpenDetail(item)}>
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="关闭产物预览" onClick={onClose}>
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-5">
              <MarkdownPreview item={item} />
            </div>
          </ScrollArea>

          <div className="flex flex-wrap gap-2 border-t px-4 py-3">
            <Button variant="secondary" size="sm" disabled={!item.actions.canCopy} onClick={() => onCopy(item)}>
              <Clipboard className="h-3.5 w-3.5" />
              复制
            </Button>
            <Button variant="secondary" size="sm" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
              <SendToBack className="h-3.5 w-3.5" />
              作为输入
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
