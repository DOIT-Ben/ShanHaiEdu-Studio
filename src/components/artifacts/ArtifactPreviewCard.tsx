"use client";

import { ArrowRight } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getArtifactStatusMeta } from "@/components/artifacts/artifact-status";

type ArtifactPreviewCardProps = {
  projectId: string;
  item: ArtifactItem;
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
};

export function ArtifactPreviewCard({ projectId, item, onCopy, onUseAsInput, onOpen }: ArtifactPreviewCardProps) {
  const meta = getArtifactStatusMeta(item.status);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">{item.title}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="space-y-2">
        {item.previewFields.slice(0, 3).map((field) => (
          <div key={field.label} className="border-l border-[#d7ebe5] pl-3">
            <div className="text-xs text-muted-foreground">{field.label}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-foreground">{field.value}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-end border-t border-[#e5efec] pt-3">
        <Button size="sm" onClick={() => onOpen(item)}>
          打开阅读
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
