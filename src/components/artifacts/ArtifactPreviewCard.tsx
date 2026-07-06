"use client";

import { Clipboard, ExternalLink, SendToBack } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getArtifactStatusMeta } from "@/components/artifacts/artifact-status";

type ArtifactPreviewCardProps = {
  item: ArtifactItem;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
};

export function ArtifactPreviewCard({ item, onCopy, onUseAsInput, onOpen }: ArtifactPreviewCardProps) {
  const meta = getArtifactStatusMeta(item.status);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="space-y-2">
        {item.previewFields.slice(0, 3).map((field) => (
          <div key={field.label} className="rounded-md bg-muted/70 px-3 py-2">
            <div className="text-xs text-muted-foreground">{field.label}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-foreground">{field.value}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={!item.actions.canCopy} onClick={() => onCopy(item)}>
          <Clipboard className="h-3.5 w-3.5" />
          复制
        </Button>
        <Button variant="secondary" size="sm" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
          <SendToBack className="h-3.5 w-3.5" />
          作为输入
        </Button>
        <Button variant="default" size="sm" onClick={() => onOpen(item)}>
          <ExternalLink className="h-3.5 w-3.5" />
          详情
        </Button>
      </div>
    </div>
  );
}
