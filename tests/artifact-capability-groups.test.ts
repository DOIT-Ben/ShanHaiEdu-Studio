import { describe, expect, it } from "vitest";
import type { ArtifactItem, ArtifactKind, ArtifactStatus } from "@/lib/types";
import {
  aggregateArtifactStatus,
  artifactCapabilityGroups,
  getArtifactCapabilityGroupId,
  getArtifactGroupActivation,
  groupArtifacts,
} from "@/components/artifacts/artifact-capability-groups";

const allKinds: ArtifactKind[] = [
  "requirement_spec", "textbook_evidence", "lesson_plan", "ppt_outline", "intro_video_plan",
  "ppt_draft", "ppt_design_draft", "pptx_artifact", "image_prompts", "video_storyboard",
  "knowledge_anchor_extract", "creative_theme_generate", "video_script_generate", "storyboard_generate",
  "asset_brief_generate", "asset_image_generate", "video_segment_plan", "video_segment_generate",
  "video_narration_generate", "concat_only_assemble", "final_delivery", "final_delivery_checklist",
];

function artifact(kind: ArtifactKind, status: ArtifactStatus = "approved", index = 0): ArtifactItem {
  return {
    key: `${kind}-${index}`,
    kind,
    title: kind,
    status,
    summary: "摘要",
    updatedAt: "刚刚",
    reusable: true,
    sourceTitles: [],
    previewFields: [],
    actions: { canCopy: true, canUseAsInput: true, canOpenDetail: true, canConfirm: false, canRegenerate: false },
    content: {},
  };
}

describe("artifact capability groups", () => {
  it("maps every ArtifactKind into exactly one of five semantic groups", () => {
    const validIds = artifactCapabilityGroups.map((group) => group.id);
    expect(artifactCapabilityGroups).toHaveLength(5);
    expect(allKinds).toHaveLength(22);
    expect(allKinds.map(getArtifactCapabilityGroupId).every((id) => validIds.includes(id))).toBe(true);
    expect(new Set(allKinds.map((kind) => `${kind}:${getArtifactCapabilityGroupId(kind)}`)).size).toBe(allKinds.length);
  });

  it("keeps group order stable, omits empty groups, and caps rail entries at six with All", () => {
    const groups = groupArtifacts(allKinds.map((kind, index) => artifact(kind, "approved", index)));
    expect(groups.map((group) => group.id)).toEqual(["lesson", "ppt", "image", "video", "delivery"]);
    expect(groups.length + 1).toBeLessThanOrEqual(6);
    expect(groupArtifacts([artifact("lesson_plan")]).map((group) => group.id)).toEqual(["lesson"]);
  });

  it("aggregates the status requiring the most attention", () => {
    expect(aggregateArtifactStatus([artifact("lesson_plan", "approved"), artifact("ppt_outline", "blocked")])).toBe("blocked");
    expect(aggregateArtifactStatus([artifact("lesson_plan", "in_progress"), artifact("ppt_outline", "stale")])).toBe("stale");
    expect(aggregateArtifactStatus([artifact("lesson_plan", "approved"), artifact("ppt_outline", "needs_review")])).toBe("needs_review");
    expect(aggregateArtifactStatus([artifact("lesson_plan", "not_started"), artifact("ppt_outline", "in_progress")])).toBe("in_progress");
    expect(aggregateArtifactStatus([artifact("lesson_plan", "not_started"), artifact("ppt_outline", "approved")])).toBe("approved");
  });

  it("opens a single artifact directly and sends multiple artifacts to a drawer", () => {
    const only = artifact("lesson_plan");
    expect(getArtifactGroupActivation([only])).toEqual({ mode: "direct", item: only });
    expect(getArtifactGroupActivation([only, artifact("textbook_evidence")])).toEqual({ mode: "drawer" });
  });
});
