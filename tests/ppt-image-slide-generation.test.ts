import { describe, expect, it } from "vitest";
import { generatePptImageSlideBundle } from "@/server/ppt-image-slides/ppt-image-slide-generation";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("FrameFlow PPT page image batch", () => {
  it("submits exactly one normalized 16:9 image request per page", async () => {
    const design = validPptDesignPackage();
    const calls: Array<Record<string, unknown>> = [];
    const bundle = await generatePptImageSlideBundle({
      project: project(),
      designArtifact: artifact(design),
      generateImage: async (input) => {
        calls.push(input);
        const fileName = `${String(input.fileStem)}.png`;
        return { fileName, localOutput: `artifact-storage/image-artifacts/${fileName}`, bytes: 2048, sha256: "a".repeat(64), imageValid: true, mime: "image/png", provider: "model_gateway", model: "nanobanana", width: 1920, height: 1080, promptDigest: "b".repeat(64), rawAsset: { fileName, localOutput: `artifact-storage/image-artifacts/raw-${fileName}`, bytes: 2048, sha256: "c".repeat(64), mime: "image/png", width: 1920, height: 1080 }, normalizedAsset: { fileName, localOutput: `artifact-storage/image-artifacts/${fileName}`, bytes: 2048, sha256: "a".repeat(64), mime: "image/png", width: 1920, height: 1080 } };
      },
    });
    expect(calls).toHaveLength(12);
    expect(calls.every((call) => call.aspectRatio === "16:9" && call.normalizeCanvas === true && call.gatewayCapability === "ppt_image")).toBe(true);
    expect(bundle.entries.map((entry) => entry.pageId)).toEqual(design.pageSpecs.map((page) => page.pageId));
    expect(bundle.entries.every((entry) => entry.width === 1920 && entry.height === 1080 && entry.provider === "model_gateway" && entry.model === "nanobanana")).toBe(true);
    expect(bundle.entries.every((entry) => entry.processingChain[0]?.operation === "resize_to_16_9_canvas")).toBe(true);
  });
});

function project(): ProjectRecord {
  return { id: "project-a", title: "百分数", status: "active", grade: "五年级", subject: "数学", textbookVersion: null, lessonTopic: "百分数", lifecycleState: "active", lifecycleVersion: 0, archivedAt: null, deletedAt: null, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" };
}

function artifact(design: ReturnType<typeof validPptDesignPackage>): ArtifactRecord {
  return { id: "design-a", projectId: "project-a", nodeKey: "ppt_design_draft", title: "设计稿", kind: "ppt_design_draft", status: "approved", summary: "已批准", markdownContent: "# 设计稿", structuredContent: { pptDesignPackage: design }, version: 1, isApproved: true, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" };
}
