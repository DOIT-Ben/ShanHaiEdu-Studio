import { describe, expect, it, vi } from "vitest";

import { createToolObservation } from "@/server/capabilities/tool-observation";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { routeAgentToolCall } from "@/server/tools/agent-tool-router";
import { isAgentToolResultEligibleForProductionGuard } from "@/server/tools/agent-tool-types";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { videoFinalReviewHardGateIds } from "@/server/tools/video-final-review-gate";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";

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
    reviewTargetRef: null,
    approvedArtifactRefs: [{ artifactId: "artifact-a", kind: "pptx_artifact", version: 2, digest: "a".repeat(64) }],
    arguments: {
      goal: "修复第3页的视觉解释",
      stage: "page_repair",
      targetPageIds: ["page_03"],
      focus: null,
    },
  });
}

function videoDirectorOutput(overrides: Record<string, unknown> = {}) {
  return {
    decision: "plan",
    summary: "独立故事候选。",
    targetLocators: [],
    nextToolIntents: ["delivery_critic.review", "generate_video_shot"],
    assumptions: [],
    stopConditions: [],
    verdict: "pass",
    independentFilmChecks: {
      understandableWithoutLesson: { passed: true, evidence: "可理解" },
      worthwhileWithoutClassroomReturn: { passed: true, evidence: "独立故事成立" },
      notTextbookOrPptRetelling: { passed: true, evidence: "不是课件复述" },
    },
    storyWorld: {
      premise: "无人分拣站的机械臂追踪失控标签。",
      requiredCharacters: ["机械臂"],
      requiredSettings: ["无人分拣站"],
    },
    courseAnchor: {
      anchorTrigger: "系统无法判断每组数量。",
      handoffMoment: "系统在数量问题上停摆。",
      classroomReturnQuestion: "怎样弄清每组有几个？",
      doNotExplain: ["不显示答案"],
      anchorCount: 1,
    },
    ...overrides,
  };
}

function videoCriticEnvelope() {
  return createAgentToolInvocationEnvelope({
    ...validEnvelope(),
    invocationId: "critic-invocation-1",
    toolId: "delivery_critic.review",
    reviewTargetRef: { artifactId: "creative-anchor-a", kind: "creative_theme_generate", version: 2, digest: "c".repeat(64) },
    arguments: {
      domain: "video",
      stage: "course_anchor",
      targetLocators: [{ kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" }],
      reviewFocus: "独立创意与最小课程回接",
      courseAnchorRef: { artifactId: "creative-anchor-a", version: 2, digest: "c".repeat(64) },
      rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
      generatorInvocationId: "generator-invocation-1",
    },
  });
}

function pptCriticEnvelope() {
  return createAgentToolInvocationEnvelope({
    ...validEnvelope(),
    invocationId: "ppt-critic-invocation-1",
    toolId: "delivery_critic.review",
    reviewTargetRef: { artifactId: "artifact-a", kind: "pptx_artifact", version: 2, digest: "a".repeat(64) },
    arguments: {
      domain: "ppt",
      stage: "page_review",
      targetLocators: [{ kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-a" }],
      reviewFocus: "逐页教学作用与视觉表达",
      courseAnchorRef: null,
      rubricRef: null,
      generatorInvocationId: null,
    },
  });
}

function videoCriticOutput(overrides: Record<string, unknown> = {}) {
  return {
    recommendation: "pass",
    summary: "课程锚点审查通过。",
    findings: [],
    targetLocators: [{ kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" }],
    responsibleStage: "video_concept_selection",
    minimalFix: "无需返修。",
    inconclusiveReasons: [],
    hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({
      gateId,
      status: "passed",
      evidenceRefs: [`evidence:${gateId}`],
      rationale: "证据充分。",
      findingIds: [],
    })),
    ...overrides,
  };
}

function videoFinalCriticEnvelope() {
  return createAgentToolInvocationEnvelope({
    ...validEnvelope(), invocationId: "video-final-critic-1", toolId: "delivery_critic.review",
    reviewTargetRef: { artifactId: "final-video-a", kind: "concat_only_assemble", version: 3, digest: "d".repeat(64) },
    arguments: {
      domain: "video", stage: "video_final_review",
      targetLocators: [{ kind: "artifact", artifactKind: "concat_only_assemble", artifactId: "final-video-a" }],
      reviewFocus: "成片创意、锚点、连续性和音字证据", courseAnchorRef: null,
      rubricRef: { id: "video-final", version: "v1", digest: "e".repeat(64) },
      generatorInvocationId: "video-generator-1",
    },
  });
}

function videoFinalCriticOutput(overrides: Record<string, unknown> = {}) {
  return {
    recommendation: "pass", summary: "成片审查通过。", findings: [],
    targetLocators: [{ kind: "artifact", artifactKind: "concat_only_assemble", artifactId: "final-video-a" }],
    responsibleStage: "video_timeline_assembly", minimalFix: "无需返修。", inconclusiveReasons: [],
    hardGateResults: videoFinalReviewHardGateIds.map((gateId) => ({ gateId, status: "passed", evidenceRefs: [`evidence:${gateId}`], rationale: "证据充分。", findingIds: [] })),
    ...overrides,
  };
}

function pptCriticOutput(overrides: Record<string, unknown> = {}) {
  return {
    recommendation: "pass",
    summary: "课件审查通过。",
    findings: [],
    targetLocators: [{ kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-a" }],
    responsibleStage: "ppt_page_design",
    minimalFix: "无需返修。",
    inconclusiveReasons: [],
    hardGateResults: [],
    ...overrides,
  };
}

describe("V1-2 Agent Tool router", () => {
  it("routes a validated envelope to the injected Agent executor", async () => {
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: "invocation-1",
      structuredOutput: { ...validPptDirectorOutput(), decision: "repair", targetLocators: ["page_03"] },
      assistantSummary: "建议只返修第3页。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(validEnvelope(), { executor, authorize: async () => true });

    expect(result.status).toBe("succeeded");
    expect(result.artifactCreated).toBe(false);
    expect("artifactDraft" in result).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    "qualityDecision",
    "teacherApproved",
    "humanGateApproval",
  ])("rejects an Executor result that forges the Router-owned %s field", async (forgedField) => {
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: "invocation-1",
      structuredOutput: { ...validPptDirectorOutput(), decision: "repair", targetLocators: ["page_03"] },
      assistantSummary: "建议只返修第3页。",
      artifactCreated: false as const,
      [forgedField]: { outcome: "pass" },
    }));

    const result = await routeAgentToolCall(validEnvelope(), {
      executor: executor as any,
      authorize: async () => true,
    });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_execution_failed" });
  });

  it("rejects unknown top-level fields on a non-success Executor result", async () => {
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
        qualityDecision: { outcome: "pass" },
      } as any),
    });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_execution_failed" });
  });

  it("resolves a protocol transport name to its canonical Agent Tool", async () => {
    const envelope = createAgentToolInvocationEnvelope({ ...validEnvelope(), toolId: "ppt_director_plan_or_repair" });
    const executor = vi.fn(async (_envelope, tool) => ({
      status: "succeeded" as const,
      toolId: tool.id,
      invocationId: envelope.invocationId,
      structuredOutput: { ...validPptDirectorOutput(), decision: "repair", targetLocators: ["page_03"] },
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

  it("keeps Director output structured but strips real-media intents pending independent Critic review", async () => {
    const envelope = createAgentToolInvocationEnvelope({
      ...validEnvelope(),
      toolId: "video_director.plan_or_repair",
      arguments: { goal: "设计导入短片", stage: "concept_selection", targetShotIds: [], focus: null },
    });
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "video_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoDirectorOutput({
        nextToolIntents: [
          "delivery_critic.review",
          "generate_video_shot",
          "generate_ppt_sample_assets",
          "generate_ppt_full_assets",
          "future_side_effect_tool",
        ],
      }),
      assistantSummary: "候选等待独立审查。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({
      status: "succeeded",
      policyOutcome: {
        gateId: "video_director_candidate",
        passed: true,
        eligibleForDownstreamGuard: false,
        reviewOutcome: "candidate_ready_for_critic",
        reasonCodes: expect.arrayContaining(["independent_critic_required"]),
      },
      structuredOutput: {
        verdict: "pass",
        nextToolIntents: ["delivery_critic.review"],
      },
    });
  });

  it("preserves Director rework data instead of replacing it with a generic failed Observation", async () => {
    const envelope = createAgentToolInvocationEnvelope({
      ...validEnvelope(),
      toolId: "video_director.plan_or_repair",
      arguments: { goal: "设计导入短片", stage: "concept_selection", targetShotIds: [], focus: null },
    });
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "video_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoDirectorOutput({
        summary: "课堂活动复述，需要回到独立创意。",
        independentFilmChecks: {
          understandableWithoutLesson: { passed: true, evidence: "可理解" },
          worthwhileWithoutClassroomReturn: { passed: false, evidence: "没有独立故事" },
          notTextbookOrPptRetelling: { passed: false, evidence: "复述课件" },
        },
      }),
      assistantSummary: "需要重做创意。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({
      status: "succeeded",
      policyOutcome: {
        gateId: "video_director_candidate",
        passed: false,
        eligibleForDownstreamGuard: false,
        reviewOutcome: "rework_required",
      },
      structuredOutput: {
        verdict: "rework_required",
        summary: "课堂活动复述，需要回到独立创意。",
        nextToolIntents: ["delivery_critic.review"],
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("lets only the independent Critic six-gate pass satisfy a later downstream Guard prerequisite", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput(),
      assistantSummary: "独立审查通过。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({
      status: "succeeded",
      policyOutcome: {
        gateId: "video_course_anchor_critic",
        passed: true,
        eligibleForDownstreamGuard: true,
        reviewOutcome: "eligible_for_downstream_guard",
        reasonCodes: [],
        reviewBinding: {
          projectId: "project-a",
          intentEpoch: 3,
          sourceMessageId: "message-a",
          invocationId: "critic-invocation-1",
          agentProfileId: "delivery_critic",
          executorSource: "unverified_injected",
          productionEligible: false,
          reviewTargetRef: {
            artifactId: "creative-anchor-a",
            kind: "creative_theme_generate",
            version: 2,
            digest: "c".repeat(64),
          },
          rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
          generatorInvocationId: "generator-invocation-1",
          inputHash: envelope.inputHash,
          actionDigest: envelope.actionDigest,
        },
      },
      structuredOutput: { recommendation: "pass", responsibleStage: "video_concept_selection" },
    });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it("applies the final-video hard gates before final delivery can continue", async () => {
    const envelope = videoFinalCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const, toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId, structuredOutput: videoFinalCriticOutput(),
      assistantSummary: "成片审查通过。", artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({
      status: "succeeded",
      policyOutcome: {
        gateId: "video_final_critic", passed: true, eligibleForDownstreamGuard: true,
        reviewOutcome: "eligible_for_downstream_guard",
        reviewBinding: { reviewTargetRef: { artifactId: "final-video-a", kind: "concat_only_assemble" } },
      },
    });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it("preserves Critic repair locators and minimal fix when a hard gate blocks media", async () => {
    const envelope = videoCriticEnvelope();
    const base = videoCriticOutput();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput({
        recommendation: "rework_required",
        findings: [{
          findingId: "finding-audience-world",
          severity: "blocker",
          locator: { kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" },
          evidenceRefs: ["evidence:audience"],
          responsibleStage: "video_concept_selection",
          minimalFix: "保留独立故事，只重写唯一回接。",
          invalidatesDownstream: true,
        }],
        minimalFix: "保留独立故事，只重写唯一回接。",
        hardGateResults: base.hardGateResults.map((gate, index) =>
          index === 4 ? { ...gate, status: "failed", findingIds: ["finding-audience-world"] } : gate,
        ),
      }),
      assistantSummary: "课程锚点需要返修。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({
      status: "succeeded",
      policyOutcome: {
        gateId: "video_course_anchor_critic",
        passed: false,
        eligibleForDownstreamGuard: false,
        reviewOutcome: "rework_required",
        forbiddenNextToolIntents: expect.arrayContaining(["generate_video_assets", "generate_video_shot", "assemble_video"]),
      },
      structuredOutput: {
        recommendation: "rework_required",
        targetLocators: [{ kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" }],
        responsibleStage: "video_concept_selection",
        minimalFix: "保留独立故事，只重写唯一回接。",
      },
    });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it.each([
    ["missing finding", videoCriticOutput({ recommendation: "rework_required", findings: [] })],
    ["empty minimal fix", videoCriticOutput({
      recommendation: "rework_required",
      minimalFix: "",
      findings: [{
        findingId: "finding-empty-fix",
        severity: "major",
        locator: { kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" },
        evidenceRefs: ["evidence:fix"],
        responsibleStage: "video_concept_selection",
        minimalFix: "重做独立创意。",
        invalidatesDownstream: true,
      }],
    })],
    ["downstream repair stage", videoCriticOutput({
      recommendation: "blocked",
      responsibleStage: "video_shot_generation",
      minimalFix: "停止镜头生成并返回创意阶段。",
      findings: [{
        findingId: "finding-downstream-stage",
        severity: "blocker",
        locator: { kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" },
        evidenceRefs: ["evidence:stage"],
        responsibleStage: "video_shot_generation",
        minimalFix: "停止镜头生成并返回创意阶段。",
        invalidatesDownstream: true,
      }],
    })],
  ])("rejects an unactionable course-anchor repair report: %s", async (_name, structuredOutput) => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput,
      assistantSummary: "返修报告不完整。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("rejects a Critic invocation whose signed review target and courseAnchorRef disagree", async () => {
    const base = videoCriticEnvelope();
    const envelope = createAgentToolInvocationEnvelope({
      ...base,
      arguments: {
        ...base.arguments,
        courseAnchorRef: { artifactId: "different-anchor", version: 2, digest: "d".repeat(64) },
      },
    });
    const executor = vi.fn();

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a non-video Critic invocation whose input locators escape the signed review target", async () => {
    const base = pptCriticEnvelope();
    const envelope = createAgentToolInvocationEnvelope({
      ...base,
      arguments: {
        ...base.arguments,
        targetLocators: [{ kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-b" }],
      },
    });
    const executor = vi.fn();

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a Critic invocation that mixes the signed input target with another Artifact", async () => {
    const base = pptCriticEnvelope();
    const envelope = createAgentToolInvocationEnvelope({
      ...base,
      arguments: {
        ...base.arguments,
        targetLocators: [
          { kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-a" },
          { kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-b" },
        ],
      },
    });
    const executor = vi.fn();

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a non-video Critic report whose output locators escape the signed review target", async () => {
    const envelope = pptCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: pptCriticOutput({
        targetLocators: [{ kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-b" }],
      }),
      assistantSummary: "审查目标错误。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("rejects a non-video Critic finding whose locator escapes the signed review target", async () => {
    const envelope = pptCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: pptCriticOutput({
        findings: [{
          findingId: "finding-other-artifact",
          severity: "major",
          locator: { kind: "artifact", artifactKind: "pptx_artifact", artifactId: "artifact-b" },
          evidenceRefs: ["evidence:other-artifact"],
          responsibleStage: "ppt_page_design",
          minimalFix: "只修目标页面。",
          invalidatesDownstream: true,
        }],
      }),
      assistantSummary: "finding目标错误。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("allows typed child locators that remain under the signed review target", async () => {
    const base = pptCriticEnvelope();
    const envelope = createAgentToolInvocationEnvelope({
      ...base,
      arguments: {
        ...base.arguments,
        targetLocators: [{ kind: "page", pageId: "page_03", parentArtifactId: "artifact-a" }],
      },
    });
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: pptCriticOutput({
        targetLocators: [{ kind: "page", pageId: "page_03", parentArtifactId: "artifact-a" }],
        findings: [{
          findingId: "finding-page-03",
          severity: "minor",
          locator: { kind: "page", pageId: "page_03", parentArtifactId: "artifact-a" },
          evidenceRefs: ["evidence:page-03"],
          responsibleStage: "ppt_page_design",
          minimalFix: "调整第3页。",
          invalidatesDownstream: false,
        }],
      }),
      assistantSummary: "定位到第3页。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "succeeded" });
  });

  it("rejects a Critic report that drifts to a sibling page inside the signed Artifact", async () => {
    const base = pptCriticEnvelope();
    const envelope = createAgentToolInvocationEnvelope({
      ...base,
      arguments: {
        ...base.arguments,
        targetLocators: [{ kind: "page", pageId: "page_03", parentArtifactId: "artifact-a" }],
      },
    });
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: pptCriticOutput({
        targetLocators: [{ kind: "page", pageId: "page_04", parentArtifactId: "artifact-a" }],
      }),
      assistantSummary: "越出了签名页级范围。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("requires the course-anchor Critic output to retain an exact root Artifact locator", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput({
        targetLocators: [{ kind: "shot", shotId: "shot-01", parentArtifactId: "creative-anchor-a" }],
      }),
      assistantSummary: "缺少根Artifact定位。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("requires a signed review target for the Critic and forbids one on a Director", async () => {
    const criticBase = videoCriticEnvelope();
    const criticEnvelope = createAgentToolInvocationEnvelope({ ...criticBase, reviewTargetRef: null });
    const directorBase = validEnvelope();
    const directorEnvelope = createAgentToolInvocationEnvelope({
      ...directorBase,
      reviewTargetRef: {
        artifactId: "creative-anchor-a",
        kind: "creative_theme_generate",
        version: 2,
        digest: "c".repeat(64),
      },
    });
    const executor = vi.fn();

    const criticResult = await routeAgentToolCall(criticEnvelope, { executor, authorize: async () => true });
    const directorResult = await routeAgentToolCall(directorEnvelope, { executor, authorize: async () => true });

    expect(criticResult).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(directorResult).toMatchObject({ status: "failed", errorCategory: "agent_tool_arguments_invalid" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a Critic report whose target locator does not match the signed review target", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput({
        targetLocators: [{ kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "other-anchor" }],
      }),
      assistantSummary: "目标不一致。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it("rejects a Critic report that mixes the signed review target with another Artifact", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput({
        targetLocators: [
          { kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-a" },
          { kind: "artifact", artifactKind: "creative_theme_generate", artifactId: "creative-anchor-b" },
        ],
      }),
      assistantSummary: "混入了其他审查目标。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it("rejects an empty typed locator shape before applying the Critic policy gate", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput({ targetLocators: [{ kind: "page" }] }),
      assistantSummary: "定位缺少页面标识。",
      artifactCreated: false as const,
    }));

    const result = await routeAgentToolCall(envelope, { executor, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_output_invalid" });
  });

  it("rejects an injected Executor that attempts to forge Router-owned production eligibility", async () => {
    const envelope = videoCriticEnvelope();
    const executor = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "delivery_critic.review" as const,
      invocationId: envelope.invocationId,
      structuredOutput: videoCriticOutput(),
      assistantSummary: "伪造生产资格。",
      artifactCreated: false as const,
      policyOutcome: { eligibleForDownstreamGuard: true },
      reviewBinding: { productionEligible: true },
    }));

    const result = await routeAgentToolCall(envelope, { executor: executor as any, authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_execution_failed" });
    expect(isAgentToolResultEligibleForProductionGuard(result)).toBe(false);
  });

  it("fails closed when the production Agent executor is unavailable", async () => {
    const result = await routeAgentToolCall(validEnvelope(), { authorize: async () => true });

    expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_unavailable", artifactCreated: false });
    if (result.status === "succeeded") throw new Error("Expected Agent Tool routing to fail closed.");
    expect(result.observation.retryPolicy).toMatchObject({ retryable: true, nextAction: "retry_later" });
  });
});
