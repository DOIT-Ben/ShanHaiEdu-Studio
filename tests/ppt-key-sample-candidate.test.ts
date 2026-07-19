import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import {
  buildPptKeySampleCandidate,
  sealPptKeySampleCandidate,
  validatePptKeySampleCandidate,
} from "@/server/ppt-quality/ppt-key-sample-candidate";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B key sample review candidate", () => {
  it("seals real composition and render evidence without self-approving D/V/P", () => {
    const fixtures = validPptSampleFixtures();
    const candidate = candidateFromFixtures(fixtures);

    expect(validatePptKeySampleCandidate(candidate)).toBe(true);
    expect(candidate).toMatchObject({
      reviewStatus: "awaiting_dvp_review",
      samplePageIds: fixtures.designPackage.samplePlan.samplePageIds,
    });
    expect(candidate).not.toHaveProperty("qa");
  });

  it("rejects candidate evidence changed after the digest was sealed", () => {
    const fixtures = validPptSampleFixtures();
    const candidate = candidateFromFixtures(fixtures);
    candidate.assembledPages[0].renderRef = "tampered/page.png";

    expect(validatePptKeySampleCandidate(candidate)).toBe(false);
  });

  it("creates an approvable sample set only after explicit passing D/V/P evidence", () => {
    const fixtures = validPptSampleFixtures();
    const candidate = candidateFromFixtures(fixtures);
    const sampleSet = sealPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      candidate,
      qa: fixtures.sampleSet.qa,
    });

    expect(sampleSet.sampleSetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(sampleSet.qa.every((entry) => entry.design === "passed" && entry.visual === "passed" && entry.provenance === "passed")).toBe(true);
  });

  it("does not seal the candidate while any visual review fails", () => {
    const fixtures = validPptSampleFixtures();
    const candidate = candidateFromFixtures(fixtures);
    const qa = fixtures.sampleSet.qa.map((entry, index) => index === 0
      ? { ...entry, visual: "failed" as const, findings: ["主体遮挡标题"] }
      : entry);

    expect(() => sealPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      candidate,
      qa,
    })).toThrow(/sample_qa_failed/);
  });
});

function candidateFromFixtures(fixtures: ReturnType<typeof validPptSampleFixtures>) {
  return buildPptKeySampleCandidate({
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
}
