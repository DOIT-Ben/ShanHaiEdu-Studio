import { describe, expect, it } from "vitest";

import {
  answerDialogueCheckpoint,
  createDialogueCheckpoint,
  isDialogueCheckpoint,
} from "@/server/conversation/dialogue-checkpoint";

describe("DialogueCheckpoint", () => {
  it("keeps semantic collaboration separate from authorization and binds the answer to one frozen task", () => {
    const pending = createDialogueCheckpoint({
      projectId: "project-a",
      taskId: "task-a",
      intentEpoch: 3,
      planRevision: 4,
      sourceMessageId: "message-a",
      question: "这份课件更偏向概念理解还是解题训练？",
      understandingSummary: "当前目标是制作认识百分数的数学课件。",
      impactSummary: "不同侧重会改变例题比例和页面结构。",
      options: [
        { id: "concept", label: "概念理解", description: "强调意义建构", recommended: true },
        { id: "practice", label: "解题训练", description: "强调题型练习", recommended: false },
      ],
      allowFreeText: true,
    });

    expect(pending).toMatchObject({
      schemaVersion: "dialogue-checkpoint.v1",
      status: "pending",
      kind: "semantic_boundary",
      projectId: "project-a",
      taskId: "task-a",
      intentEpoch: 3,
      planRevision: 4,
    });
    expect(JSON.stringify(pending)).not.toMatch(/authorization|budget|permission|human.?gate/i);
    expect(isDialogueCheckpoint(pending)).toBe(true);

    const answered = answerDialogueCheckpoint(pending, {
      responseMessageId: "message-b",
      responseText: "以概念理解为主，保留两页练习。",
    });
    expect(answered).toMatchObject({
      status: "answered",
      responseMessageId: "message-b",
      responseText: "以概念理解为主，保留两页练习。",
      projectId: pending.projectId,
      taskId: pending.taskId,
      intentEpoch: pending.intentEpoch,
      planRevision: pending.planRevision,
    });
  });
});
