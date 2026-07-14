import type {
  AgentArtifactDraft,
  AgentRuntime,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentRuntimeTask,
} from "./types";
import { taskGuidance } from "./task-guidance";

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
      section("交付范围与质量约束", [
        "V1 先交付可确认的文本产物。",
        "PPTX、图片文件和视频成片属于后续真实能力，未生成时不得标记为完成。",
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
        `页码或页段：待教师补充或确认。`,
        `知识点：${input.projectContext.topic}`,
        "当前草稿以教师提供信息为准，未补充教材原文时只能作为低可信框架。",
      ]),
      section("关键例题或情境", [
        "优先记录教材原文中的例题、主题图或生活情境。",
        "如果暂缺原文，先记录为待补充，不做确定性引用。",
      ]),
      section("与教学目标关系", [
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
      section("重点难点", [
        `教学重点：理解${input.projectContext.topic}的核心意义并能表达。`,
        `教学难点：把生活情境转化为${input.projectContext.topic}的数学表达。`,
      ]),
      section("教学流程", [
        "导入：用生活问题引发观察，不直接给出结论。",
        "探究：让学生比较、表达、归纳。",
        "练习：从基础辨析到公开课展示题逐步推进。",
      ]),
      section("学生活动与课堂总结", [
        "学生活动：观察情境、说出想法、同伴补充、板书归纳。",
        `课堂总结：回到${input.projectContext.topic}的意义、表达方式和生活应用。`,
      ]),
      section("板书与讲稿", [
        `板书主线：情境问题 -> 学生表达 -> ${input.projectContext.topic} -> 练习巩固。`,
        "教师讲稿要点：保留追问句，便于教师根据课堂反馈调整节奏。",
      ]),
    ],
  },
  ppt_outline: {
    title: "PPT 大纲与逐页脚本",
    summary: "已规划页面结构、每页教学目标、课堂活动和视觉需求。",
    sections: (input) => [
      section("页面结构", [
        "建议页数：12 页左右，可按公开课节奏微调。",
        "页面类型配比：情境导入 25%，概念探究 40%，练习巩固 25%，总结延伸 10%。",
        "第 1 页：课题与课堂情境。",
        "第 2-3 页：导入问题与学生观察。",
        "第 4-8 页：概念探究、例题拆解和板书同步。",
        "第 9-12 页：练习、总结和课后延伸。",
      ]),
      section("逐页脚本原则", [
        `每页只服务一个教学动作，围绕${input.projectContext.topic}逐步推进。`,
        "每页教学目标和学生活动要能被教师直接复述或改写。",
        "文字少、问题清楚、活动可执行。",
      ]),
      section("主视觉需求", [
        "主视觉使用真实课堂可理解的生活情境。",
        "避免花哨装饰，优先表达数量关系和思考路径。",
      ]),
    ],
  },
  ppt_design: {
    title: "逐页四层 PPT 设计稿",
    summary: "已把 PPT 页面任务规划转成逐页四层设计稿，包含整体风格、底图、元素、文字和排版。",
    sections: (input) => [
      section("整体视觉风格", [
        "纯白课堂课件底色，使用少量低饱和蓝绿强调数学关系。",
        "每页只服务一个教学动作，避免说明文档式堆字。",
        `围绕${input.projectContext.topic}建立从生活情境到数学表达的视觉路径。`,
        "页数：12 页。",
      ]),
      ...buildPptDesignPageSections(input),
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
      section("开场钩子与吸睛点", [
        "开场钩子：先呈现一个学生会想追问的反常或有趣现象，不给出数学结论。",
        "吸睛点：用画面冲突、数量变化或角色疑问制造好奇心，让学生愿意进入课堂讨论。",
        "第一句话只提出问题，不解释知识点定义、公式或解题步骤。",
      ]),
      section("课程锚点", [
        `结尾问题：生活里的这些现象，为什么都能和${input.projectContext.topic}联系起来？`,
        "课堂落点问题：你观察到的现象里，哪些地方需要用今天的数学语言解释？",
        "把结论留给课堂探究，由教师带学生回到教材和板书。",
      ]),
      section("脚本与分镜", [
        "镜头 1：生活场景出现明显冲突或好奇点。",
        "镜头 2：角色提出问题，暂不解释答案。",
        "镜头 3：画面定格到课堂落点，邀请学生带着问题进入本课。",
      ]),
      section("分镜摘要与旁白建议", [
        "分镜摘要：3 个短镜头，每个镜头只提出一个观察点。",
        "图片提示词：生活化数学场景，画面主体清楚，避免直接出现答案。",
        "旁白建议：用疑问句收束，引导学生进入课堂探究。",
      ]),
    ],
  },
  knowledge_anchor_extract: {
    title: "视频最小课程锚点",
    summary: "已从任务语义形成独立短片与课程任务之间唯一、最小的回接。",
    sections: (input) => [
      section("唯一最小课程锚点", [`只在结尾提出与${input.projectContext.topic}有关的待探究问题。`]),
      section("课程任务回接", ["短片结束后把未解问题交回课程任务，不解释答案。"]),
      section("回接时机", ["独立叙事完成后的最后一个节拍。"]),
      section("不可扩张约束", ["不要求儿童、教师、教室或课堂活动成为短片角色与场景。"]),
    ],
  },
  creative_theme_generate: {
    title: "导入创意主题",
    summary: "已形成脱离教材仍成立、仅以最小课程锚点回接的独立创意候选。",
    sections: (input) => [
      section("独立创意候选", ["主题 A：失控的机械信标。", "主题 B：倒流的城市计时器。"]),
      section("一句话故事", ["一个机械信标不断发出互相矛盾的航向，主角必须在倒计时结束前找出规律。"]),
      section("创意成立性", ["即使不接教材，冲突、目标和悬念仍完整成立。"]),
      section("唯一最小课程锚点", [`结尾只提出一个可回到${input.projectContext.topic}任务的问题。`]),
      section("课程回接", ["短片结束后由教师接回课程任务，不在片内授课。"]),
      section("风险", ["情节不能过长，画面文字不能过多。"]),
    ],
  },
  video_script_generate: {
    title: "导入视频脚本",
    summary: "已形成脚本、旁白或字幕、每镜头时长和课堂边界约束。",
    sections: (input) => [
      section("视频脚本", ["开场提出生活悬念。", "中段展示角色观察和疑问。", "结尾把问题抛回课堂。"]),
      section("旁白或字幕", ["为什么同样的数量变化，大家的判断不一样？", `这和今天的${input.projectContext.topic}有什么关系？`]),
      section("每镜头时长", ["镜头 1：8 秒。", "镜头 2：10 秒。", "镜头 3：10 秒。"]),
      section("课堂边界约束", ["不讲公式、不讲定义、不展示答案。"]),
      section("课堂落点", [`请学生带着问题进入${input.projectContext.topic}探究。`]),
    ],
  },
  storyboard_generate: {
    title: "导入视频分镜",
    summary: "已拆出分镜 ID、每镜头时长、画面动作、资产和关键帧要求。",
    sections: () => [
      section("分镜 ID", ["S1 冷启动钩子。", "S2 情境冲突。", "S3 回到课堂问题。"]),
      section("每镜头时长", ["S1：8 秒；S2：10 秒；S3：10 秒。"]),
      section("镜头目标", ["制造观察兴趣。", "呈现反常或冲突。", "引出课堂问题。"]),
      section("场景", ["明亮教室或生活化场景。"]),
      section("画面动作", ["角色观察、停顿、指向关键对象。"]),
      section("镜头运动", ["轻微推近，不快速摇晃。"]),
      section("旁白或字幕", ["只保留疑问句。"]),
      section("角色、道具、场景资产", ["学生角色、生活道具、课堂黑板。"]),
      section("关键帧要求", ["每个镜头至少有开始关键画面。"]),
      section("连贯性说明", ["角色造型、色调和场景连续。"]),
    ],
  },
  asset_brief_generate: {
    title: "视频资产说明",
    summary: "已生成统一风格、角色、道具、场景、关键帧和负面约束说明。",
    sections: () => [
      section("统一风格", ["明亮、真实课堂可接受、低噪声。"]),
      section("角色参考", ["小学生 2-3 人，服装朴素。"]),
      section("道具参考", ["生活物品、数据卡、黑板问题框。"]),
      section("场景参考", ["教室或生活场景，背景不出现品牌。"]),
      section("关键帧", ["每个镜头生成对应关键帧提示词。"]),
      section("负面约束", ["避免二维码、品牌、水印、复杂文字和答案暴露。"]),
      section("真实文件引用要求", ["后续资产图必须保存真实文件引用。"]),
    ],
  },
  video_segment_plan: {
    title: "分镜视频片段计划",
    summary: "已规划每段视频输入、参考图列表、目标时长和失败重试边界。",
    sections: () => [
      section("片段清单", ["S1 8 秒。", "S2 10 秒。", "S3 10 秒。"]),
      section("输入提示词", ["每段使用对应分镜提示词，不使用一句总 prompt 生成整条视频。"]),
      section("参考图列表", ["每段引用 1-7 张已生成资产图。"]),
      section("目标时长", ["单段控制在 6-30 秒。"]),
      section("失败重试边界", ["单段失败只重试该段。"]),
      section("生成服务边界", ["未证实首尾帧能力，不把多图参考当作首尾帧控制。"]),
    ],
  },
  concat_only_assemble: {
    title: "只拼接成片方案",
    summary: "已约束最终视频只按分镜顺序拼接通过校验的真实片段。",
    sections: () => [
      section("片段顺序", ["严格按 storyboard 顺序。"]),
      section("通过校验的片段", ["只使用真实下载并校验通过的 MP4 片段。"]),
      section("只拼接", ["不重写、不扩写、不替换片段内容。"]),
      section("不重排", ["不得调整分镜顺序。"]),
      section("不加转场", ["不新增转场。"]),
      section("不加滤镜", ["不新增滤镜或特效。"]),
      section("最终校验", ["不得用 smoke 或占位视频冒充最终视频。"]),
    ],
  },
  final_delivery_checklist: {
    title: "最终交付清单",
    summary: "已汇总当前草稿、接线占位和授课检查项。",
    sections: (input) => [
      section("当前已形成草稿", [
        "需求规格说明书。",
        "公开课教案。",
        "PPT 大纲与逐页脚本。",
        "PPTX 生成接线占位。",
        "课堂图片素材提示词接线占位。",
        "导入视频分镜接线占位。",
      ]),
      section("待确认事项", [
        `教材版本：${input.projectContext.textbookVersion || "待补充"}`,
        "PPTX、图片文件和视频成片在本阶段仍是接线占位，待接入真实服务后生成。",
        "教材证据、动画和视觉精修仍待教师补充材料或后续能力完善。",
      ]),
      section("课堂使用前检查", [
        "核对教材页码和例题。",
        "核对每页 PPT 是否服务一个教学动作。",
        "真实 PPTX 生成后再核对页面顺序、文字完整性和授课节奏。",
        "真实视频生成后再核对是否只制造兴趣，并通过课程锚点回到课堂。",
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
      section("自检清单", taskGuidance[input.task].checklist),
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

function buildPptDesignPageSections(input: AgentRuntimeInput) {
  const topic = input.projectContext.topic;
  const pagePlans = [
    ["课题与生活情境开场", `主标题《${topic}》，副标题“从生活问题开始观察”。`],
    ["导入问题", "核心问题“你发现了哪些变化？”和两条学生表达占位。"],
    ["学生猜想", "追问“这些变化能不能用同一种方式描述？”并保留学生猜想。"],
    ["概念探究一", `问题“生活情境里哪里出现了${topic}？”并标出观察入口。`],
    ["概念探究二", "问题“这些数量之间有什么对应关系？”并保留比较提示。"],
    ["例题拆解", "只呈现例题条件、关键数量和教师追问。"],
    ["板书同步", "呈现学生表达到规范表达的板书路径。"],
    ["课堂小结前检查", "用一个辨析问题检查学生是否真正理解。"],
    ["基础练习", "展示一道基础题和学生口答提示。"],
    ["迁移练习", "展示生活迁移题和小组讨论任务。"],
    ["课堂总结", `用三句话收束${topic}的意义、表达和应用。`],
    ["课后延伸", "提出一个可带回生活观察的问题。"],
  ];

  return pagePlans.map(([title, text], index) => section(`第 ${index + 1} 页四层设计`, [
    `底图：纯白背景配浅色分区，围绕“${title}”保留教师讲解和学生观察空间。`,
    "元素：问题气泡、数量关系线、学生回答框和必要的板书框，不超过三类核心元素。",
    `文字：${text}`,
    "排版：左侧放问题，右侧放材料，下方留学生操作区，视觉焦点按课堂提问顺序推进。",
  ]));
}

function formatDuration(input: AgentRuntimeInput): string {
  return input.projectContext.lessonDurationMinutes
    ? `${input.projectContext.lessonDurationMinutes} 分钟`
    : "待补充";
}
