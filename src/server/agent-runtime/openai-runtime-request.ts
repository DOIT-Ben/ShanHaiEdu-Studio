import type { AgentRuntimeInput, AgentRuntimeTask } from "./types";
import { taskGuidance } from "./task-guidance";
import { runtimeOutputJsonSchemaFor } from "./openai-runtime-schema";

export type OpenAIResponsePayload = {
  reasoning: { effort: "low" | "medium" | "high" | "xhigh" };
  promptCacheKey: string;
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
};

export function buildOpenAIResponseRequest(
  input: AgentRuntimeInput,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" = "high",
): OpenAIResponsePayload {
  const businessSkillInstructions = input.businessSkillContext
    ? [
        `当前业务 Tool 已由 Main Agent 选择，并绑定业务 Skill ${input.businessSkillContext.skillName}@${input.businessSkillContext.skillVersion}。`,
        "该 Skill 只增强当前 Tool 的专业执行，不得选择、调用或强制下一 Tool。",
        `当前 Tool 专属职责：${input.businessSkillContext.semanticSlice.responsibility}`,
        ...input.businessSkillContext.semanticSlice.guidance.map((guidance) => guidance.content),
      ]
    : [];
  return {
    reasoning: { effort: reasoningEffort },
    promptCacheKey: `shanhai-business-tool:${input.task}:v1`,
    instructions: [
      "你是山海课伴的备课业务 Tool 执行助手，默认角色语境偏向小学公开课。",
      "小学定位不是年级、学科或学段的能力门禁；必须忠实执行 TaskBrief 中合理的初中、高中、大学及其他教育任务，不得改写年级、学科或课题。",
      "每个任务都生成面向教师可阅读的 Markdown 审阅层；需要机器执行的专业任务还要同时返回对应结构化内容。",
      "不要输出工程实现细节、密钥、调试信息、本地路径或底层错误。",
      "如果是导入视频方案，必须保持独立创意，不提前讲知识点结论，并通过课程锚点回到课堂。",
      "如果是视频工作流任务，先让独立创意短片脱离教材仍能成立，再用唯一最小课程锚点回接课程任务；不得从教案知识点反推或限制创意主题。视频脚本之后仍按分镜、资产、每镜头时长和课堂边界约束推进；缺分镜或资产图时不得调用视频生成服务。",
      "如果是最终视频组装，只允许只拼接：按分镜顺序拼接已校验片段，不重排、不加转场、不加滤镜、不重写内容。",
      "如果是 PPT 设计稿，输出逐页紧凑设计候选；逐页只写清目标引用、叙事职责、教师动作、结论式标题和主视觉意图，不得使用页码范围或通用占位描述。",
      "如果任务是 ppt_design，只把 ppt-design-semantic-candidate.v1 写入 artifactDraft.structuredContentJson 的 pptDesignCandidate；不要输出taskBriefDigest、sourceArtifactId、Artifact version/digest或candidateDigest，这些权威字段由服务端基于当前ExecutionEnvelope、TaskBrief和可信PPT大纲绑定。不要输出完整生产页面结构、样张计划、可编辑图层或生产检查。",
      input.task === "storyboard_generate"
        ? "当前任务只生成 artifactDraft.videoStoryboardManifest 单一事实源；不要生成教师Markdown，不要把JSON再次编码为字符串。Full Intro要在intent.targetDurationRange声明30-60秒的目标总时长（教师明确要求时可在30-90秒内调整），镜头数由叙事决定，但每镜头时长总和必须完整覆盖目标；镜头要形成钩子、目标、阻碍、变化和结尾悬念，不能只重复展示同一状态。参考资产此时只声明需求，不得伪造尚未生成的文件哈希。manifestDigest由服务端计算。"
        : "storyboard_generate 之外的任务不输出 videoStoryboardManifest。",
      "如果任务是 video_script_generate，还必须把受控中文旁白作为 videoNarrationScript 写入 artifactDraft.structuredContentJson；旁白只能制造悬念并完成唯一课程回接，不得提前解释答案。",
      ...(input.task === "storyboard_generate" ? [
        "教师Markdown由服务端从已校验videoStoryboardManifest确定性渲染；不得为展示层重复创作内容。",
      ] : [
        "artifactDraft.markdown 必须包含任务必备字段，并以 ## 自检清单 结尾。",
        "taskGuidance.requiredFields 中的每个字段名都必须逐字作为二级标题写入 artifactDraft.markdown，格式为 ## 字段名；不得用同义标题替代。",
      ]),
      "taskInput 是服务端为当前业务 Tool 绑定的步骤输入，包含 TaskBrief、强度和已知默认时必须作为权威输入使用。年级、学科、课题、页数范围或其他可从 taskInput、projectContext、userMessage 与可信上游产物推断的信息，不得再次向教师询问；缺少教材版本、页码或照片时使用明确标注、可修改且不伪造教材证据的通用课程默认继续。",
      ...businessSkillInstructions,
      "返回内容必须严格符合指定 JSON 结构。",
    ].join("\n"),
    input: JSON.stringify({
      task: input.task,
      taskLabel: taskGuidance[input.task].label,
      taskGuidance: {
        requiredFields: taskGuidance[input.task].requiredFields,
        checklist: taskGuidance[input.task].checklist,
      },
      projectContext: input.projectContext,
      userMessage: input.userMessage,
      taskInput: input.taskInput ?? {},
      businessSkill: input.businessSkillContext ? {
        name: input.businessSkillContext.skillName,
        version: input.businessSkillContext.skillVersion,
        responsibility: input.businessSkillContext.responsibility,
        semanticSlice: input.businessSkillContext.semanticSlice,
        provenance: input.businessSkillContext.provenance,
      } : null,
      approvedArtifacts: input.approvedArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        version: artifact.version,
        digest: artifact.digest,
        nodeKey: artifact.nodeKey,
        title: artifact.title,
        summary: artifact.summary,
        markdownExcerpt: createMarkdownExcerpt(artifact.markdown),
      })),
      structuredContentContract: structuredContentContractFor(input.task),
    }),
    text: {
      format: {
        type: "json_schema",
        name: "shanhai_agent_runtime_result",
        strict: true,
        schema: runtimeOutputJsonSchemaFor(input.task),
      },
    },
  };
}

function structuredContentContractFor(task: AgentRuntimeTask): Record<string, unknown> | null {
  if (task === "video_script_generate") {
    return {
      field: "artifactDraft.structuredContentJson",
      encoding: "JSON string",
      root: "videoNarrationScript",
      schemaVersion: "video-narration-script.v1",
      requiredFields: ["schemaVersion", "language=zh-CN", "voiceId", "text", "courseAnchor", "answerDisclosureBoundary"],
      invariants: ["text is 10-500 Chinese characters", "one minimal course return only", "no answer disclosure", "do not calculate scriptDigest; the product computes it"],
    };
  }
  if (task === "storyboard_generate") {
    return {
      field: "artifactDraft.structuredContentJson",
      encoding: "JSON string",
      root: "videoStoryboardManifest",
      schemaVersion: "video-storyboard.v1",
      requiredSections: ["intent", "shots", "references"],
      shotRequiredFields: ["shotId", "ordinal", "durationTargetRange", "sceneFunction", "mainSubject", "subjectAction", "cameraMotion", "continuityKeys", "startFrameIntent", "endFrameIntent", "referencePolicy", "textPolicy", "modelPrompt", "negativePrompt", "retakeVariables"],
      invariants: [
        "full_intro intent.targetDurationRange is normally 30-60 seconds and must stay within 30-90 seconds",
        "full_intro requires at least three shots with continuous ordinals starting at 1; shot count is chosen by narrative needs, not fixed globally",
        "the sum of shot minimum durations covers the target minimum and the sum of shot maximum durations does not exceed the target maximum",
        "shots form a complete hook, goal, obstacle, change, and unresolved ending rather than repeated display states",
        "shotId uses shot_N or shot_name and is unique",
        "courseAnchor is the single minimal return to the course, not the whole story world",
        "references declare future video-domain asset needs and applicable shotIds; the server derives each shot referenceAssetIds from that single binding direction; omit sha256 until a real file exists",
        "do not calculate manifestDigest; the product contract computes and binds it after validation",
      ],
    };
  }
  if (task !== "ppt_design") return null;
  return {
    field: "artifactDraft.structuredContentJson",
    encoding: "JSON string",
    root: "pptDesignCandidate",
    schemaVersion: "ppt-design-semantic-candidate.v1",
    requiredSections: [
      "goalSummary",
      "brief",
      "evidenceBindings",
      "objectives",
      "narrative",
      "pagePlans",
      "downstreamUse=production_design_expansion",
    ],
    pagePlanRequiredFields: [
      "pageNumber",
      "objectiveIds",
      "narrativeJob",
      "teachingAction",
      "takeawayTitle",
      "primaryVisualBrief",
    ],
    compactShapes: {
      brief: ["grade", "subject", "topic", "audience", "useCase", "targetSlideCount"],
      evidenceBinding: ["evidenceId", "pageRefs", "claims"],
      objective: ["objectiveId", "statement", "evidenceRefs"],
      narrative: ["openingTension", "learningProgression", "closingResolution"],
    },
    invariants: [
      "pageNumber is continuous from 1 and pagePlans length equals brief.targetSlideCount",
      "the model authors evidence claims only; the server binds TaskBrief and Artifact id/version/digest authority after semantic validation",
      "each page advances a distinct learning action and visual event; generic ordinal titles and placeholder plans are forbidden",
      "production PageSpec, editable layers, sample planning, and provider gates belong to the later production design expansion stage",
      "do not return taskBriefDigest, sourceArtifactId, Artifact version/digest, or candidateDigest",
    ],
  };
}

function createMarkdownExcerpt(markdown: string): string {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}
