import { describe, expect, it } from "vitest";

import { enforceVideoCourseAnchorGate } from "@/server/tools/video-course-anchor-gate";

function candidate(overrides: Record<string, unknown> = {}) {
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
      handoffMoment: "系统停在无法判断每组数量的问题上。",
      classroomReturnQuestion: "怎样先弄清每组有几个？",
    },
    nextToolIntents: ["generate_video_segment"],
    ...overrides,
  };
}

describe("V1-2 video course anchor hard gate", () => {
  it("allows an independently understandable concept with one minimal course handoff", () => {
    expect(enforceVideoCourseAnchorGate(candidate())).toMatchObject({ allowed: true, verdict: "pass" });
  });

  it.each([
    ["understandableWithoutLesson"],
    ["worthwhileWithoutClassroomReturn"],
    ["notTextbookOrPptRetelling"],
  ])("blocks when independent film check %s fails", (failedKey) => {
    const value = candidate();
    value.independentFilmChecks[failedKey as keyof typeof value.independentFilmChecks] = {
      passed: false,
      evidence: "不满足硬门。",
    };

    const result = enforceVideoCourseAnchorGate(value);

    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe("rework_required");
    expect(result.nextToolIntents).not.toContain("generate_video_segment");
  });

  it.each([
    ["儿童角色强绑定", { requiredCharacters: ["因为观众是小学生，所以必须由小学生主角完成课堂任务"], requiredSettings: ["生活场景"] }],
    ["全程教室", { requiredCharacters: ["教师", "学生"], requiredSettings: ["教室", "黑板", "课堂活动"] }],
    ["教材动画版", { requiredCharacters: ["教材中的学生"], requiredSettings: ["教材点数情境复刻"] }],
    ["PPT动态版", { requiredCharacters: ["课件角色"], requiredSettings: ["逐页PPT动画复述"] }],
  ])("blocks the %s anti-pattern before media tools", (_name, storyWorld) => {
    const result = enforceVideoCourseAnchorGate(candidate({
      storyWorld,
      nextToolIntents: ["generate_video_assets", "generate_video_shot", "assemble_video"],
    }));

    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe("rework_required");
    expect(result.nextToolIntents).not.toContain("generate_video_segment");
    expect(result.nextToolIntents).toEqual([]);
    expect(result.reasonCodes).toContain("course_anchor_story_world_overconstrained");
  });
});
