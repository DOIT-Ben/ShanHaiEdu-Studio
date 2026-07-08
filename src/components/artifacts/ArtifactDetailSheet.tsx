"use client";

import { Clipboard, Download, FileDown, Image as ImageIcon, SendToBack, Video } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { getRealAssetGenerationActions, type RealAssetKind } from "@/lib/artifact-real-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/artifacts/MarkdownPreview";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useArtifactCopyFeedback } from "@/hooks/useArtifactCopyFeedback";
import { useArtifactMarkdownDownload } from "@/hooks/useArtifactMarkdownDownload";
import { useArtifactPptxDownload } from "@/hooks/useArtifactPptxDownload";
import { useArtifactRealAssetDownload } from "@/hooks/useArtifactRealAssetDownload";
import { useFinalPackageDownload } from "@/hooks/useFinalPackageDownload";

type ArtifactDetailSheetProps = {
  projectId: string;
  item: ArtifactItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>;
  onUseAsInput: (item: ArtifactItem) => void;
  onConfirm: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
  onGenerateRealAsset: (item: ArtifactItem, assetKind: RealAssetKind) => void;
  realAssetGenerationKey: string | null;
};

export function ArtifactDetailSheet({
  projectId,
  item,
  open,
  onOpenChange,
  onCopy,
  onUseAsInput,
  onConfirm,
  onRegenerate,
  onGenerateRealAsset,
  realAssetGenerationKey,
}: ArtifactDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-[540px] border-[#d7ebe5] bg-[#fbfefd]">
        {item && (
          <ArtifactDetailContent
            projectId={projectId}
            item={item}
            onCopy={onCopy}
            onUseAsInput={onUseAsInput}
            onConfirm={onConfirm}
            onRegenerate={onRegenerate}
            onGenerateRealAsset={onGenerateRealAsset}
            realAssetGenerationKey={realAssetGenerationKey}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ArtifactDetailContent({
  projectId,
  item,
  onCopy,
  onUseAsInput,
  onConfirm,
  onRegenerate,
  onGenerateRealAsset,
  realAssetGenerationKey,
}: {
  projectId: string;
  item: ArtifactItem;
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>;
  onUseAsInput: (item: ArtifactItem) => void;
  onConfirm: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
  onGenerateRealAsset: (item: ArtifactItem, assetKind: RealAssetKind) => void;
  realAssetGenerationKey: string | null;
}) {
  const { copyItem, copyLabel } = useArtifactCopyFeedback(item, onCopy);
  const { downloadMarkdown, downloadLabel } = useArtifactMarkdownDownload(item);
  const { canDownloadPptx, downloadPptx, downloadPptxLabel } = useArtifactPptxDownload(projectId, item);
  const imageDownload = useArtifactRealAssetDownload(projectId, item, "image");
  const videoDownload = useArtifactRealAssetDownload(projectId, item, "video");
  const { canDownloadPackage, downloadPackage, downloadPackageLabel } = useFinalPackageDownload(projectId, item);
  const realAssetActions = getRealAssetGenerationActions(item);

  return (
    <>
      <div className="border-b border-[#d7ebe5] bg-[#fbfefd] px-5 py-5">
        <div className="flex items-start justify-between gap-4 pr-8">
          <div>
            <SheetTitle className="title-md">{item.title}</SheetTitle>
            <SheetDescription className="mt-2 text-sm leading-6 text-muted-foreground">{item.summary}</SheetDescription>
          </div>
          <Badge tone={item.status === "blocked" ? "danger" : "neutral"}>{item.status === "blocked" ? "需处理" : item.status === "needs_review" ? "待确认" : "已保存"}</Badge>
        </div>
        <div className="mt-4 text-xs font-medium text-[#32685d]">成果阅读</div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-5">
          <section className="rounded-lg border border-[#d7ebe5] bg-white p-4">
            <MarkdownPreview item={item} showHeader={false} />
          </section>
        </div>
      </ScrollArea>
      <div className="flex flex-wrap gap-2 border-t border-[#d7ebe5] bg-[#fbfefd] p-4">
        <Button variant="secondary" disabled={!item.actions.canCopy} onClick={copyItem}>
          <Clipboard className="h-4 w-4" />
          {copyLabel}
        </Button>
        <Button variant="secondary" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
          <SendToBack className="h-4 w-4" />
          作为输入
        </Button>
        <Button variant="secondary" disabled={!item.actions.canCopy} onClick={downloadMarkdown}>
          <Download className="h-4 w-4" />
          {downloadLabel}
        </Button>
        {canDownloadPptx && (
          <Button variant="secondary" onClick={downloadPptx}>
            <Download className="h-4 w-4" />
            {downloadPptxLabel}
          </Button>
        )}
        {imageDownload.canDownloadRealAsset && (
          <Button variant="secondary" onClick={imageDownload.downloadRealAsset}>
            <Download className="h-4 w-4" />
            {imageDownload.downloadRealAssetLabel}
          </Button>
        )}
        {videoDownload.canDownloadRealAsset && (
          <Button variant="secondary" onClick={videoDownload.downloadRealAsset}>
            <Download className="h-4 w-4" />
            {videoDownload.downloadRealAssetLabel}
          </Button>
        )}
        {canDownloadPackage && (
          <Button variant="secondary" onClick={downloadPackage}>
            <Download className="h-4 w-4" />
            {downloadPackageLabel}
          </Button>
        )}
        {realAssetActions.map((action) => {
          const actionKey = `${item.artifactId}:${action.kind}`;
          const pending = realAssetGenerationKey === actionKey;
          const Icon = action.kind === "pptx" ? FileDown : action.kind === "image" ? ImageIcon : Video;
          return (
            <Button key={action.kind} variant="secondary" disabled={Boolean(realAssetGenerationKey)} onClick={() => onGenerateRealAsset(item, action.kind)}>
              <Icon className="h-4 w-4" />
              {pending ? action.pendingLabel : action.label}
            </Button>
          );
        })}
        {item.actions.canConfirm && <Button onClick={() => onConfirm(item)}>确认使用</Button>}
        {item.actions.canRegenerate && (
          <Button variant="ghost" onClick={() => onRegenerate(item)}>
            调整后重做
          </Button>
        )}
      </div>
    </>
  );
}
