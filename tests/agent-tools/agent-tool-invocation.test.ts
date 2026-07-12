import { describe, expect, it } from "vitest";

import {
  createAgentToolInvocationEnvelope,
  hasValidAgentToolInvocationEnvelope,
} from "@/server/tools/agent-tool-invocation";

function baseInput() {
  return {
    invocationId: "invocation-a",
    toolId: "ppt_director.plan_or_repair",
    identity: { actorUserId: "teacher-a", actorAuthMode: "password" as const, authSessionId: "session-a" },
    projectId: "project-a",
    intentEpoch: 2,
    sourceMessageId: "message-a",
    approvedArtifactRefs: [{ artifactId: "artifact-a", kind: "pptx_artifact", version: 1, digest: "a".repeat(64) }],
    arguments: { goal: "修复第3页", stage: "page_repair", targetPageIds: ["page_03"], focus: null },
  };
}

describe("V1-2 Agent Tool invocation envelope", () => {
  it("binds tool, actor, project, epoch, message, arguments and artifact versions", () => {
    const envelope = createAgentToolInvocationEnvelope(baseInput());

    expect(envelope.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.actionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(hasValidAgentToolInvocationEnvelope(envelope)).toBe(true);
  });

  it.each([
    ["intentEpoch", 3],
    ["sourceMessageId", "message-b"],
    ["toolId", "video_director.plan_or_repair"],
  ])("detects tampering of %s", (key, value) => {
    const envelope = createAgentToolInvocationEnvelope(baseInput());
    Object.assign(envelope, { [key]: value });

    expect(hasValidAgentToolInvocationEnvelope(envelope)).toBe(false);
  });

  it("detects artifact version tampering", () => {
    const envelope = createAgentToolInvocationEnvelope(baseInput());
    envelope.approvedArtifactRefs[0]!.version = 2;

    expect(hasValidAgentToolInvocationEnvelope(envelope)).toBe(false);
  });

  it("requires a source message for an auditable invocation", () => {
    expect(() => createAgentToolInvocationEnvelope({ ...baseInput(), sourceMessageId: "" })).toThrow(/sourceMessageId/i);
  });
});
