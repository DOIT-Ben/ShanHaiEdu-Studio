import { extractEducationGrade, extractEducationSubject, extractEducationTopic } from "@/server/education-context";

export type ProjectSemanticScopeSource = {
  title?: string | null;
  grade?: string | null;
  subject?: string | null;
  lessonTopic?: string | null;
};

export function resolveProjectSemanticScope(project: ProjectSemanticScopeSource, taskGoal: string) {
  return {
    grade: inferGrade(taskGoal) ?? normalized(project.grade) ?? "未指定年级",
    subject: inferSubject(taskGoal) ?? normalized(project.subject) ?? "未指定学科",
    topic: inferTopic(taskGoal) ?? normalized(project.lessonTopic) ?? "待确认课题",
  };
}

export function inferGrade(text: string) {
  return normalized(extractEducationGrade(text));
}

export function inferSubject(text: string) {
  return normalized(extractEducationSubject(text));
}

export function inferTopic(text: string) {
  return normalized(extractEducationTopic(text)) ?? normalized(text.match(/百分数|分数|小数|周长|面积|乘法|除法/)?.[0]);
}

function normalized(value: string | null | undefined) {
  const result = value?.trim();
  return result || null;
}
