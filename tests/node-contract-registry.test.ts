import { describe, expect, it } from "vitest";

import {
  getPublishedNodeContract,
  getPublishedNodeContractByCapabilityId,
  getPublishedNodeContracts,
} from "@/server/contracts/node-contract-registry";

describe("NodeContractRegistry", () => {
  it("loads published ppt_design contract with an explicit Artifact identity", () => {
    const contract = getPublishedNodeContract("ppt_design");

    expect(contract.id).toBe("ppt_design");
    expect(contract.artifactKind).toBe("ppt_design_draft");
    expect(contract).not.toHaveProperty("workflowNodeKey");
    expect(contract.version).toMatch(/^v\d+/);
    expect(contract.forbidden).toContain("不得把设计稿伪装成真实 PPTX 文件");
    expect(contract.qualityGates.length).toBeGreaterThan(0);
  });

  it("publishes the five MVP1 contracts with their Artifact kinds", () => {
    const identities = getPublishedNodeContracts().map((contract) => [contract.id, contract.artifactKind]);

    expect(identities).toEqual([
      ["requirement_spec", "requirement_spec"],
      ["lesson_plan", "lesson_plan"],
      ["ppt_design", "ppt_design_draft"],
      ["coze_ppt", "pptx_artifact"],
      ["final_package", "final_delivery"],
    ]);
  });

  it("resolves contracts by capability id without a second workflow-node lookup", () => {
    expect(getPublishedNodeContractByCapabilityId("ppt_design").artifactKind).toBe("ppt_design_draft");
    expect(getPublishedNodeContractByCapabilityId("coze_ppt").artifactKind).toBe("pptx_artifact");
    expect(getPublishedNodeContractByCapabilityId("final_package").artifactKind).toBe("final_delivery");
  });

  it("throws when the requested contract cannot be found", () => {
    expect(() => getPublishedNodeContract("missing_contract")).toThrow(/Unknown node contract/);
    expect(() => getPublishedNodeContractByCapabilityId("missing_capability")).toThrow(/Unknown capability/);
  });
});
