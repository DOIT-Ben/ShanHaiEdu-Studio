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
    expect(brief).toMatchObject({
      context: { grade: null, subject: null, textbookVersion: null, lessonTopic: null },
      inputArtifactRefs: [],
      qualityTargets: [],
    });
    expect(hasValidTaskBrief(brief)).toBe(true);
    expect(hasValidTaskBrief({ ...brief, goal: "确定" })).toBe(false);
  });

  it("binds normalized task context, frozen input artifacts, and quality targets into the digest", () => {
    const brief = createTaskBrief({
      taskId: "task-context", projectId: "project-context", intentEpoch: 2,
      goal: "依据教材和已有资料制作PPT大纲", requestedOutputs: ["ppt_outline"], constraints: [], excludedOutputs: [],
      context: { grade: " 五年级 ", subject: "数学", textbookVersion: "苏教版", lessonTopic: "百分数" },
      inputArtifactRefs: [{ artifactId: "artifact-a", version: 2, digest: "A".repeat(64) }],
      qualityTargets: ["教材一致", "教材一致", "逐页可审阅"],
      generationIntensity: "standard", sourceMessageId: "message-context",
    });

    expect(brief).toMatchObject({
      context: { grade: "五年级", subject: "数学", textbookVersion: "苏教版", lessonTopic: "百分数" },
      inputArtifactRefs: [{ artifactId: "artifact-a", version: 2, digest: "a".repeat(64) }],
      qualityTargets: ["教材一致", "逐页可审阅"],
    });
    expect(hasValidTaskBrief(brief)).toBe(true);
    expect(hasValidTaskBrief({ ...brief, context: { ...brief.context!, subject: "语文" } })).toBe(false);
    expect(hasValidTaskBrief({ ...brief, inputArtifactRefs: [] })).toBe(false);
    expect(hasValidTaskBrief({ ...brief, qualityTargets: ["只要能打开"] })).toBe(false);
    expect(hasValidTaskBrief({ ...brief, qualityTargets: undefined })).toBe(false);
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

  it("normalizes known legacy output labels but rejects unknown persisted output values", () => {
    const brief = createTaskBrief({
      taskId: "task-canonical", projectId: "project-canonical", intentEpoch: 0,
      goal: "只做PPT大纲", requestedOutputs: ["PPT 大纲"], constraints: [], excludedOutputs: ["ppt"],
      generationIntensity: "standard", sourceMessageId: "message-canonical",
    });
    expect(brief).toMatchObject({ requestedOutputs: ["ppt_outline"], excludedOutputs: ["ppt"] });
    expect(hasValidTaskBrief(brief)).toBe(true);
    expect(() => createTaskBrief({
      taskId: "task-unknown", projectId: "project-canonical", intentEpoch: 0,
      goal: "未知输出", requestedOutputs: ["unknown_output"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: "message-unknown",
    })).toThrow(/unsupported outputs/);
    expect(hasValidTaskBrief({ ...brief, requestedOutputs: ["unknown_output" as never] })).toBe(false);
  });
});
