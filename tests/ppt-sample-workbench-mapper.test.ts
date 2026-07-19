import { describe, expect, it } from "vitest";
import { normalizeSnapshot, type BackendSnapshot } from "@/lib/workbench-mappers";

describe("V1 Stage 3B PPT sample workbench mapping", () => {
  it("exposes only review metadata and hides confirmation before the sample set is sealed", () => {
    const snapshot = normalizeSnapshot(backendSnapshot(false));
    const item = snapshot.artifacts[0];

    expect(item.pptSampleReview).toEqual({
      candidateDigest: "candidate-digest",
      pageIds: ["page_02", "page_05", "page_10"],
      overviewKinds: ["scene_and_primary_props", "micro_assets", "assembled_samples"],
      reviewStatus: "awaiting_dvp_review",
    });
    expect(snapshot.project.currentStep).toBe("图片");
    expect(snapshot.activeArtifactKey).toBe("artifact-a");
    expect(item.actions.canConfirm).toBe(false);
    expect(JSON.stringify(item)).not.toContain("storageRef");
  });

  it("enables teacher confirmation after a sealed sample set exists", () => {
    const snapshot = normalizeSnapshot(backendSnapshot(true));
    expect(snapshot.artifacts[0].actions.canConfirm).toBe(true);
  });
});

function backendSnapshot(sealed: boolean): BackendSnapshot {
  const now = "2026-07-12T00:00:00.000Z";
  return {
    project: {
      id: "project-a",
      title: "样张审查",
      status: "active",
      grade: "五年级",
      subject: "数学",
      textbookVersion: "人教版",
      lessonTopic: "百分数",
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
    artifacts: [{
      id: "artifact-a",
      projectId: "project-a",
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "关键样张审查包",
      status: "needs_review",
      summary: "等待审查",
      markdownContent: "# 关键样张",
      structuredContent: {
        pptKeySampleCandidate: {
          candidateDigest: "candidate-digest",
          samplePageIds: ["page_02", "page_05", "page_10"],
          overviews: [
            { kind: "scene_and_primary_props", storageRef: "private/scene.png" },
            { kind: "micro_assets", storageRef: "private/assets.png" },
            { kind: "assembled_samples", storageRef: "private/samples.png" },
          ],
        },
        ...(sealed ? { pptKeySampleSet: { sampleSetDigest: "sample-set-digest" } } : {}),
      },
      version: 1,
      isApproved: false,
      createdAt: now,
      updatedAt: now,
    }],
  };
}
