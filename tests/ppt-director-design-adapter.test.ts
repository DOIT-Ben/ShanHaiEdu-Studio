import { describe, expect, it } from "vitest";

import { adaptPptDirectorOutputToDesignArtifact } from "@/server/ppt-quality/ppt-director-design-adapter";
import { validPptDirectorOutput } from "./support/ppt-director-output-fixture";
import { createPptDirectorOutputSchema } from "@/server/tools/ppt-director-contract";

describe("V1-9R5 PPT Director design adapter", () => {
  it("keeps model-authored Director evidence semantic and server authority out of the schema", () => {
    const serialized = JSON.stringify(createPptDirectorOutputSchema());
    expect(serialized).toContain("source_artifact_kind");
    expect(serialized).not.toContain("source_artifact_id");
    expect(serialized).not.toContain('"digest"');
  });

  it("turns a complete ten-page Director result into one structurally valid design candidate", () => {
    const artifact = adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-1",
      structuredOutput: validPptDirectorOutput(),
      approvedArtifactRefs: directorAuthorityRefs(),
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
      approvedArtifactRefs: directorAuthorityRefs(),
    })).toThrow(code);
  });

  it("keeps the R5 candidate contract separate from the V1-9 production-content gate", () => {
    const output: any = structuredClone(validPptDirectorOutput());
    output.page_specs[0].narrative_job = "推进第 1 个独立学习动作";

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-r5-structural",
      structuredOutput: output,
      approvedArtifactRefs: directorAuthorityRefs(),
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
      approvedArtifactRefs: directorAuthorityRefs(),
    })).toThrow("ppt_director_self_check_failed");
  });

  it.each(["needs_input", "blocked"])("does not persist a %s Director decision as a design artifact", (decision) => {
    const output: any = structuredClone(validPptDirectorOutput());
    output.decision = decision;

    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: `ppt-director-${decision}`,
      structuredOutput: output,
      approvedArtifactRefs: directorAuthorityRefs(),
    })).toThrow(`ppt_director_not_actionable:${decision}`);
  });

  it("rejects an evidence kind without one authoritative server-bound Artifact", () => {
    expect(() => adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-evidence-mismatch",
      structuredOutput: validPptDirectorOutput(),
      approvedArtifactRefs: [{ artifactId: "different-artifact", kind: "ppt_draft", version: 1, digest: "b".repeat(64) }],
    })).toThrow("ppt_director_evidence_binding_invalid");
  });

  it("projects Director evidence authority from the invocation instead of the model output", () => {
    const artifact = adaptPptDirectorOutputToDesignArtifact({
      invocationId: "ppt-director-authority",
      structuredOutput: validPptDirectorOutput(),
      approvedArtifactRefs: directorAuthorityRefs(),
    });
    expect(artifact.structuredContent?.pptDesignPackage).toMatchObject({
      evidenceBindings: [{
        sourceArtifactId: "artifact-textbook-authoritative",
        sourceArtifactVersion: 7,
        digest: "a".repeat(64),
      }],
    });
  });
});

function directorAuthorityRefs() {
  return [{
    artifactId: "artifact-textbook-authoritative",
    kind: "textbook_evidence",
    version: 7,
    digest: "a".repeat(64),
  }];
}
