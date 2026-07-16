import type { ArtifactItem, ArtifactKind, ArtifactStatus } from "@/lib/types";

export type ArtifactCapabilityGroupId = "lesson" | "ppt" | "image" | "video" | "delivery";

export type ArtifactCapabilityGroup = {
  id: ArtifactCapabilityGroupId;
  label: string;
  items: ArtifactItem[];
  status: ArtifactStatus;
  attentionCount: number;
};

export const artifactCapabilityGroups: ReadonlyArray<{ id: ArtifactCapabilityGroupId; label: string }> = [
  { id: "lesson", label: "教案与教材" },
  { id: "ppt", label: "PPT" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "delivery", label: "最终交付" },
];

const groupByKind: Record<ArtifactKind, ArtifactCapabilityGroupId> = {
  requirement_spec: "lesson",
  textbook_evidence: "lesson",
  lesson_plan: "lesson",
  knowledge_anchor_extract: "video",
  ppt_outline: "ppt",
  ppt_draft: "ppt",
  ppt_design_draft: "ppt",
  pptx_artifact: "ppt",
  image_prompts: "image",
  asset_brief_generate: "image",
  asset_image_generate: "image",
  intro_video_plan: "video",
  video_storyboard: "video",
  creative_theme_generate: "video",
  video_script_generate: "video",
  storyboard_generate: "video",
  video_segment_plan: "video",
  video_segment_generate: "video",
  video_narration_generate: "video",
  concat_only_assemble: "video",
  final_delivery: "delivery",
  final_delivery_checklist: "delivery",
};

const statusPriority: Record<ArtifactStatus, number> = {
  blocked: 5,
  needs_review: 4,
  stale: 4,
  in_progress: 3,
  approved: 2,
  not_started: 1,
};

export function getArtifactCapabilityGroupId(kind: ArtifactKind): ArtifactCapabilityGroupId {
  return groupByKind[kind];
}

export function aggregateArtifactStatus(items: ArtifactItem[]): ArtifactStatus {
  return items.reduce<ArtifactStatus>(
    (highest, item) => (statusPriority[item.status] > statusPriority[highest] ? item.status : highest),
    "not_started",
  );
}

export function needsArtifactAttention(status: ArtifactStatus): boolean {
  return status === "blocked" || status === "needs_review" || status === "stale";
}

export function groupArtifacts(items: ArtifactItem[]): ArtifactCapabilityGroup[] {
  return artifactCapabilityGroups.flatMap((definition) => {
    const groupedItems = items.filter((item) => getArtifactCapabilityGroupId(item.kind) === definition.id);
    if (groupedItems.length === 0) return [];
    return [{
      ...definition,
      items: groupedItems,
      status: aggregateArtifactStatus(groupedItems),
      attentionCount: groupedItems.filter((item) => needsArtifactAttention(item.status)).length,
    }];
  });
}

export function getArtifactGroupActivation(items: ArtifactItem[]): { mode: "direct"; item: ArtifactItem } | { mode: "drawer" } {
  return items.length === 1 ? { mode: "direct", item: items[0] } : { mode: "drawer" };
}
