import { describe, expect, it } from "vitest";
import { createHumanGateActionId, isConfirmedHumanGateAction } from "@/server/guards/human-gate";

describe("HumanGate", () => {
  it("creates project-bound action ids and matches them exactly", () => {
    const actionId = createHumanGateActionId({
      projectId: "project-1",
      capabilityId: "coze_ppt",
      messageId: "message-1",
    });

    expect(actionId).toBe("human:project-1:coze_ppt:message-1");
    expect(actionId).toContain("project-1");
    expect(isConfirmedHumanGateAction({ expectedActionId: actionId, receivedActionId: actionId })).toBe(true);
    expect(isConfirmedHumanGateAction({ expectedActionId: actionId, receivedActionId: "human:project-1:coze_ppt:other" })).toBe(false);
  });
});
