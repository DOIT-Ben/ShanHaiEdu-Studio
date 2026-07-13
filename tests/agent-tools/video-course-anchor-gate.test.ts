import { describe, expect, it } from "vitest";

import {
  enforceVideoCourseAnchorCriticGate,
  enforceVideoCourseAnchorGate,
  type VideoCourseAnchorCriticCandidate,
  videoCourseAnchorHardGateIds,
} from "@/server/tools/video-course-anchor-gate";

function directorCandidate(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "pass",
    independentFilmChecks: {
      understandableWithoutLesson: { passed: true, evidence: "故事目标和冲突无需教材背景。" },
      worthwhileWithoutClassroomReturn: { passed: true, evidence: "去掉最后提问仍有目标、阻碍和变化。" },
      notTextbookOrPptRetelling: { passed: true, evidence: "故事机制不是教材情境或课件页复述。" },
    },
    storyWorld: {
      premise: "无人分拣站的标签失灵，机械臂必须解决分类冲突。",
      requiredCharacters: ["机械臂"],
      requiredSettings: ["无人分拣站"],
    },
    courseAnchor: {
      anchorTrigger: "系统因无法判断每组数量而停摆。",
      handoffMoment: "系统停在无法判断每组数量的问题上。",
      classroomReturnQuestion: "怎样先弄清每组有几个？",
      doNotExplain: ["不显示数字答案", "不讲物体与数字的对应方法"],
      anchorCount: 1,
    },
    nextToolIntents: ["delivery_critic.review", "generate_video_segment"],
    ...overrides,
  };
}

function criticCandidate(
  overrides: Partial<VideoCourseAnchorCriticCandidate> = {},
): VideoCourseAnchorCriticCandidate {
  return {
    recommendation: "pass",
    summary: "独立创意与课程回接均通过。",
    findings: [],
    targetLocators: [{ kind: "artifact" as const, artifactKind: "course_anchor", artifactId: "anchor-1" }],
    responsibleStage: "video_concept_selection",
    minimalFix: "无需返修。",
    inconclusiveReasons: [],
    hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({
      gateId,
      status: "passed",
      evidenceRefs: [`evidence:${gateId}`],
      rationale: "有明确证据。",
      findingIds: [],
    })),
    ...overrides,
  };
}

describe("V1-2 video Director candidate gate", () => {
  it("accepts an independent candidate but never authorizes real media before the independent Critic", () => {
    const result = enforceVideoCourseAnchorGate(directorCandidate({
      nextToolIntents: [
        "delivery_critic.review",
        "generate_video_segment",
        "generate_ppt_sample_assets",
        "generate_ppt_full_assets",
        "future_side_effect_tool",
      ],
    }));

    expect(result).toMatchObject({ candidateAccepted: true, eligibleForDownstreamGuard: false, verdict: "pass" });
    expect(result.nextToolIntents).toEqual(["delivery_critic.review"]);
    expect(result.reasonCodes).toContain("independent_critic_required");
  });

  it.each([
    ["understandableWithoutLesson"],
    ["worthwhileWithoutClassroomReturn"],
    ["notTextbookOrPptRetelling"],
  ])("rejects the candidate when independent film check %s fails", (failedKey) => {
    const value = directorCandidate();
    value.independentFilmChecks[failedKey as keyof typeof value.independentFilmChecks] = {
      passed: false,
      evidence: "不满足硬门。",
    };

    const result = enforceVideoCourseAnchorGate(value);

    expect(result.candidateAccepted).toBe(false);
    expect(result.eligibleForDownstreamGuard).toBe(false);
    expect(result.verdict).toBe("rework_required");
    expect(result.nextToolIntents).not.toContain("generate_video_segment");
  });

  it.each([
    ["儿童角色强绑定", { requiredCharacters: ["因为观众是小学生，所以必须由小学生主角完成课堂任务"], requiredSettings: ["生活场景"] }],
    ["全程教室", { requiredCharacters: ["教师", "学生"], requiredSettings: ["教室", "黑板", "课堂活动"] }],
    ["教材动画版", { requiredCharacters: ["教材中的学生"], requiredSettings: ["教材点数情境复刻"] }],
    ["PPT动态版", { requiredCharacters: ["课件角色"], requiredSettings: ["逐页PPT动画复述"] }],
  ])("rejects the %s anti-pattern before media tools", (_name, storyWorld) => {
    const result = enforceVideoCourseAnchorGate(directorCandidate({
      storyWorld: { premise: "候选故事。", ...storyWorld },
      nextToolIntents: ["generate_video_assets", "generate_video_shot", "assemble_video"],
    }));

    expect(result.candidateAccepted).toBe(false);
    expect(result.eligibleForDownstreamGuard).toBe(false);
    expect(result.verdict).toBe("rework_required");
    expect(result.nextToolIntents).toEqual([]);
    expect(result.reasonCodes).toContain("course_anchor_story_world_overconstrained");
  });

  it.each([
    ["受众强绑定", "因为受众年龄是小学生，所以必须让儿童主角在教室完成课堂活动。"],
    ["全程课堂", "故事全程发生在课堂活动中，由教师带学生照着教材操作。"],
    ["教材复刻", "这是教材点数情境的原样动画复刻。"],
    ["PPT复刻", "把PPT逐页翻页和讲解做成动态课件。"],
  ])("also rejects %s when the anti-pattern exists only in premise", (_name, premise) => {
    const base = directorCandidate();
    const result = enforceVideoCourseAnchorGate(directorCandidate({
      storyWorld: { ...base.storyWorld, premise },
    }));

    expect(result.candidateAccepted).toBe(false);
    expect(result.reasonCodes).toContain("course_anchor_story_world_overconstrained");
  });

  it.each([
    ["儿童主角有独立创意理由", {
      storyWorld: { premise: "一名少年侦探追踪会改变形状的星光密码。", requiredCharacters: ["少年侦探"], requiredSettings: ["天文馆"] },
    }],
    ["教室仅在最终回接", {
      storyWorld: { premise: "巡检机器人在无人仓库追踪失控的信号灯。", requiredCharacters: ["巡检机器人"], requiredSettings: ["无人仓库"] },
      courseAnchor: {
        anchorTrigger: "机器人停在无法判断每组数量的问题上。",
        handoffMoment: "独立故事结束后，画面最后一瞬切回教室并留下同一个问题。",
        classroomReturnQuestion: "怎样先弄清每组有几个？",
        doNotExplain: ["不显示答案"],
        anchorCount: 1,
      },
    }],
    ["教室服务独立叙事", {
      storyWorld: { premise: "夜间空教室里的旧钟突然倒计时，巡检机器人必须找到停止机关。", requiredCharacters: ["巡检机器人"], requiredSettings: ["夜间空教室"] },
    }],
    ["否定课堂与复刻依赖", {
      storyWorld: {
        premise: "这不是课堂活动，也不是教材情境复刻或PPT动态版；夜间空教室里的旧钟突然倒计时。",
        requiredCharacters: ["巡检机器人"],
        requiredSettings: ["夜间空教室"],
      },
    }],
  ])("does not over-constrain the %s positive case", (_name, overrides) => {
    const result = enforceVideoCourseAnchorGate(directorCandidate(overrides));

    expect(result.candidateAccepted).toBe(true);
    expect(result.verdict).toBe("pass");
  });

  it.each([
    ["missing anchor trigger", { anchorTrigger: "" }],
    ["missing do-not-explain boundary", { doNotExplain: [] }],
    ["multiple anchors", { anchorCount: 2 }],
  ])("rejects an incomplete or non-minimal CourseAnchor: %s", (_name, anchorOverride) => {
    const base = directorCandidate();
    const result = enforceVideoCourseAnchorGate(directorCandidate({
      courseAnchor: { ...base.courseAnchor, ...anchorOverride },
    }));

    expect(result.candidateAccepted).toBe(false);
    expect(result.reasonCodes).toContain("course_anchor_handoff_incomplete");
  });
});

describe("V1-2 independent video Critic hard gate", () => {
  it("allows media only when all six authoritative gates pass", () => {
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate());

    expect(result.reviewPassed).toBe(true);
    expect(result.eligibleForDownstreamGuard).toBe(true);
    expect(result.reasonCodes).toEqual([]);
    expect(result.forbiddenNextToolIntents).toEqual([]);
  });

  it.each(videoCourseAnchorHardGateIds)("blocks media and preserves repair data when %s fails", (failedGateId) => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "rework_required",
      findings: [{
        findingId: `finding-${failedGateId}`,
        severity: "blocker",
        locator: { kind: "artifact", artifactKind: "course_anchor", artifactId: "anchor-1" },
        evidenceRefs: [`evidence:${failedGateId}`],
        responsibleStage: "video_concept_selection",
        minimalFix: "回到创意机制重新设计。",
        invalidatesDownstream: true,
      }],
      minimalFix: "回到创意机制重新设计。",
      hardGateResults: base.hardGateResults.map((gate) =>
        gate.gateId === failedGateId
          ? { ...gate, status: "failed", findingIds: [`finding-${failedGateId}`] }
          : gate,
      ),
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.eligibleForDownstreamGuard).toBe(false);
    expect(result.recommendation).toBe("rework_required");
    expect(result.minimalFix).toBe("回到创意机制重新设计。");
    expect(result.targetLocators).toEqual([{ kind: "artifact", artifactKind: "course_anchor", artifactId: "anchor-1" }]);
    expect(result.forbiddenNextToolIntents).toEqual(expect.arrayContaining([
      "generate_video_assets",
      "generate_video_shot",
      "assemble_video",
      "create_final_package",
    ]));
    expect(result.reasonCodes).toContain(`hard_gate_failed:${failedGateId}`);
  });

  it("keeps an inconclusive report structured and blocks media", () => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "inconclusive",
      inconclusiveReasons: ["缺少课程锚点版本证据。"],
      hardGateResults: base.hardGateResults.map((gate, index) =>
        index === 0 ? { ...gate, status: "inconclusive" } : gate,
      ),
    }));

    expect(result).toMatchObject({ reviewPassed: false, eligibleForDownstreamGuard: false, recommendation: "inconclusive" });
    expect(result.inconclusiveReasons).toEqual(["缺少课程锚点版本证据。"]);
  });

  it("fails closed when an inconclusive gate omits the evidence-gap reason", () => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "inconclusive",
      inconclusiveReasons: [],
      hardGateResults: base.hardGateResults.map((gate, index) =>
        index === 0 ? { ...gate, status: "inconclusive" } : gate,
      ),
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("inconclusive");
    expect(result.reasonCodes).toContain("inconclusive_reason_missing");
  });

  it("lets hard-gate evidence tighten a conflicting pass recommendation", () => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "pass",
      findings: [{
        findingId: "finding-independent",
        severity: "blocker",
        locator: { kind: "artifact", artifactKind: "course_anchor", artifactId: "anchor-1" },
        evidenceRefs: ["evidence:independent"],
        responsibleStage: "video_concept_selection",
        minimalFix: "重做独立创意。",
        invalidatesDownstream: true,
      }],
      hardGateResults: base.hardGateResults.map((gate, index) =>
        index === 0 ? { ...gate, status: "failed", findingIds: ["finding-independent"] } : gate,
      ),
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("rework_required");
    expect(result.reasonCodes).toContain("recommendation_conflict:pass_with_failed_gate");
  });

  it("fails closed when a passing gate has no evidence or rationale", () => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      hardGateResults: base.hardGateResults.map((gate, index) =>
        index === 0 ? { ...gate, evidenceRefs: [], rationale: "" } : gate,
      ),
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("inconclusive");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "hard_gate_evidence_missing:independent_understandability",
      "hard_gate_rationale_missing:independent_understandability",
    ]));
  });

  it("does not pass a report that contains a downstream-invalidating finding", () => {
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "pass",
      findings: [{
        findingId: "finding-blocker",
        severity: "blocker",
        locator: { kind: "artifact", artifactKind: "course_anchor", artifactId: "anchor-1" },
        evidenceRefs: ["evidence:blocker"],
        responsibleStage: "video_concept_selection",
        minimalFix: "先关闭阻塞问题。",
        invalidatesDownstream: true,
      }],
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("rework_required");
    expect(result.reasonCodes).toContain("blocking_finding_present");
  });

  it("fails closed when a rework report has no executable finding", () => {
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "rework_required",
      findings: [],
      minimalFix: "重新设计独立创意。",
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("inconclusive");
    expect(result.reasonCodes).toContain("repair_finding_missing");
  });

  it("fails closed when a repair report points to a downstream media stage", () => {
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      recommendation: "blocked",
      responsibleStage: "video_shot_generation",
      findings: [{
        findingId: "finding-stage",
        severity: "blocker",
        locator: { kind: "artifact", artifactKind: "course_anchor", artifactId: "anchor-1" },
        evidenceRefs: ["evidence:stage"],
        responsibleStage: "video_shot_generation",
        minimalFix: "回到创意阶段。",
        invalidatesDownstream: true,
      }],
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.recommendation).toBe("inconclusive");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "repair_stage_invalid:video_shot_generation",
      "finding_repair_stage_invalid:finding-stage:video_shot_generation",
    ]));
  });

  it.each([
    ["missing", (gates: ReturnType<typeof criticCandidate>["hardGateResults"]) => gates.slice(1), "hard_gate_missing:independent_understandability"],
    ["duplicate", (gates: ReturnType<typeof criticCandidate>["hardGateResults"]) => [...gates, gates[0]], "hard_gate_duplicate:independent_understandability"],
    ["unexpected", (gates: ReturnType<typeof criticCandidate>["hardGateResults"]) => [...gates.slice(1), { ...gates[0], gateId: "unknown_gate" }], "hard_gate_unexpected:unknown_gate"],
  ])("fails closed for a %s hard-gate identity", (_name, mutate, expectedReason) => {
    const base = criticCandidate();
    const result = enforceVideoCourseAnchorCriticGate(criticCandidate({
      hardGateResults: mutate(base.hardGateResults),
    }));

    expect(result.reviewPassed).toBe(false);
    expect(result.eligibleForDownstreamGuard).toBe(false);
    expect(result.reasonCodes).toContain(expectedReason);
  });
});
