import { describe, expect, it } from "vitest";

import {
  createExecutionEnvelope,
  createTaskBrief,
  hasValidExecutionEnvelope,
  hasValidTaskBrief,
} from "@/server/conversation/task-contract";

describe("V1-9R1 task contract", () => {
  it("keeps the complete task immutable when a control message is interpreted", () => {
    const brief = createTaskBrief({
      taskId: "task-1", projectId: "project-1", intentEpoch: 3,
      goal: "五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。",
      requestedOutputs: ["PPT"], constraints: ["约 10 页"], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: "message-1",
    });

    expect(brief.goal).toContain("投篮命中率");
    expect(hasValidTaskBrief(brief)).toBe(true);
    expect(hasValidTaskBrief({ ...brief, goal: "确定" })).toBe(false);
  });

  it("signs and validates the complete Tool execution boundary", () => {
    const brief = createTaskBrief({
      taskId: "task-envelope", projectId: "project-envelope", intentEpoch: 4,
      goal: "只做五年级数学百分数独立创意导入视频脚本。",
      requestedOutputs: ["video_script"], constraints: ["唯一最小课程锚点"], excludedOutputs: ["ppt", "video", "package"],
      generationIntensity: "deep", sourceMessageId: "message-envelope",
    });
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const,
      taskId: brief.taskId,
      projectId: brief.projectId,
      intentEpoch: brief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: brief.generationIntensity,
      budgetPolicyVersion: "v1-standard",
      maxCostCredits: null,
      maxExternalProviderCalls: 3,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-envelope",
      taskBrief: brief,
      planRevision: 7,
      intensity: brief.generationIntensity,
      intentGrant,
      action: { toolName: "create_requirement_spec", arguments: { scope: "video_script" } },
    });

    expect(envelope).toMatchObject({
      actorUserId: "teacher-envelope",
      projectId: brief.projectId,
      taskId: brief.taskId,
      taskBriefDigest: brief.digest,
      intentEpoch: brief.intentEpoch,
      planRevision: 7,
      intensity: "deep",
      intentGrant,
      idempotencyKey: expect.any(String),
    });
    expect(hasValidExecutionEnvelope(envelope)).toBe(true);
    expect(hasValidExecutionEnvelope({ ...envelope, planRevision: 8 })).toBe(false);
    expect(hasValidExecutionEnvelope({
      ...envelope,
      intentGrant: { ...envelope.intentGrant, projectId: "other-project" },
    })).toBe(false);
  });
});
