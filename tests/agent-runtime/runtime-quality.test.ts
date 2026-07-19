import { describe, expect, it } from "vitest";
import { FixtureAgentRuntime } from "../helpers/fixture-agent-runtime";
import { buildOpenAIResponseRequest } from "../../src/server/agent-runtime/openai-runtime";
import type { AgentRuntimeInput, AgentRuntimeTask } from "../../src/server/agent-runtime/types";
import { expectSucceeded } from "./test-helpers";

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
    projectId: "project-quality",
    runId: "run-quality",
    task,
    userMessage: "请为小学五年级数学百分数公开课生成完整备课文本链路。",
    projectContext: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      lessonDurationMinutes: 40,
      textbookVersion: "人教版",
      teacherGoal: "完成可检查、可复用、可确认的公开课材料。",
      requestedOutputs: ["需求规格", "教材证据", "教案", "PPT 大纲", "导入视频方案", "最终交付清单"],
    },
    approvedArtifacts: [],
  };
}

describe("runtime output quality", () => {
  it.each(tasks)("adds a teacher-review checklist for %s", async (task) => {
    const result = expectSucceeded(await new FixtureAgentRuntime().run(makeInput(task)));

    expect(result.status).toBe("succeeded");
    expect(result.artifactDraft.markdown).toContain("## 自检清单");
  });

  it("includes required lesson-plan fields", async () => {
    const result = expectSucceeded(await new FixtureAgentRuntime().run(makeInput("lesson_plan")));

    expect(result.status).toBe("succeeded");
    expect(result.artifactDraft.markdown).toContain("教学重点");
    expect(result.artifactDraft.markdown).toContain("教学难点");
    expect(result.artifactDraft.markdown).toContain("学生活动");
    expect(result.artifactDraft.markdown).toContain("课堂总结");
  });

  it("includes required PPT outline fields", async () => {
    const result = expectSucceeded(await new FixtureAgentRuntime().run(makeInput("ppt_outline")));

    expect(result.status).toBe("succeeded");
    expect(result.artifactDraft.markdown).toContain("建议页数");
    expect(result.artifactDraft.markdown).toContain("逐页脚本");
    expect(result.artifactDraft.markdown).toContain("主视觉需求");
  });

  it("includes intro-video fields without pretending to make a finished video", async () => {
    const result = expectSucceeded(await new FixtureAgentRuntime().run(makeInput("intro_video_plan")));

    expect(result.status).toBe("succeeded");
    expect(result.artifactDraft.markdown).toContain("课程锚点");
    expect(result.artifactDraft.markdown).toContain("课堂落点问题");
    expect(result.artifactDraft.markdown).toContain("分镜摘要");
    expect(result.artifactDraft.markdown).toContain("旁白建议");
    expect(result.artifactDraft.markdown).not.toContain("视频成片已生成");
  });

  it("keeps final delivery honest about unfinished files", async () => {
    const result = expectSucceeded(await new FixtureAgentRuntime().run(makeInput("final_delivery_checklist")));

    expect(result.status).toBe("succeeded");
    expect(result.artifactDraft.markdown).toContain("PPTX");
    expect(result.artifactDraft.markdown).toContain("图片文件");
    expect(result.artifactDraft.markdown).toContain("视频成片");
    expect(result.artifactDraft.markdown).toContain("不得标记为已完成");
  });

  it("sends task-level guidance to OpenAI runtime requests", () => {
    const request = buildOpenAIResponseRequest(makeInput("lesson_plan"));
    const payload = JSON.stringify(request);

    expect(payload).toContain("自检清单");
    expect(payload).toContain("教学重点");
    expect(payload).toContain("教学难点");
    expect(payload).toContain("教师讲稿要点");
  });
});
