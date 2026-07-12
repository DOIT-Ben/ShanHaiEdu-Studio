import { describe, expect, it } from "vitest";

import { analyzePptRevisionImpact } from "@/server/ppt-quality/ppt-impact-analysis";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("V1 Stage 3A PPT page-level repair impact", () => {
  it("invalidates only one page for local text or layout changes", () => {
    const result = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "page_text_layout", pageId: "page_06" });

    expect(result).toMatchObject({
      nextAction: "repair_unit",
      invalidatedPageIds: ["page_06"],
      invalidatedAssetIds: [],
      invalidateSampleApproval: false,
      invalidateReports: true,
    });
  });

  it("invalidates one asset, its page, and sample approval when a sampled visual changes", () => {
    const result = analyzePptRevisionImpact(validPptDesignPackage(), {
      kind: "page_asset",
      pageId: "page_05",
      assetId: "asset_page_05",
    });

    expect(result).toMatchObject({
      nextAction: "repair_unit",
      invalidatedPageIds: ["page_05"],
      invalidatedAssetIds: ["asset_page_05"],
      invalidateSampleApproval: true,
    });
  });

  it("limits a narrative transition change to the target and next page", () => {
    const result = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "narrative_transition", pageId: "page_06" });

    expect(result.invalidatedPageIds).toEqual(["page_06", "page_07"]);
    expect(result.nextAction).toBe("repair_unit");
  });

  it("routes objective and evidence changes upstream and invalidates affected downstream approvals", () => {
    const objective = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "objective", objectiveId: "obj_meaning" });
    const evidence = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "evidence", evidenceId: "evidence_textbook" });

    expect(objective).toMatchObject({
      nextAction: "repair_upstream",
      invalidatedPageIds: ["page_01", "page_02", "page_03", "page_04", "page_05", "page_06"],
      invalidateSampleApproval: true,
      invalidateReports: true,
    });
    expect(evidence.nextAction).toBe("repair_upstream");
    expect(evidence.invalidatedPageIds).toHaveLength(12);
  });

  it("produces a stable impact digest for the same semantic revision", () => {
    const first = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "page_text_layout", pageId: "page_06" });
    const second = analyzePptRevisionImpact(validPptDesignPackage(), { kind: "page_text_layout", pageId: "page_06" });

    expect(first.impactDigest).toBe(second.impactDigest);
  });
});
