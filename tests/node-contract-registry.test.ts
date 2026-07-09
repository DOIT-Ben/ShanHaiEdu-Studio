import { describe, expect, it } from "vitest";

import {
  getPublishedNodeContract,
  getPublishedNodeContractByCapabilityId,
  getPublishedNodeContractByWorkflowNodeKey,
  getPublishedNodeContracts,
} from "@/server/contracts/node-contract-registry";

describe("NodeContractRegistry", () => {
  it("loads published ppt_design contract with explicit node and artifact identity", () => {
    const contract = getPublishedNodeContract("ppt_design");

    expect(contract.id).toBe("ppt_design");
    expect(contract.workflowNodeKey).toBe("ppt_design_draft");
    expect(contract.artifactKind).toBe("ppt_design_draft");
    expect(contract.version).toMatch(/^v\d+/);
    expect(contract.forbidden).toContain("不得把设计稿伪装成真实 PPTX 文件");
    expect(contract.qualityGates.length).toBeGreaterThan(0);
  });

  it("publishes the five MVP1 node contracts", () => {
    const ids = getPublishedNodeContracts().map((contract) => contract.id);

    expect(ids).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_design",
      "coze_ppt",
      "final_package",
    ]);
  });

  it("resolves contracts by capability id and workflow node key", () => {
    expect(getPublishedNodeContractByCapabilityId("ppt_design").workflowNodeKey).toBe("ppt_design_draft");
    expect(getPublishedNodeContractByWorkflowNodeKey("ppt_design_draft").id).toBe("ppt_design");

    expect(getPublishedNodeContractByCapabilityId("coze_ppt").artifactKind).toBe("pptx_artifact");
    expect(getPublishedNodeContractByWorkflowNodeKey("pptx_artifact").id).toBe("coze_ppt");

    expect(getPublishedNodeContractByCapabilityId("final_package").artifactKind).toBe("final_delivery");
    expect(getPublishedNodeContractByWorkflowNodeKey("final_delivery").id).toBe("final_package");
  });

  it("throws when the requested contract cannot be found", () => {
    expect(() => getPublishedNodeContract("missing_contract")).toThrow(/Unknown node contract/);
    expect(() => getPublishedNodeContractByCapabilityId("missing_capability")).toThrow(/Unknown capability/);
    expect(() => getPublishedNodeContractByWorkflowNodeKey("missing_node")).toThrow(/Unknown workflow node/);
  });
});
