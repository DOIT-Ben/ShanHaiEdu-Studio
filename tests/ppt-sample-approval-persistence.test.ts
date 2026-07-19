import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { createPptKeySampleSetDigest } from "@/server/ppt-quality/ppt-sample-validator";
import { createWorkbenchService } from "@/server/workbench/service";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";
import { buildPptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";

describe("V1 Stage 3B sample approval persistence", () => {
  it("versions failed D/V/P findings and seals a later passing review before approval", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3B 样张审查版本", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const fixtures = validPptSampleFixtures();
    const candidate = buildPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK candidate"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map((page) => omitFixtureFields(page, "renderRef", "renderSha256")),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
    });
    const candidateArtifact = await service.saveArtifact(project.id, {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "PPT 关键样张审查包",
      status: "needs_review",
      summary: "等待 D/V/P。",
      markdownContent: "# PPT 关键样张审查包",
      structuredContent: {
        pptDesignPackage: fixtures.designPackage,
        pptAssetRequestBatch: fixtures.requestBatch,
        pptAssetManifest: fixtures.manifest,
        pptKeySampleCandidate: candidate,
      },
    });
    const failedQa = fixtures.sampleSet.qa.map((entry, index) => index === 0
      ? { ...entry, visual: "failed" as const, findings: ["主体遮挡标题"] }
      : entry);
    const failedReview = await service.submitPptSampleReview(project.id, candidateArtifact.id, {
      candidateDigest: candidate.candidateDigest,
      reviewSource: "critic",
      qa: failedQa,
    });

    expect(failedReview).toMatchObject({
      version: 2,
      status: "needs_review",
      structuredContent: { pptKeySampleReview: { overallStatus: "failed", qa: failedQa } },
    });
    expect(failedReview.structuredContent).not.toHaveProperty("pptKeySampleSet");
    await expect(service.approveArtifact(project.id, failedReview.id)).rejects.toThrow(/dvp_review_required/);

    const passingReview = await service.submitPptSampleReview(project.id, failedReview.id, {
      candidateDigest: candidate.candidateDigest,
      reviewSource: "teacher",
      reviewerMessageId: "teacher-review-message",
      qa: fixtures.sampleSet.qa,
    });
    expect(passingReview).toMatchObject({
      version: 3,
      status: "needs_review",
      structuredContent: {
        pptKeySampleReview: { overallStatus: "passed", reviewerMessageId: "teacher-review-message" },
        pptKeySampleSet: { sampleSetDigest: expect.any(String) },
      },
    });
    const approved = await service.approveArtifact(project.id, passingReview.id);
    expect(approved).toMatchObject({ status: "approved", isApproved: true });
  });

  it("refuses direct approval while the assembled candidate still awaits D/V/P review", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3B 待审样张", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const fixtures = validPptSampleFixtures();
    const candidate = buildPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK candidate"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map((page) => omitFixtureFields(page, "renderRef", "renderSha256")),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
    });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "PPT 关键样张待审包",
      status: "needs_review",
      summary: "等待 D/V/P。",
      markdownContent: "# PPT 关键样张待审包",
      structuredContent: { pptKeySampleCandidate: candidate },
    });

    await expect(service.approveArtifact(project.id, artifact.id)).rejects.toThrow(/dvp_review_required/);
  });

  it("binds the artifact approve action to the current sample set digest", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3B 样张批准", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const fixtures = validPptSampleFixtures();
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "PPT 关键样张验收包",
      status: "needs_review",
      summary: "三份总览和正式样张待批准。",
      markdownContent: "# PPT 关键样张验收包",
      structuredContent: {
        pptDesignPackage: fixtures.designPackage,
        pptAssetRequestBatch: fixtures.requestBatch,
        pptAssetManifest: fixtures.manifest,
        pptKeySampleSet: fixtures.sampleSet,
      },
    });

    const approved = await service.approveArtifact(project.id, artifact.id);

    expect(approved).toMatchObject({ status: "approved", isApproved: true });
    expect(approved.structuredContent.pptSampleApproval).toMatchObject({
      decision: "approved",
      decisionSource: "artifact_approve_action",
      sampleSetDigest: fixtures.sampleSet.sampleSetDigest,
      designPackageDigest: fixtures.sampleSet.designPackageDigest,
      approvedAt: expect.any(String),
    });
  });

  it("refuses approval when D/V/P evidence changed after the sample digest was sealed", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3B 失效样张", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.qa[0].visual = "failed";
    fixtures.sampleSet.qa[0].findings = ["视觉遮挡"];
    const semantic = omitFixtureFields(fixtures.sampleSet, "sampleSetDigest");
    fixtures.sampleSet.sampleSetDigest = createPptKeySampleSetDigest(semantic);
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "不合格 PPT 样张",
      status: "needs_review",
      summary: "存在未关闭问题。",
      markdownContent: "# 不合格 PPT 样张",
      structuredContent: {
        pptDesignPackage: fixtures.designPackage,
        pptAssetRequestBatch: fixtures.requestBatch,
        pptAssetManifest: fixtures.manifest,
        pptKeySampleSet: fixtures.sampleSet,
      },
    });

    await expect(service.approveArtifact(project.id, artifact.id)).rejects.toThrow(/sample_qa_failed/);
  });
});
