import { describe, expect, it } from "vitest";
import { FixtureAgentRuntime } from "../helpers/fixture-agent-runtime";
import type { AgentRuntime, AgentRuntimeInput } from "../../src/server/agent-runtime/types";
import { expectSucceeded } from "./test-helpers";

function input(): AgentRuntimeInput {
  return {
    projectId: "project-contract",
    runId: "run-contract",
    task: "requirement_spec",
    userMessage: "我想做一节小学数学百分数公开课。",
    projectContext: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      lessonDurationMinutes: 40,
      textbookVersion: "人教版",
      teacherGoal: "完成公开课备课文本链路。",
      requestedOutputs: ["需求规格", "教案", "PPT 大纲", "导入视频方案"],
    },
    approvedArtifacts: [],
  };
}

async function runRuntime(runtime: AgentRuntime) {
  return runtime.run(input());
}

describe("AgentRuntime contract", () => {
  it("returns assistant message, artifact draft, next action and run metadata", async () => {
    const result = expectSucceeded(await runRuntime(new FixtureAgentRuntime()));

    expect(result.status).toBe("succeeded");
    expect(result.assistantMessage).toEqual({
      title: expect.any(String),
      body: expect.any(String),
    });
    expect(result.artifactDraft).toEqual({
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: expect.any(String),
      summary: expect.any(String),
      markdown: expect.stringContaining("##"),
      contentType: "text/markdown",
      generationMode: "model_generated",
      isReadyForTeacherReview: true,
    });
    expect(result.nextSuggestedAction).toEqual({
      type: "review_artifact",
      label: expect.any(String),
    });
    expect(result.run).toEqual({
      runId: "run-contract",
      projectId: "project-contract",
      task: "requirement_spec",
      runtimeKind: "openai",
      status: "succeeded",
    });
  });
});
