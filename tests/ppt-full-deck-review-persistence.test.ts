import { describe, expect, it } from "vitest";
import { buildPptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { createWorkbenchService } from "@/server/workbench/service";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";

describe("V1 Stage 3C full deck Delivery Critic persistence", () => {
  it("versions a failed review and seals a passing 12-page package before approval", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3C 完整课件审查", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const { candidate, qa, fixtures } = fixture();
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "pptx_artifact",
      kind: "pptx_artifact",
      title: "完整 PPT 交付审查包",
      status: "needs_review",
      summary: "等待逐页审查。",
      markdownContent: "# 完整 PPT 交付审查包",
      structuredContent: {
        pptFullDeckCandidate: candidate,
        pptDesignPackage: fixtures.designPackage,
        pptAssetRequestBatch: fixtures.requestBatch,
        pptAssetManifest: fixtures.manifest,
        pptKeySampleSet: fixtures.sampleSet,
        pptSampleApproval: fixtures.approval,
      },
    });

    const failedQa = qa.map((entry, index) => index === 5 ? { ...entry, readability: "failed" as const, findings: ["正文与背景对比度不足"] } : entry);
    const failed = await service.submitPptFullDeckReview(project.id, artifact.id, { candidateDigest: candidate.candidateDigest, reviewSource: "critic", qa: failedQa });
    expect(failed).toMatchObject({ version: 2, structuredContent: { pptFullDeckReview: { overallStatus: "failed", qa: failedQa } } });
    expect(failed.structuredContent).not.toHaveProperty("pptFullDeckPackage");
    await expect(service.approveArtifact(project.id, failed.id)).rejects.toThrow(/delivery_review_required/);

    const passed = await service.submitPptFullDeckReview(project.id, failed.id, { candidateDigest: candidate.candidateDigest, reviewSource: "teacher", reviewerMessageId: "teacher-full-deck-review", qa });
    expect(passed).toMatchObject({
      version: 3,
      structuredContent: {
        pptFullDeckReview: { overallStatus: "passed", reviewerMessageId: "teacher-full-deck-review" },
        pptFullDeckPackage: { finalEligible: true, packageDigest: expect.any(String) },
      },
    });
    await expect(service.approveArtifact(project.id, passed.id)).resolves.toMatchObject({ status: "approved", isApproved: true });
  });

  it("rejects a stale full-deck candidate digest", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3C 版本冲突", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const { candidate, qa } = fixture();
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "pptx_artifact", kind: "pptx_artifact", title: "完整 PPT", status: "needs_review", summary: "待审", markdownContent: "# 完整 PPT", structuredContent: { pptFullDeckCandidate: candidate },
    });
    await expect(service.submitPptFullDeckReview(project.id, artifact.id, { candidateDigest: "f".repeat(64), reviewSource: "teacher", qa })).rejects.toThrow(/version conflict/);
  });
});

function fixture() {
  const fixtures = validPptFullProductionFixtures();
  const pageIds = fixtures.designPackage.pageSpecs.map((page) => page.pageId);
  const composition = {
    pptxBuffer: Buffer.from("PK full deck"),
    pptxSha256: "a".repeat(64),
    pageEvidence: fixtures.designPackage.pageSpecs.map((page) => ({
      pageId: page.pageId,
      assetIds: fixtures.manifest.entries.filter((entry) => entry.pageIds.includes(page.pageId)).map((entry) => entry.assetId),
      editableTextLayerIds: page.editableText.map((layer) => layer.layerId),
      editableMathLayerIds: page.editableMath.map((layer) => layer.layerId),
      rasterizedExactContent: false as const,
    })),
  };
  const renderEvidence = {
    pptx: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pptx", sha256: "a".repeat(64), bytes: 1000, slideCount: 12 },
    pdf: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pdf", sha256: "b".repeat(64), bytes: 900, pageCount: 12 },
    pageRenders: pageIds.map((pageId, index) => ({ pageId, storageRef: `artifact-storage/ppt-production-artifacts/${pageId}.png`, sha256: (index + 10).toString(16).padStart(2, "0").repeat(32).slice(0, 64) })),
    contactSheet: { storageRef: "artifact-storage/ppt-production-artifacts/contact.png", sha256: "c".repeat(64), pageIds },
  };
  const candidate = buildPptFullDeckCandidate({ ...fixtures, sampleApproval: fixtures.approval, composition, renderEvidence });
  const qa = pageIds.map((pageId) => ({ pageId, design: "passed" as const, visual: "passed" as const, provenance: "passed" as const, readability: "passed" as const, findings: [] as string[] }));
  return { candidate, qa, fixtures };
}
