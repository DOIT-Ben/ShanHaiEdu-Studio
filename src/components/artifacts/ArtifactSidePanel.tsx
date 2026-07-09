"use client";

import { useState } from "react";
import { Clipboard, PanelRightClose, SendToBack, Maximize2 } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { ArtifactDownloadActions } from "@/components/artifacts/ArtifactDownloadActions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/components/artifacts/MarkdownPreview";
import { ResizableHandle } from "@/components/artifacts/ResizableHandle";
import { useArtifactCopyFeedback } from "@/hooks/useArtifactCopyFeedback";

type ArtifactSidePanelProps = {
  projectId: string;
  item: ArtifactItem | null;
  open: boolean;
  onClose: () => void;
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpenDetail: (item: ArtifactItem) => void;
};

export function ArtifactSidePanel({
  projectId,
  item,
  open,
  onClose,
  onCopy,
  onUseAsInput,
  onOpenDetail,
}: ArtifactSidePanelProps) {
  const [width, setWidth] = useState(360);

  return (
    <aside
      className="relative hidden h-full shrink-0 overflow-hidden border-l border-[#d7ebe5] bg-[#fbfefd] lg:block"
      style={{ width: open && item ? width : 0 }}
      aria-hidden={!open}
    >
      {open && item && (
        <>
          <ResizableHandle
            width={width}
            onChange={setWidth}
          />
          <ArtifactSidePanelContent
            projectId={projectId}
            item={item}
            onClose={onClose}
            onCopy={onCopy}
            onUseAsInput={onUseAsInput}
            onOpenDetail={onOpenDetail}
          />
        </>
      )}
    </aside>
  );
}

function ArtifactSidePanelContent({
  projectId,
  item,
  onClose,
  onCopy,
  onUseAsInput,
  onOpenDetail,
}: {
  projectId: string;
  item: ArtifactItem;
  onClose: () => void;
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpenDetail: (item: ArtifactItem) => void;
}) {
  const { copyItem, copyLabel } = useArtifactCopyFeedback(item, onCopy);

  return (
    <div className="relative flex h-full min-w-[300px] flex-col">
      <div className="flex items-center justify-between border-b border-[#d7ebe5] bg-[#fbfefd] px-5 py-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">备课成果 · {item.updatedAt}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="打开完整详情" onClick={() => onOpenDetail(item)}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="关闭成果阅读" onClick={onClose}>
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-6">
          <MarkdownPreview item={item} />
        </div>
      </ScrollArea>

      <div className="flex flex-wrap gap-2 border-t border-[#d7ebe5] bg-[#fbfefd] px-5 py-3">
        <Button variant="secondary" size="sm" disabled={!item.actions.canCopy} onClick={copyItem}>
          <Clipboard className="h-3.5 w-3.5" />
          {copyLabel}
        </Button>
        <Button variant="secondary" size="sm" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
          <SendToBack className="h-3.5 w-3.5" />
          作为输入
        </Button>
        <ArtifactDownloadActions projectId={projectId} item={item} variant="compact" />
      </div>
    </div>
  );
}
