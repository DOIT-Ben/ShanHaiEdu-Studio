import { describe, expect, it } from "vitest";

import { buildSemanticContextSnapshot, restoreSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";

describe("semantic context snapshot", () => {
  it("preserves early task semantics after more than eight later turns", () => {
    const snapshot = buildSemanticContextSnapshot({
      taskBrief: {
        taskId: "task-1",
        projectId: "project-1",
        intentEpoch: 4,
        goal: "制作五年级百分数公开课",
        requestedOutputs: ["lesson_plan", "ppt_outline"],
        constraints: ["约10页", "使用投篮命中率情境"],
        excludedOutputs: ["video"],
        generationIntensity: "standard",
        sourceMessageId: "message-1",
        digest: "a".repeat(64),
        schemaVersion: "task-brief.v1",
      },
      plan: { planId: "plan-1", revision: 7, status: "active" },
      pendingDecision: null,
      trustedArtifactRefs: [{
        artifactId: "artifact-1",
        kind: "lesson_plan",
        version: 2,
        digest: "b".repeat(64),
        taskId: "task-1",
        taskBriefDigest: "a".repeat(64),
        intentEpoch: 4,
        bindingSource: "tool_execution",
      }],
      observationRefs: [{ observationId: "obs-9", reasonCodes: ["timeout"] }],
      recentMessages: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "teacher", content: `later-${index}` })),
    });

    const restored = restoreSemanticContextSnapshot(snapshot);
    expect(restored.taskBrief.goal).toContain("百分数");
    expect(restored.taskBrief.constraints).toContain("约10页");
    expect(restored.taskBrief.excludedOutputs).toEqual(["video"]);
    expect(restored.plan.revision).toBe(7);
    expect(restored.trustedArtifactRefs[0]?.artifactId).toBe("artifact-1");
  });
});
