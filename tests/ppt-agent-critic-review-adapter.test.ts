import { describe, expect, it } from "vitest";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { adaptPptAgentCriticReview } from "@/server/ppt-quality/ppt-agent-critic-review-adapter";
import { buildPptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { ArtifactRecord } from "@/server/workbench/types";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1-6 PPT Agent Critic review adapter", () => {
  it("maps a passing sample review without granting teacher approval", () => {
    const artifact = sampleArtifact();
    const review = adaptPptAgentCriticReview({
      projectId: artifact.projectId,
      intentEpoch: 3,
      artifact,
      envelope: envelope(artifact),
      structuredOutput: { recommendation: "pass", findings: [] },
    });

    expect(review).toMatchObject({
      kind: "sample",
      submission: {
        reviewSource: "critic",
        reviewerMessageId: "message-a",
        qa: expect.arrayContaining([expect.objectContaining({ design: "passed", visual: "passed", provenance: "passed" })]),
      },
    });
    expect(review.submission).not.toHaveProperty("decision");
    expect(review.submission).not.toHaveProperty("isApproved");
  });

  it("maps a page-scoped finding to its quality dimension", () => {
    const artifact = sampleArtifact();
    const pageId = candidateOf(artifact).samplePageIds[0];
    const review = adaptPptAgentCriticReview({
      projectId: artifact.projectId,
      intentEpoch: 3,
      artifact,
      envelope: envelope(artifact),
      structuredOutput: {
        recommendation: "rework_required",
        findings: [{
          locator: { kind: "page", parentArtifactId: artifact.id, pageId },
          dimensionId: "visual",
          minimalFix: "降低底图亮度并恢复标题对比度。",
        }],
      },
    });

    expect(review.submission.qa.find((entry) => entry.pageId === pageId)).toMatchObject({
      visual: "failed",
      design: "passed",
      provenance: "passed",
      findings: ["降低底图亮度并恢复标题对比度。"],
    });
  });

  it("rejects stale bindings, incomplete dimensions, and pages outside the candidate", () => {
    const artifact = sampleArtifact();
    const base = { projectId: artifact.projectId, intentEpoch: 3, artifact };
    expect(() => adaptPptAgentCriticReview({ ...base, projectId: "project-b", envelope: envelope(artifact), structuredOutput: { recommendation: "pass", findings: [] } })).toThrow(/project_binding/);
    expect(() => adaptPptAgentCriticReview({ ...base, envelope: envelope(artifact, { digest: "f".repeat(64) }), structuredOutput: { recommendation: "pass", findings: [] } })).toThrow(/digest_binding/);
    expect(() => adaptPptAgentCriticReview({ ...base, envelope: envelope(artifact), structuredOutput: { recommendation: "rework_required", findings: [{ locator: { kind: "page", parentArtifactId: artifact.id, pageId: "page_99" }, minimalFix: "修复" }] } })).toThrow(/dimension_missing/);
    expect(() => adaptPptAgentCriticReview({ ...base, envelope: envelope(artifact), structuredOutput: { recommendation: "rework_required", findings: [{ locator: { kind: "page", parentArtifactId: artifact.id, pageId: "page_99" }, dimensionId: "design", minimalFix: "修复" }] } })).toThrow(/outside_candidate/);
  });
});

function sampleArtifact(): ArtifactRecord {
  const fixtures = validPptSampleFixtures();
  const candidate = buildPptKeySampleCandidate({
    designPackage: fixtures.designPackage,
    requestBatch: fixtures.requestBatch,
    manifest: fixtures.manifest,
    composition: {
      pptxBuffer: Buffer.from("PK candidate"),
      pptxSha256: fixtures.sampleSet.samplePptx.sha256,
      pageEvidence: fixtures.sampleSet.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha256, ...page }) => page),
    },
    renderEvidence: {
      samplePptx: fixtures.sampleSet.samplePptx,
      pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
      overviews: fixtures.sampleSet.overviews,
    },
  });
  return {
    id: "sample-a", projectId: "project-a", nodeKey: "image_prompts", kind: "image_prompts",
    title: "PPT 关键样张审查包", status: "needs_review", summary: "等待审查。",
    markdownContent: "# PPT 关键样张审查包", structuredContent: { pptKeySampleCandidate: candidate },
    version: 1, isApproved: false, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function candidateOf(artifact: ArtifactRecord) {
  return artifact.structuredContent.pptKeySampleCandidate as ReturnType<typeof buildPptKeySampleCandidate>;
}

function envelope(artifact: ArtifactRecord, targetOverrides: Partial<{ digest: string }> = {}) {
  const digest = hashArtifactDraft({
    nodeKey: artifact.nodeKey, kind: artifact.kind, title: artifact.title, summary: artifact.summary,
    markdownContent: artifact.markdownContent, structuredContent: artifact.structuredContent,
  });
  return createAgentToolInvocationEnvelope({
    invocationId: "invocation-a", toolId: "delivery_critic.review",
    identity: { actorUserId: "user-a", actorAuthMode: "local", authSessionId: null },
    projectId: artifact.projectId, intentEpoch: 3, sourceMessageId: "message-a",
    reviewTargetRef: { artifactId: artifact.id, kind: artifact.kind, version: artifact.version, digest, ...targetOverrides },
    approvedArtifactRefs: [], arguments: { domain: "ppt", stage: "ppt_sample_review" },
  });
}
