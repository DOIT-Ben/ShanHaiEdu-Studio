import { describe, expect, it } from "vitest";
import { buildPptKeySampleSet } from "@/server/ppt-quality/ppt-key-sample-set-builder";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B key sample set builder", () => {
  it("seals composition, render, overview, and D/V/P evidence into one digest", () => {
    const fixtures = validPptSampleFixtures();
    const sampleSet = buildPptKeySampleSet({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK sample"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha, ...page }) => page),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
      qa: fixtures.sampleSet.qa,
    });

    expect(sampleSet.sampleSetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(sampleSet.assembledPages).toHaveLength(3);
  });

  it("refuses to seal a sample set while visual QA is failed", () => {
    const fixtures = validPptSampleFixtures();
    const qa = fixtures.sampleSet.qa.map((entry, index) => index === 0 ? { ...entry, visual: "failed" as const, findings: ["构图未通过"] } : entry);

    expect(() => buildPptKeySampleSet({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK sample"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha, ...page }) => page),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
      qa,
    })).toThrow(/sample_qa_failed/);
  });
});
