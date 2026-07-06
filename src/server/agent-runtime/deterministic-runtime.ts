import type {
  AgentArtifactDraft,
  AgentRuntime,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentRuntimeTask,
} from "./types";

type DraftTemplate = {
  title: string;
  summary: string;
  sections: (input: AgentRuntimeInput) => string[];
};

const taskTemplates: Record<AgentRuntimeTask, DraftTemplate> = {
  requirement_spec: {
    title: "需求规格说明书",
    summary: "已整理公开课目标、基础信息、交付范围和后续输入要求。",
    sections: (input) => [
      section("项目概述", [
        `课题：${input.projectContext.grade}${input.projectContext.subject}《${input.projectContext.topic}》。`,
        `课堂时长：${formatDuration(input)}。`,
        `教师目标：${input.projectContext.teacherGoal || "先完成可确认的公开课备课文本链路。"}`,
      ]),
      section("已确认信息", [
        `教材版本：${input.projectContext.textbookVersion || "待补充"}`,
        `期望交付：${input.projectContext.requestedOutputs.join("、") || "需求规格、教案、PPT 大纲、导入视频方案"}`,
        `原始需求：${input.userMessage}`,
      ]),
      section("后续节点输入", [
        "教材证据节点优先使用教师粘贴或上传的教材内容。",
        "教案节点以已确认需求和教材依据为输入。",
        "PPT 与导入视频节点只使用已确认的上游草稿继续展开。",
      ]),
    ],
  },
  textbook_evidence: {
    title: "教材证据包",
    summary: "已形成教材依据、知识点位置和可信度提醒，缺教材时保留待补充状态。",
    sections: (input) => [
      section("教材依据", [
        `教材版本：${input.projectContext.textbookVersion || "待补充"}`,
        `课题：${input.projectContext.topic}`,
        "当前草稿以教师提供信息为准，未补充教材原文时只能作为低可信框架。",
      ]),
      section("知识点关系", [
        `${input.projectContext.topic} 需要连接生活情境、概念表达和课堂练习。`,
        "教材证据应服务教学目标，不替代教师对原文和例题的最终核对。",
      ]),
      section("补充建议", [
        "建议补充页码、例题截图或教材文字。",
        "补齐后再确认本节点，并继续生成教案。",
      ]),
    ],
  },
  lesson_plan: {
    title: "公开课教案",
    summary: "已生成教学目标、重点难点、课堂流程、板书和教师讲稿要点。",
    sections: (input) => [
      section("教学目标", [
        `学生能结合情境理解${input.projectContext.topic}的意义。`,
        "学生能用自己的语言解释关键概念，并完成基础迁移练习。",
        "课堂活动保持可观察、可追问、可板书。",
      ]),
      section("教学流程", [
        "导入：用生活问题引发观察，不直接给出结论。",
        "探究：让学生比较、表达、归纳。",
        "练习：从基础辨析到公开课展示题逐步推进。",
      ]),
      section("板书与讲稿", [
        `板书主线：情境问题 -> 学生表达 -> ${input.projectContext.topic} -> 练习巩固。`,
        "讲稿保留追问句，便于教师根据课堂反馈调整节奏。",
      ]),
    ],
  },
  ppt_outline: {
    title: "PPT 大纲与逐页脚本",
    summary: "已规划页面结构、每页教学目标、课堂活动和视觉需求。",
    sections: (input) => [
      section("页面结构", [
        "第 1 页：课题与课堂情境。",
        "第 2-3 页：导入问题与学生观察。",
        "第 4-8 页：概念探究、例题拆解和板书同步。",
        "第 9-12 页：练习、总结和课后延伸。",
      ]),
      section("逐页脚本原则", [
        `每页只服务一个教学动作，围绕${input.projectContext.topic}逐步推进。`,
        "文字少、问题清楚、活动可执行。",
      ]),
      section("视觉需求", [
        "主视觉使用真实课堂可理解的生活情境。",
        "避免花哨装饰，优先表达数量关系和思考路径。",
      ]),
    ],
  },
  intro_video_plan: {
    title: "导入视频方案",
    summary: "已生成独立创意、开场钩子、课程锚点、脚本和分镜提示。",
    sections: (input) => [
      section("独立主题", [
        `用一个和${input.projectContext.topic}相关但不提前讲解${input.projectContext.topic}定义的生活悬念开场。`,
        "视频目标是吸引注意力，不替代教师授课。",
      ]),
      section("课程锚点", [
        `结尾问题：生活里的这些现象，为什么都能和${input.projectContext.topic}联系起来？`,
        "把结论留给课堂探究，由教师带学生回到教材和板书。",
      ]),
      section("脚本与分镜", [
        "镜头 1：生活场景出现明显冲突或好奇点。",
        "镜头 2：角色提出问题，暂不解释答案。",
        "镜头 3：画面定格到课堂落点，邀请学生带着问题进入本课。",
      ]),
    ],
  },
  final_delivery_checklist: {
    title: "最终交付清单",
    summary: "已汇总需求、教材、教案、PPT、导入视频和授课检查项。",
    sections: (input) => [
      section("已形成材料", [
        "需求规格说明书。",
        "教材证据包。",
        "公开课教案。",
        "PPT 大纲与逐页脚本。",
        "导入视频方案。",
      ]),
      section("待确认事项", [
        `教材版本：${input.projectContext.textbookVersion || "待补充"}`,
        "PPTX、图片文件和视频成片如果未真实生成，交付时必须标记为待生成。",
      ]),
      section("课堂使用前检查", [
        "核对教材页码和例题。",
        "核对每页 PPT 是否服务一个教学动作。",
        "核对导入视频是否只制造兴趣，并通过课程锚点回到课堂。",
      ]),
    ],
  },
};

export class DeterministicRuntime implements AgentRuntime {
  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const template = taskTemplates[input.task];
    const markdown = [
      "> 这是一份结构草稿，用于检查流程和内容框架；正式授课前请重新生成或人工核对。",
      "",
      ...template.sections(input),
    ].join("\n\n");

    const artifactDraft: AgentArtifactDraft = {
      nodeKey: input.task,
      kind: input.task,
      title: template.title,
      summary: template.summary,
      markdown,
      contentType: "text/markdown",
      generationMode: "deterministic_draft",
      isReadyForTeacherReview: true,
    };

    return {
      status: "succeeded",
      run: {
        runId: input.runId,
        projectId: input.projectId,
        task: input.task,
        runtimeKind: "deterministic",
        status: "succeeded",
      },
      assistantMessage: {
        title: `${template.title}已生成`,
        body: "我先生成了一份结构草稿，方便你检查内容路径。正式授课前建议结合教材原文和课堂实际再核对一遍。",
      },
      artifactDraft,
      nextSuggestedAction: {
        type: "review_artifact",
        label: "查看并确认这份草稿",
      },
    };
  }
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines.map((line) => `- ${line}`)].join("\n");
}

function formatDuration(input: AgentRuntimeInput): string {
  return input.projectContext.lessonDurationMinutes
    ? `${input.projectContext.lessonDurationMinutes} 分钟`
    : "待补充";
}
