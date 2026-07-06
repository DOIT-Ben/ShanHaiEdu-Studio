import { describe, expect, it } from "vitest";
import { DeterministicRuntime } from "../../src/server/agent-runtime/deterministic-runtime";
import type { AgentRuntimeInput, AgentRuntimeTask } from "../../src/server/agent-runtime/types";

const forbiddenTeacherTerms = [
  "provider",
  "schema",
  "debug",
  "stack",
  "OPENAI_API_KEY",
  "local path",
  "node_id",
];

const tasks: AgentRuntimeTask[] = [
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "ppt_outline",
  "intro_video_plan",
  "final_delivery_checklist",
];

function makeInput(task: AgentRuntimeTask): AgentRuntimeInput {
  return {
    projectId: "project-100",
    runId: "run-100",
    task,
    userMessage: "请为小学五年级数学百分数公开课生成一套备课材料。",
    projectContext: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      lessonDurationMinutes: 40,
      textbookVersion: "人教版",
      teacherGoal: "公开课展示百分数意义，并配套 PPT 与导入视频方案。",
      requestedOutputs: ["教案", "PPT 大纲", "导入视频方案"],
    },
    approvedArtifacts: [
      {
        nodeKey: "requirement_spec",
        title: "需求规格说明书",
        summary: "已确认公开课主题、年级、时长和交付范围。",
        markdown: "## 项目概述\n五年级数学百分数公开课。",
      },
    ],
  };
}

describe("DeterministicRuntime", () => {
  it.each(tasks)("generates a stable deterministic draft for %s", async (task) => {
    const runtime = new DeterministicRuntime();
    const input = makeInput(task);

    const first = await runtime.run(input);
    const second = await runtime.run(input);

    expect(first).toEqual(second);
    expect(first.status).toBe("succeeded");
    expect(first.run.runtimeKind).toBe("deterministic");
    expect(first.artifactDraft).toMatchObject({
      contentType: "text/markdown",
      generationMode: "deterministic_draft",
      isReadyForTeacherReview: true,
    });
    expect(first.artifactDraft.title.length).toBeGreaterThan(0);
    expect(first.artifactDraft.summary.length).toBeGreaterThan(0);
    expect(first.artifactDraft.markdown.match(/^## /gm)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps teacher-facing text free of engineering terms", async () => {
    const runtime = new DeterministicRuntime();
    const result = await runtime.run(makeInput("lesson_plan"));
    const teacherText = [
      result.assistantMessage.title,
      result.assistantMessage.body,
      result.artifactDraft.summary,
      result.artifactDraft.markdown,
      result.nextSuggestedAction.label,
    ].join("\n");

    for (const term of forbiddenTeacherTerms) {
      expect(teacherText).not.toContain(term);
    }
  });

  it("keeps intro video as an independent hook connected by course anchor", async () => {
    const runtime = new DeterministicRuntime();
    const result = await runtime.run(makeInput("intro_video_plan"));

    expect(result.artifactDraft.markdown).toContain("课程锚点");
    expect(result.artifactDraft.markdown).toContain("不提前讲解百分数定义");
    expect(result.artifactDraft.markdown).toContain("把结论留给课堂探究");
  });
});
