import type { ArtifactItem } from "@/lib/types";

export type RealAssetKind = "pptx" | "image" | "video";

export type RealAssetGenerationAction = {
  kind: RealAssetKind;
  label: string;
  pendingLabel: string;
  successNotice: string;
  failureNotice: string;
};

export function getRealAssetGenerationActions(item: ArtifactItem): RealAssetGenerationAction[] {
  if (!item.artifactId) return [];

  if (item.nodeKey === "ppt_design_draft" || item.kind === "ppt_design_draft") {
    return [
      {
        kind: "pptx",
        label: "生成真实 PPTX",
        pendingLabel: "正在生成 PPTX",
        successNotice: "真实 PPTX 已生成，请下载后核对页面内容。",
        failureNotice: "这个 PPT 文件暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  if (item.nodeKey === "ppt_draft" || item.kind === "ppt_draft") {
    return [
      {
        kind: "image",
        label: "生成课堂视觉图",
        pendingLabel: "正在生成图片",
        successNotice: "课堂视觉图已生成，请核对画面内容后再用于课件。",
        failureNotice: "课堂视觉图暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  if (item.nodeKey === "intro_video_plan" || item.kind === "intro_video_plan") {
    return [
      {
        kind: "video",
        label: "生成导入视频",
        pendingLabel: "正在生成视频",
        successNotice: "导入视频已生成，请核对画面、节奏和课堂锚点。",
        failureNotice: "导入视频暂时没有生成成功，请稍后再试。",
      },
    ];
  }

  return [];
}
