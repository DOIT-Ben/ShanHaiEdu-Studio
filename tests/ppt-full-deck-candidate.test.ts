import { describe, expect, it } from "vitest";
import { buildPptFullDeckCandidate, sealPptFullDeckCandidate, validatePptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";

describe("V1 Stage 3C full deck candidate and Delivery Critic gate", () => {
  it("builds an awaiting-review candidate and seals only a clean 12-page review", () => {
    const fixtures = validPptFullProductionFixtures();
    const pageIds = fixtures.designPackage.pageSpecs.map((page) => page.pageId);
    const candidate = buildPptFullDeckCandidate({
      ...fixtures,
      sampleApproval: fixtures.approval,
      composition: composition(fixtures),
      renderEvidence: renderEvidence(pageIds),
    });

    expect(validatePptFullDeckCandidate(candidate)).toBe(true);
    expect(candidate.reviewStatus).toBe("awaiting_delivery_review");
    const result = sealPptFullDeckCandidate(candidate, cleanQa(pageIds));
    expect(result.finalEligible).toBe(true);
    expect(result.packageDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks final eligibility when one page has an unresolved readability finding", () => {
    const fixtures = validPptFullProductionFixtures();
    const pageIds = fixtures.designPackage.pageSpecs.map((page) => page.pageId);
    const candidate = buildPptFullDeckCandidate({ ...fixtures, sampleApproval: fixtures.approval, composition: composition(fixtures), renderEvidence: renderEvidence(pageIds) });
    const qa = cleanQa(pageIds);
    qa[6].readability = "failed";
    qa[6].findings = ["正文与背景对比度不足"];

    expect(() => sealPptFullDeckCandidate(candidate, qa)).toThrow(/qa_failed/);
  });
});

function composition(fixtures: ReturnType<typeof validPptFullProductionFixtures>) {
  return {
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
}

function renderEvidence(pageIds: string[]) {
  return {
    pptx: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pptx", sha256: "a".repeat(64), bytes: 1000, slideCount: pageIds.length },
    pdf: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pdf", sha256: "b".repeat(64), bytes: 900, pageCount: pageIds.length },
    pageRenders: pageIds.map((pageId, index) => ({ pageId, storageRef: `artifact-storage/ppt-production-artifacts/${pageId}.png`, sha256: (index + 10).toString(16).padStart(2, "0").repeat(32).slice(0, 64) })),
    contactSheet: { storageRef: "artifact-storage/ppt-production-artifacts/contact.png", sha256: "c".repeat(64), pageIds },
  };
}

function cleanQa(pageIds: string[]) {
  return pageIds.map((pageId) => ({ pageId, design: "passed" as const, visual: "passed" as const, provenance: "passed" as const, readability: "passed" as "passed" | "failed", findings: [] as string[] }));
}
