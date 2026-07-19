import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { createPptAssetManifestDigest, validatePptAssetManifest } from "@/server/ppt-quality/ppt-asset-validator";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B PPT asset provenance manifest", () => {
  it("accepts a complete provider-backed asset manifest", () => {
    const { manifest, requestBatch } = validPptSampleFixtures();
    expect(validatePptAssetManifest(manifest, requestBatch)).toEqual({ valid: true, issues: [] });
  });

  it("rejects placeholder or locally drawn subject lineage", () => {
    const { manifest, requestBatch } = validPptSampleFixtures();
    manifest.entries[0] = {
      ...manifest.entries[0],
      fileName: "scene-placeholder.png",
      placeholder: true,
      localSubjectDrawn: true,
    } as never;
    refreshDigest(manifest);

    expect(validatePptAssetManifest(manifest, requestBatch).issues.map((entry) => entry.code)).toContain("asset_lineage_forbidden");
  });

  it("rejects missing provider task, file hash, dimensions, or page binding", () => {
    const { manifest, requestBatch } = validPptSampleFixtures();
    manifest.entries[0] = {
      ...manifest.entries[0],
      clientRequestId: "",
      sha256: "bad",
      width: 0,
      pageIds: [],
    };
    refreshDigest(manifest);

    expect(validatePptAssetManifest(manifest, requestBatch).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "asset_page_binding_mismatch",
      "asset_lineage_incomplete",
      "asset_file_evidence_invalid",
    ]));
  });

  it("rejects forbidden processing operations and broken hash chains", () => {
    const { manifest, requestBatch } = validPptSampleFixtures();
    manifest.entries[0].processingChain = [{
      operation: "redraw_subject" as never,
      sourceSha256: "1".repeat(64),
      targetSha256: "2".repeat(64),
    }];
    refreshDigest(manifest);

    expect(validatePptAssetManifest(manifest, requestBatch).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "asset_processing_operation_forbidden",
      "asset_processing_final_hash_mismatch",
    ]));
  });

  it("rejects prompt or request identity drift", () => {
    const { manifest, requestBatch } = validPptSampleFixtures();
    manifest.entries[0].promptDigest = "f".repeat(64);
    manifest.entries[0].inputHash = "e".repeat(64);
    refreshDigest(manifest);

    expect(validatePptAssetManifest(manifest, requestBatch).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "asset_prompt_digest_mismatch",
      "asset_input_hash_mismatch",
    ]));
  });
});

function refreshDigest(manifest: ReturnType<typeof validPptSampleFixtures>["manifest"]): void {
  const semantic = omitFixtureFields(manifest, "manifestDigest");
  manifest.manifestDigest = createPptAssetManifestDigest(semantic);
}
