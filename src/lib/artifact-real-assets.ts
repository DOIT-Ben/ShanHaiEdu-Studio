import type { ArtifactItem } from "@/lib/types";

export type RealAssetKind = "pptx" | "image" | "video";

export type RealAssetGenerationAction = {
  kind: RealAssetKind;
  actionId?: string;
  label: string;
  pendingLabel: string;
  successNotice: string;
  failureNotice: string;
};

export function getRealAssetGenerationActions(item: ArtifactItem): RealAssetGenerationAction[] {
  if (!item.artifactId) return [];

  if (item.nodeKey === "ppt_design_draft" || item.kind === "ppt_design_draft") {
    const actionId = item.routeGenerationActions?.coze_ppt?.actionId;
    if (!actionId) return [];
    return [
      {
        kind: "pptx",
        actionId,
        label: "生成真实 PPTX",
        pendingLabel: "正在生成 PPTX",
        successNotice: "真实 PPTX 已生成，请下载后核对页面内容。",
        failureNotice: "这个 PPT 文件暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  if (item.nodeKey === "ppt_draft" || item.kind === "ppt_draft") {
    const actionId = item.routeGenerationActions?.image_asset?.actionId;
    if (!actionId) return [];
    return [
      {
        kind: "image",
        actionId,
        label: "生成课堂视觉图",
        pendingLabel: "正在生成图片",
        successNotice: "课堂视觉图已生成，请核对画面内容后再用于课件。",
        failureNotice: "课堂视觉图暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  if ((item.nodeKey === "video_segment_plan" || item.kind === "video_segment_plan") && item.status === "approved") {
    const actionId = item.routeGenerationActions?.video_segment_generate?.actionId;
    if (!actionId) return [];
    return [
      {
        kind: "video",
        actionId,
        label: "生成分镜视频",
        pendingLabel: "正在生成分镜视频",
        successNotice: "分镜视频已生成，请核对画面、节奏和课堂锚点。",
        failureNotice: "分镜视频暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  return [];
}
