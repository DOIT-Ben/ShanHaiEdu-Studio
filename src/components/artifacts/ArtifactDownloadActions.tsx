"use client";

import { Download } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useArtifactMarkdownDownload } from "@/hooks/useArtifactMarkdownDownload";
import { useArtifactPptxDownload } from "@/hooks/useArtifactPptxDownload";
import { useArtifactRealAssetDownload } from "@/hooks/useArtifactRealAssetDownload";
import { useFinalPackageDownload } from "@/hooks/useFinalPackageDownload";

type ArtifactDownloadActionsProps = {
  projectId: string;
  item: ArtifactItem;
  variant?: "default" | "compact" | "inline";
};

export function ArtifactDownloadActions({ projectId, item, variant = "default" }: ArtifactDownloadActionsProps) {
  const { downloadMarkdown, downloadLabel } = useArtifactMarkdownDownload(item);
  const { canDownloadPptx, downloadPptx, downloadPptxLabel } = useArtifactPptxDownload(projectId, item);
  const imageDownload = useArtifactRealAssetDownload(projectId, item, "image");
  const videoDownload = useArtifactRealAssetDownload(projectId, item, "video");
  const { canDownloadPackage, downloadPackage, downloadPackageLabel } = useFinalPackageDownload(projectId, item);
  const size = variant === "default" ? undefined : "sm";
  const iconClassName = variant === "default" ? "h-4 w-4" : "h-3.5 w-3.5";
  const wrapperClassName = cn("flex flex-wrap gap-2", variant === "inline" && "mt-3");
  const markdownDownloadLabel = downloadLabel || "下载 Markdown";

  return (
    <div className={wrapperClassName} data-artifact-download-actions>
      <Button variant="secondary" size={size} disabled={!item.actions.canCopy} onClick={downloadMarkdown}>
        <Download className={iconClassName} />
        {markdownDownloadLabel}
      </Button>
      {canDownloadPptx && (
        <Button variant="secondary" size={size} onClick={downloadPptx}>
          <Download className={iconClassName} />
          {downloadPptxLabel}
        </Button>
      )}
      {imageDownload.canDownloadRealAsset && (
        <Button variant="secondary" size={size} onClick={imageDownload.downloadRealAsset}>
          <Download className={iconClassName} />
          {imageDownload.downloadRealAssetLabel}
        </Button>
      )}
      {videoDownload.canDownloadRealAsset && (
        <Button variant="secondary" size={size} onClick={videoDownload.downloadRealAsset}>
          <Download className={iconClassName} />
          {videoDownload.downloadRealAssetLabel}
        </Button>
      )}
      {canDownloadPackage && (
        <Button variant="secondary" size={size} onClick={downloadPackage}>
          <Download className={iconClassName} />
          {downloadPackageLabel}
        </Button>
      )}
    </div>
  );
}
