import { describe, expect, it } from "vitest";
import { createPptKeySampleSetDigest, validatePptKeySampleSet, validatePptSampleApproval } from "@/server/ppt-quality/ppt-sample-validator";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B PPT key sample and approval gate", () => {
  it("accepts three distinct overviews, bound assembled pages, and passing D/V/P", () => {
    const fixtures = validPptSampleFixtures();
    expect(validatePptKeySampleSet(fixtures)).toEqual({ valid: true, issues: [] });
    expect(validatePptSampleApproval(fixtures.sampleSet, fixtures.approval)).toEqual({ valid: true, issues: [] });
  });

  it("rejects missing or aliased overview evidence", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.overviews[1] = {
      ...fixtures.sampleSet.overviews[1],
      storageRef: fixtures.sampleSet.overviews[0].storageRef,
      sha256: fixtures.sampleSet.overviews[0].sha256,
    };
    refreshSampleDigest(fixtures.sampleSet);

    expect(validatePptKeySampleSet(fixtures).issues.map((entry) => entry.code)).toContain("sample_overviews_not_distinct");
  });

  it("rejects unregistered assets or rasterized exact content", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.assembledPages[0] = {
      ...fixtures.sampleSet.assembledPages[0],
      assetIds: [...fixtures.sampleSet.assembledPages[0].assetIds, "asset_unknown"],
      rasterizedExactContent: true,
    } as never;
    refreshSampleDigest(fixtures.sampleSet);

    expect(validatePptKeySampleSet(fixtures).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "sample_asset_unbound",
      "sample_exact_content_rasterized",
    ]));
  });

  it("rejects an assembled sample that omits a required page asset", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.assembledPages[0].assetIds = fixtures.sampleSet.assembledPages[0].assetIds.slice(1);
    refreshSampleDigest(fixtures.sampleSet);

    expect(validatePptKeySampleSet(fixtures).issues.map((entry) => entry.code)).toContain("sample_required_assets_missing");
  });

  it("rejects any unresolved D/V/P failure", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.qa[0] = {
      ...fixtures.sampleSet.qa[0],
      visual: "failed",
      findings: ["主体遮挡标题安全区"],
    };
    refreshSampleDigest(fixtures.sampleSet);

    expect(validatePptKeySampleSet(fixtures).issues.map((entry) => entry.code)).toContain("sample_qa_failed");
  });

  it("invalidates approval when the sample digest changes", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.sampleSet.qa[0].findings = ["new finding"];
    refreshSampleDigest(fixtures.sampleSet);

    expect(validatePptSampleApproval(fixtures.sampleSet, fixtures.approval).issues.map((entry) => entry.code)).toContain("sample_approval_stale");
  });

  it("does not treat a vague continuation as sample approval", () => {
    const fixtures = validPptSampleFixtures();
    fixtures.approval.decisionText = "继续";

    expect(validatePptSampleApproval(fixtures.sampleSet, fixtures.approval).issues.map((entry) => entry.code)).toContain("sample_approval_not_explicit");
  });
});

function refreshSampleDigest(sampleSet: ReturnType<typeof validPptSampleFixtures>["sampleSet"]): void {
  const { sampleSetDigest: _digest, ...semantic } = sampleSet;
  sampleSet.sampleSetDigest = createPptKeySampleSetDigest(semantic);
}
