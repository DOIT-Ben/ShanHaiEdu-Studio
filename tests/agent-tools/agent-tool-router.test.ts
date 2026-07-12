import { describe, expect, it, vi } from "vitest";

import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { routeAgentToolCall } from "@/server/tools/agent-tool-router";
import { createToolObservation } from "@/server/capabilities/tool-observation";

function validEnvelope() {
  return createAgentToolInvocationEnvelope({
    invocationId: "invocation-1",
    toolId: "ppt_director.plan_or_repair",
    identity: {
      actorUserId: "teacher-a",
      actorAuthMode: "password",
      authSessionId: "session-a",
    },
    projectId: "project-a",
    intentEpoch: 3,
    sourceMessageId: "message-a",
    approvedArtifactRefs: [{ artifactId: "artifact-a", kind: "pptx_artifact", version: 2, digest: "a".repeat(64) }],
    arguments: {
      goal: "修复第3页的视觉解释",
      stage: "page_repair",
      targetPageIds: ["page_03"],
      focus: null,
    },
  });
}

describe("V1-2 Agent Tool router", () => {
  it("routes a validated envelope to the injected Agent executor", async () => {
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: "invocation-1",
      structuredOutput: {
        decision: "repair",
        summary: "只返修目标页面。",
        targetLocators: ["page_03"],
        nextToolIntents: ["repair_ppt_full_deck_pages"],
        assumptions: [],
        stopConditions: ["target pages validated"],
      },
      assistantSummary: "建议只返修第3页。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(validEnvelope(), { executor, authorize: async () => true });

    expect(result.status).toBe("succeeded");
    expect(result.artifactCreated).toBe(false);
    expect("artifactDraft" in result).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("resolves a protocol transport name to its canonical Agent Tool", async () => {
    const envelope = createAgentToolInvocationEnvelope({ ...validEnvelope(), toolId: "ppt_director_plan_or_repair" });
    const executor = vi.fn(async (_envelope, tool) => ({
      status: "succeeded" as const,
      toolId: tool.id,
      invocationId: envelope.invocationId,
      structuredOutput: {
        decision: "repair",
        summary: "只返修目标页面。",
        targetLocators: ["page_03"],
        nextToolIntents: ["repair_ppt_full_deck_pages"],
        assumptions: [],
        stopConditions: ["target pages validated"],
      },
      assistantSummary: "建议只返修第3页。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result.status).toBe("succeeded");
    expect(executor.mock.calls[0]![1].id).toBe("ppt_director.plan_or_repair");
  });

  it("preserves a typed inconclusive Agent result", async () => {
    const envelope = validEnvelope();
    const result = await routeAgentToolCall(envelope, {
      authorize: async () => true,
      executor: async () => ({
        status: "inconclusive",
        toolId: "ppt_director.plan_or_repair",
        invocationId: envelope.invocationId,
        observation: createToolObservation({
          projectId: envelope.projectId,
          sourceMessageId: envelope.sourceMessageId,
          capabilityId: envelope.toolId,
          kind: "blocked_by_policy",
          teacherSafeSummary: "证据不足，暂不继续。",
          internalReasonSanitized: "missing_evidence",
          retryPolicy: { retryable: false, nextAction: "ask_teacher" },
        }),
        artifactCreated: false,
      }),
    });

    expect(result.status).toBe("inconclusive");
  });

  it("rejects tampered invocation input before calling the executor", async () => {
    const executor = vi.fn();
    const envelope = validEnvelope();
    envelope.inputHash = "tampered";

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "invocation_integrity_failed", artifactCreated: false });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a non-visible tool and does not fall through to a business adapter", async () => {
    const executor = vi.fn();
    const envelope = { ...validEnvelope(), toolId: "generate_pptx_from_design" };

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_not_allowed", artifactCreated: false });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects unknown model arguments before calling the executor", async () => {
    const executor = vi.fn();
    const envelope = createAgentToolInvocationEnvelope({
      ...validEnvelope(),
      arguments: { ...validEnvelope().arguments, projectId: "forged-project" },
    });

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized actor before calling the executor", async () => {
    const executor = vi.fn();
    const result = await routeAgentToolCall(validEnvelope(), { executor, authorize: async () => false });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_unauthorized" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("blocks a video Director result that fails the independent film gate", async () => {
    const envelope = createAgentToolInvocationEnvelope({
      ...validEnvelope(),
      toolId: "video_director.plan_or_repair",
      arguments: { goal: "设计导入短片", stage: "concept_selection", targetShotIds: [], focus: null },
    });
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "video_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: {
        decision: "plan",
        summary: "课堂活动复述。",
        targetLocators: [],
        nextToolIntents: ["generate_video_shot"],
        assumptions: [],
        stopConditions: [],
        verdict: "pass",
        independentFilmChecks: {
          understandableWithoutLesson: { passed: true, evidence: "可理解" },
          worthwhileWithoutClassroomReturn: { passed: false, evidence: "去掉课堂结尾后没有故事" },
          notTextbookOrPptRetelling: { passed: false, evidence: "复述课件" },
        },
        storyWorld: { premise: "学生在教室完成课堂活动", requiredCharacters: ["教师", "学生"], requiredSettings: ["教室", "黑板"] },
        courseAnchor: { handoffMoment: "课堂开始", classroomReturnQuestion: "你学会了吗？" },
      },
      assistantSummary: "需要重做创意。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_blocked" });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the production Agent executor is unavailable", async () => {
    const result = await routeAgentToolCall(validEnvelope(), { authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_unavailable", artifactCreated: false });
    if (result.status === "succeeded") throw new Error("Expected Agent Tool routing to fail closed.");
    expect(result.observation.retryPolicy).toMatchObject({ retryable: true, nextAction: "retry_later" });
  });
});
