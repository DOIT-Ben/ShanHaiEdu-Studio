"use client";

import { Clipboard, Download, Eye, FileDown, Image as ImageIcon, SendToBack, Video } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { getRealAssetGenerationActions, type RealAssetKind } from "@/lib/artifact-real-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function PreviewThumb({ label }: { label: string }) {
  return (
    <div>
      <div className="aspect-[4/3] rounded-lg border bg-muted" />
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

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
      <SheetContent className="max-w-[520px]">
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
      <div className="border-b px-5 py-5">
        <div className="flex items-start justify-between gap-4 pr-8">
          <div>
            <SheetTitle className="title-md">{item.title}</SheetTitle>
            <SheetDescription className="mt-2 text-sm leading-6 text-muted-foreground">{item.summary}</SheetDescription>
          </div>
          <Badge tone={item.status === "blocked" ? "danger" : "neutral"}>{item.status === "blocked" ? "需处理" : item.status === "needs_review" ? "待确认" : "已保存"}</Badge>
        </div>
        <div className="mt-5 flex gap-5 border-b text-sm">
          {["摘要", "来源对话", "页面脚本", "图片", "提示词"].map((tab, index) => (
            <button key={tab} type="button" className={index === 0 ? "border-b-2 border-foreground pb-2 font-medium text-foreground" : "pb-2 text-muted-foreground"}>
              {tab}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-5">
          <section>
            <h3 className="mb-3 text-sm font-medium">生成来源</h3>
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
              <h3 className="text-sm font-medium">缩略预览</h3>
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
            <h3 className="mb-3 text-sm font-medium">可复用内容</h3>
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
