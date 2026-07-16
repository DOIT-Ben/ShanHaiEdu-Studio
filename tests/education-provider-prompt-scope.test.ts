import { describe, expect, it } from "vitest";

import { buildCozePptCliPrompt, buildCozePptPrompt } from "@/server/coze-ppt/coze-ppt-run";
import { buildVideoArtifactPrompt } from "@/server/video-generation/video-generation-run";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

describe("education provider prompt scope", () => {
  it("preserves the current project semantics without injecting a primary-math task", () => {
    const project = {
      grade: "大学",
      subject: "计算机",
      lessonTopic: "数据结构",
    } as ProjectRecord;
    const pptDesign = {
      markdownContent: "## 第 1 页四层设计\n底图、元素、文字、排版。",
    } as ArtifactRecord;
    const videoPlan = {
      markdownContent: "镜头 1：机械装置在独立世界中启动，以一个问题回接课程。",
    } as ArtifactRecord;

    for (const prompt of [buildCozePptCliPrompt(project, pptDesign), buildCozePptPrompt(project, pptDesign)]) {
      expect(prompt).toContain("年级：大学");
      expect(prompt).toContain("学科：计算机");
      expect(prompt).toContain("课题：数据结构");
      expect(prompt).not.toMatch(/小学数学|六年级|百分数导入课|sujiao-grade6-percentage-textbook/);
    }

    const videoPrompt = buildVideoArtifactPrompt(project, videoPlan);
    expect(videoPrompt).toContain("年级：大学");
    expect(videoPrompt).toContain("学科：计算机");
    expect(videoPrompt).toContain("课题：数据结构");
    expect(videoPrompt).not.toMatch(/小学公开课|六年级|百分数导入课/);
  });

  it("uses explicit neutral values when project semantics are absent", () => {
    const project = { grade: null, subject: null, lessonTopic: null } as ProjectRecord;
    const artifact = { markdownContent: "## 第 1 页四层设计\n底图、元素、文字、排版。" } as ArtifactRecord;

    expect(buildCozePptPrompt(project, artifact)).toContain("年级：未指定年级");
    expect(buildCozePptPrompt(project, artifact)).toContain("学科：未指定学科");
    expect(buildVideoArtifactPrompt(project, artifact)).toContain("课题：未指定课题");
  });
});
