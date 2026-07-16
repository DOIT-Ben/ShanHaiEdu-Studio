import { describe, expect, it } from "vitest";

import { resolveProjectSemanticScope } from "@/server/conversation/project-semantic-scope";

describe("TaskBrief-first project semantic scope", () => {
  it("derives grade subject and topic from the current TaskBrief instead of an unnamed project title", () => {
    expect(resolveProjectSemanticScope({
      title: "未命名公开课项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请为五年级数学《百分数》完成一套公开课材料包。" )).toEqual({
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
    });
  });

  it("keeps the current TaskBrief authoritative over stale project metadata", () => {
    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: "六年级",
      subject: "科学",
      lessonTopic: "杠杆",
    }, "五年级数学百分数")).toEqual({ grade: "五年级", subject: "数学", topic: "百分数" });
  });

  it("preserves grades beyond primary school instead of replacing them with a primary default", () => {
    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请制作七年级语文《春》的课件")).toEqual({ grade: "七年级", subject: "语文", topic: "春" });
  });

  it("preserves non-primary subjects and topics without an elementary content allowlist", () => {
    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请制作高一物理《牛顿第一定律》的课件")).toEqual({ grade: "高一", subject: "物理", topic: "牛顿第一定律" });
  });

  it("preserves university and vocational education semantics without a primary-stage fallback", () => {
    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请制作大学计算机《数据结构》的课件")).toEqual({ grade: "大学", subject: "计算机", topic: "数据结构" });

    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请制作职业教育《机械制图》的课程材料")).toEqual({ grade: "职业教育", subject: "未指定学科", topic: "机械制图" });
  });

  it("keeps unknown education semantics explicit instead of silently rewriting them as primary math", () => {
    expect(resolveProjectSemanticScope({
      title: "项目",
      grade: null,
      subject: null,
      lessonTopic: null,
    }, "请整理《组织行为学》的课程材料")).toEqual({
      grade: "未指定年级",
      subject: "未指定学科",
      topic: "组织行为学",
    });
  });
});
