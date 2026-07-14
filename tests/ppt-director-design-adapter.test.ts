import { describe, expect, it } from "vitest";

import { adaptPptDirectorOutputToDesignArtifact } from "@/server/ppt-quality/ppt-director-design-adapter";
import { validPptDirectorOutput } from "./support/ppt-director-output-fixture";

describe("V1-9R5 PPT Director design adapter", () => {
  it("turns a complete ten-page Director result into one structurally valid design candidate", () => {
    const artifact = adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-1",
      structuredOutput: validPptDirectorOutput(),
    });

    expect(artifact).toMatchObject({
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      structuredContent: {
        capabilityId: "ppt_design",
        generationMode: "model_generated",
        providerStatus: "real",
        runtimeKind: "openai",
        directorInvocationId: "ppt-director-1",
        pptDesignPackage: {
          schemaVersion: "ppt-design-package.v1",
          productionPath: "ppt_quality_asset_assembly",
          brief: { targetSlideCount: 10 },
          narrative: { pageCount: 10 },
          pageSpecs: expect.arrayContaining([
            expect.objectContaining({ pageId: "page_01", pageNumber: 1 }),
            expect.objectContaining({ pageId: "page_10", pageNumber: 10 }),
          ]),
        },
      },
    });
    expect((artifact.structuredContent!.pptDesignPackage as { pageSpecs: unknown[] }).pageSpecs).toHaveLength(10);
  });

  it.each([
    ["wrong page number", (output: any) => { output.page_specs[4].page_number = 9; }, "page_number_not_contiguous"],
    ["missing composition layer", (output: any) => { output.page_specs[3].composition.layers.pop(); }, "composition_required_layer_missing"],
    ["missing accessibility semantics", (output: any) => { output.page_specs[2].alt_text = ""; }, "ppt_director_contract_invalid"],
  ])("rejects %s without creating a degraded artifact", (_label, mutate, code) => {
    const output = structuredClone(validPptDirectorOutput());
    mutate(output);

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-invalid",
      structuredOutput: output,
    })).toThrow(code);
  });

  it("keeps the R5 candidate contract separate from the V1-9 production-content gate", () => {
    const output: any = structuredClone(validPptDirectorOutput());
    output.page_specs[0].narrative_job = "推进第 1 个独立学习动作";

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-r5-structural",
      structuredOutput: output,
    })).not.toThrow();
  });

  it("rejects a Director self-check failure instead of filling missing PageSpecs", () => {
    const output: any = structuredClone(validPptDirectorOutput());
    output.self_check.page_numbers_continuous = false;
    output.self_check.violations = ["page_07 missing"];
    output.page_specs.splice(6, 1);

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-self-check-failed",
      structuredOutput: output,
    })).toThrow("ppt_director_self_check_failed");
  });

  it.each(["needs_input", "blocked"])("does not persist a %s Director decision as a design artifact", (decision) => {
    const output: any = structuredClone(validPptDirectorOutput());
    output.decision = decision;

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: `ppt-director-${decision}`,
      structuredOutput: output,
    })).toThrow(`ppt_director_not_actionable:${decision}`);
  });

  it("rejects evidence ids or digests that are not bound by the server invocation", () => {
    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-evidence-mismatch",
      structuredOutput: validPptDirectorOutput(),
      approvedArtifactRefs: [{ artifactId: "different-artifact", digest: "different-digest" }],
    })).toThrow("ppt_director_evidence_binding_invalid");
  });
});
