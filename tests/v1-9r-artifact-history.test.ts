import { describe, expect, it } from "vitest";

import { normalizeSnapshot, type BackendSnapshot } from "@/lib/workbench-mappers";

describe("V1-9R4 historical artifact mapping", () => {
  it("keeps a message-referenced historical version available alongside the latest node version", () => {
    const snapshot = normalizeSnapshot({
      project: { id: "project-1", title: "百分数", status: "active", currentNodeKey: "ppt_draft", grade: null, subject: null, textbookVersion: null, lessonTopic: null, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" },
      nodes: [{ id: "node-ppt", projectId: "project-1", key: "ppt_draft", title: "PPT 大纲", status: "needs_review", order: 1, upstreamNodeKeys: [], approvedArtifactId: null, staleReason: null, updatedAt: "2026-07-14T00:00:00.000Z" }],
      artifacts: [
        { id: "ppt-v1", projectId: "project-1", nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT 大纲 v1", status: "approved", summary: "旧版", markdownContent: "# 旧版", structuredContent: {}, version: 1, isApproved: true, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" },
        { id: "ppt-v2", projectId: "project-1", nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT 大纲 v2", status: "needs_review", summary: "新版", markdownContent: "# 新版", structuredContent: {}, version: 2, isApproved: false, createdAt: "2026-07-14T00:01:00.000Z", updatedAt: "2026-07-14T00:01:00.000Z" },
      ],
      messages: [{ id: "assistant-1", projectId: "project-1", role: "assistant", content: "这是旧版成果。", artifactRefs: ["ppt-v1"], createdAt: "2026-07-14T00:00:00.000Z" }],
    } satisfies BackendSnapshot);

    expect(snapshot.artifacts.map((artifact) => [artifact.artifactId, artifact.version])).toEqual([
      ["ppt-v2", 2],
      ["ppt-v1", 1],
    ]);
    expect(snapshot.messages[0]?.artifactRefs).toEqual(["ppt-v1"]);
  });

  it("restores persisted queued, running, failed, and blocked turn states from a fresh snapshot", () => {
    const base = {
      projectId: "project-1",
      assistantMessageId: null,
      errorMessage: null,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
    };
    const snapshot = normalizeSnapshot({
      project: { id: "project-1", title: "百分数", status: "active", currentNodeKey: "requirement_spec", grade: null, subject: null, textbookVersion: null, lessonTopic: null, createdAt: base.createdAt, updatedAt: base.updatedAt },
      nodes: [],
      artifacts: [],
      messages: ["queued", "running", "failed", "blocked"].map((status, index) => ({
        id: `teacher-${index}`,
        projectId: "project-1",
        role: "teacher" as const,
        content: `任务 ${index}`,
        artifactRefs: [],
        createdAt: base.createdAt,
      })),
      turnJobs: ["queued", "running", "failed", "blocked"].map((status, index) => ({
        ...base,
        id: `turn-${index}`,
        teacherMessageId: `teacher-${index}`,
        status: status as "queued" | "running" | "failed" | "blocked",
        errorMessage: status === "failed" ? "生成失败，请重试。" : null,
      })),
    } satisfies BackendSnapshot);

    expect(snapshot.messages.map((message) => [message.turnStatus, message.turnStatusLabel])).toEqual([
      ["queued", "排队中"],
      ["running", "正在生成"],
      ["failed", "生成失败，可重试"],
      ["blocked", "未达标，需要处理"],
    ]);
  });
});
