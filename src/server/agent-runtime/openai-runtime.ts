import type {
  AgentArtifactDraft,
  AgentRuntime,
  AgentRuntimeFailure,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentRuntimeTask,
} from "./types";
import { taskGuidance } from "./task-guidance";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { runOpenAIToolCallLoop } from "@/server/gpt-protocol/openai-tool-loop-runner";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import type { GptProtocolRequest } from "@/server/gpt-protocol/types";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import {
  normalizePptDesignSemanticCandidate,
} from "@/server/ppt-quality/ppt-design-candidate";
import { createStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { createVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";

type OpenAIResponsePayload = GptProtocolRequest & {
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

export type OpenAIResponsesClient = {
  responses: {
    create(payload: Record<string, unknown>): Promise<unknown>;
  };
};

export type OpenAIRuntimeNativeToolLoopOptions = {
  tools: unknown;
  allowedToolNames: readonly string[];
  toolRouter: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  buildToolRouterInput: (intent: ToolCallIntent, runtimeInput: AgentRuntimeInput) => ToolRouterInput;
  maxToolRounds?: number;
};

export type OpenAIRuntimeNativeToolLoopResolver = (
  input: AgentRuntimeInput,
) => OpenAIRuntimeNativeToolLoopOptions | undefined;

export type OpenAIRuntimeOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;
};

type StructuredRuntimeOutput = {
  assistantMessage: {
    title: string;
    body: string;
  };
  artifactDraft: {
    title: string;
    summary: string;
    markdown?: string;
    structuredContentJson?: string | null;
    videoStoryboardManifest?: unknown;
    structuredContent?: Record<string, unknown>;
  };
  nextSuggestedAction: {
    label: string;
  };
};

export class OpenAIRuntime implements AgentRuntime {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly reasoningEffort: "low" | "medium" | "high" | "xhigh";
  private readonly nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;

  constructor(options: OpenAIRuntimeOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
    this.nativeToolLoop = options.nativeToolLoop;
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    try {
      const strategy = input.taskInput && Object.hasOwn(input.taskInput, "generationIntensity")
        ? resolveGenerationIntensityStrategy(input.taskInput.generationIntensity)
        : null;
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: strategy?.model ?? this.model });
      const request = buildOpenAIResponseRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort);
      const assistantText = await this.createAssistantText(adapter, request, input);
      const parsed = parseStructuredOutput(assistantText, input.task);

      return buildSucceededResult(input, parsed);
    } catch (error) {
      return buildFailedResult(input, classifyRuntimeFailure(error));
    }
  }

  private async createAssistantText(
    adapter: ReturnType<typeof createOpenAIResponsesGptAdapter>,
    request: OpenAIResponsePayload,
    input: AgentRuntimeInput,
  ): Promise<string> {
    const nativeToolLoop = resolveNativeToolLoop(this.nativeToolLoop, input);
    if (!isNativeToolLoopEnabled(nativeToolLoop)) {
      const response = await adapter.createResponse(request);
      if (response.diagnostics.status === "failed") {
        throw new RuntimeFailureError(classifyProviderDiagnostic(response.diagnostics.errorMessage), true);
      }
      return response.assistantText;
    }

    const loopResult = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools: nativeToolLoop.tools,
      allowedToolNames: nativeToolLoop.allowedToolNames,
      context: input,
      buildToolRouterInput: nativeToolLoop.buildToolRouterInput,
      toolRouter: nativeToolLoop.toolRouter,
      maxToolRounds: nativeToolLoop.maxToolRounds,
    });

    if (loopResult.status !== "completed") {
      const category = loopResult.diagnostics.reason === "tool_call_not_ready" ? "validation" : "provider";
      throw new RuntimeFailureError(category, category === "provider");
    }

    return loopResult.assistantText;
  }
}

function resolveNativeToolLoop(
  nativeToolLoop: OpenAIRuntimeOptions["nativeToolLoop"],
  input: AgentRuntimeInput,
): OpenAIRuntimeNativeToolLoopOptions | undefined {
  if (typeof nativeToolLoop === "function") {
    return nativeToolLoop(input);
  }

  return nativeToolLoop;
}

export function buildOpenAIResponseRequest(input: AgentRuntimeInput, reasoningEffort: "low" | "medium" | "high" | "xhigh" = "high"): OpenAIResponsePayload {
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

function parseStructuredOutput(outputText: string | undefined, task: AgentRuntimeTask): StructuredRuntimeOutput {
  if (!outputText) {
    throw new RuntimeFailureError("missing_field", true, "runtime_output_missing");
  }

  let parsed: Partial<StructuredRuntimeOutput>;
  try {
    parsed = JSON.parse(outputText) as Partial<StructuredRuntimeOutput>;
  } catch {
    throw new RuntimeFailureError("parse", true, "runtime_output_json_invalid");
  }
  assertNonEmptyString(parsed.assistantMessage?.title);
  assertNonEmptyString(parsed.assistantMessage?.body);
  assertNonEmptyString(parsed.artifactDraft?.title);
  assertNonEmptyString(parsed.artifactDraft?.summary);
  assertNonEmptyString(parsed.nextSuggestedAction?.label);
  if (task === "storyboard_generate") {
    const manifest = normalizeStoryboardManifestCandidate(parsed.artifactDraft.videoStoryboardManifest);
    parsed.artifactDraft.structuredContent = { videoStoryboardManifest: manifest };
    parsed.artifactDraft.markdown = renderStoryboardMarkdown(manifest);
    return parsed as StructuredRuntimeOutput;
  }
  assertNonEmptyString(parsed.artifactDraft?.markdown);
  assertMarkdownMeetsTaskGuidance(parsed.artifactDraft.markdown, task);

  parsed.artifactDraft.structuredContent = parseStructuredContent(
    parsed.artifactDraft.structuredContentJson,
    task,
  );

  return parsed as StructuredRuntimeOutput;
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeFailureError("missing_field", true, "runtime_output_required_text_missing");
  }
}

function assertMarkdownMeetsTaskGuidance(markdown: string, task: AgentRuntimeTask): void {
  const guidance = taskGuidance[task];
  const missingField = guidance.requiredFields.find((field) => !markdown.includes(field));

  if (missingField || !markdown.includes("## 自检清单")) {
    throw new RuntimeFailureError(
      "validation",
      true,
      "runtime_markdown_contract_invalid",
      missingField ? [missingField] : ["self_check_missing"],
    );
  }
}

function parseStructuredContent(
  structuredContentJson: string | null | undefined,
  task: AgentRuntimeTask,
): Record<string, unknown> | undefined {
  if (structuredContentJson === null || structuredContentJson === undefined) {
    if (task === "ppt_design" || task === "storyboard_generate" || task === "video_script_generate") {
      throw new RuntimeFailureError(
        "missing_field",
        true,
        task === "ppt_design" ? "ppt_design_candidate_missing" : "runtime_structured_content_missing",
      );
    }
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(structuredContentJson) as unknown;
  } catch {
    throw new RuntimeFailureError("parse", true, "runtime_structured_content_json_invalid");
  }
  if (!isRecord(parsed)) throw new RuntimeFailureError("validation", true, "runtime_structured_content_invalid");
  if (task === "storyboard_generate") {
    const manifest = parsed.videoStoryboardManifest;
    if (!isRecord(manifest)) throw new RuntimeFailureError("missing_field", true, "storyboard_candidate_missing");
    const validatedManifest = normalizeStoryboardManifestCandidate(manifest);
    return { ...parsed, videoStoryboardManifest: validatedManifest };
  }
  if (task === "video_script_generate") {
    const script = parsed.videoNarrationScript;
    if (!isRecord(script)) throw new RuntimeFailureError("missing_field", true, "video_script_candidate_missing");
    const semantic = { ...script }; delete semantic.scriptDigest;
    return { ...parsed, videoNarrationScript: createVideoNarrationScript(semantic as Omit<VideoNarrationScript, "scriptDigest">) };
  }
  if (task !== "ppt_design") return parsed;

  const candidateValue = parsed.pptDesignCandidate;
  if (!isRecord(candidateValue)) throw new RuntimeFailureError("missing_field", true, "ppt_design_candidate_missing");
  try {
    const semanticCandidate = normalizePptDesignSemanticCandidate(candidateValue);
    return {
      ...parsed,
      pptDesignCandidate: semanticCandidate,
    };
  } catch (error) {
    throw new RuntimeFailureError(
      "validation",
      true,
      "ppt_design_candidate_semantics_invalid",
      extractPptCandidateValidationDetails(error),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isNativeToolLoopEnabled(options: OpenAIRuntimeNativeToolLoopOptions | undefined): options is OpenAIRuntimeNativeToolLoopOptions {
  return (
    options !== undefined &&
    options.tools !== undefined &&
    Array.isArray(options.allowedToolNames) &&
    options.allowedToolNames.length > 0 &&
    typeof options.toolRouter === "function" &&
    typeof options.buildToolRouterInput === "function"
  );
}

function buildSucceededResult(input: AgentRuntimeInput, parsed: StructuredRuntimeOutput): AgentRuntimeResult {
  const artifactDraft: AgentArtifactDraft = {
    nodeKey: input.task,
    kind: input.task,
    title: sanitizeRuntimeTeacherText(parsed.artifactDraft.title),
    summary: sanitizeRuntimeTeacherText(parsed.artifactDraft.summary),
    markdown: sanitizeRuntimeTeacherText(parsed.artifactDraft.markdown!),
    contentType: "text/markdown",
    generationMode: "model_generated",
    isReadyForTeacherReview: true,
    structuredContent: parsed.artifactDraft.structuredContent,
  };

  return {
    status: "succeeded",
    run: {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      runtimeKind: "openai",
      status: "succeeded",
    },
    assistantMessage: {
      title: sanitizeRuntimeTeacherText(parsed.assistantMessage.title),
      body: sanitizeRuntimeTeacherText(parsed.assistantMessage.body),
    },
    artifactDraft,
    nextSuggestedAction: {
      type: "review_artifact",
      label: sanitizeRuntimeTeacherText(parsed.nextSuggestedAction.label),
    },
  };
}

function sanitizeRuntimeTeacherText(value: string): string {
  return value
    .replace(/(["'])(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt|Volumes)\/)[^"']+\1/g, "$1[已隐藏]$1")
    .replace(/file:\/\/\/?[^^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;，。)）]+?\.(?:json|log|txt|pptx|md|png|jpe?g|mp4|db)\b/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;，。)）]+/g, "[已隐藏]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt|Volumes)\/[^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/Bearer\s+[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b(?:projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|OPENAI_API_KEY|api\s+key|api[_-]?key|apikey|credential|token|secret|baseURL|localOutput|sha256)\s*[:=]\s*[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/https?:\/\/[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[已隐藏]")
    .replace(/\b(?:providerPayload|provider|schema|debug|local\s+path|API|artifactKind|nodeKey|capabilityId|toolId|projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|function_call|review_artifact|create_[a-z_]+|generate_[a-z_]+|extract_[a-z_]+|plan_[a-z_]+)\b/gi, "[已隐藏]");
}

function buildFailedResult(input: AgentRuntimeInput, failure: AgentRuntimeFailure = { category: "unknown", retryable: true }): AgentRuntimeResult {
  return {
    status: "failed",
    run: {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      runtimeKind: "openai",
      status: "failed",
    },
    failure,
    assistantMessage: {
      title: "本次生成没有完成",
      body: "已保留你当前输入和已确认内容。建议稍后重试；如果连续失败，可以先缩短需求描述或补充教材内容后再生成。",
    },
    nextSuggestedAction: {
      type: "retry",
      label: "重试本次生成",
    },
  };
}

class RuntimeFailureError extends Error {
  constructor(
    readonly category: AgentRuntimeFailure["category"],
    readonly retryable: boolean,
    readonly reasonCode?: string,
    readonly details: string[] = [],
  ) {
    super(reasonCode ?? category);
    this.name = "RuntimeFailureError";
  }
}

function classifyRuntimeFailure(error: unknown): AgentRuntimeFailure {
  if (error instanceof RuntimeFailureError) {
    const reasonCode = error.reasonCode ?? providerRuntimeReasonCode(error.category);
    return {
      category: error.category,
      retryable: error.retryable,
      ...(reasonCode ? { reasonCode } : {}),
      ...(error.details.length ? { details: [...error.details] } : {}),
    };
  }
  const category = classifyProviderDiagnostic(error instanceof Error ? error.message : String(error));
  return {
    category,
    retryable: true,
    reasonCode: category === "timeout"
      ? "agent_runtime_timeout"
      : category === "network" ? "agent_runtime_network_failed" : "agent_runtime_provider_failed",
  };
}

function providerRuntimeReasonCode(category: AgentRuntimeFailure["category"]): string | undefined {
  if (category === "timeout") return "agent_runtime_timeout";
  if (category === "network") return "agent_runtime_network_failed";
  if (category === "provider") return "agent_runtime_provider_failed";
  return undefined;
}

function extractPptCandidateValidationDetails(error: unknown): string[] {
  if (!(error instanceof Error)) return [];
  const marker = "ppt_design_candidate_semantics_invalid:";
  const start = error.message.indexOf(marker);
  if (start < 0) return [];
  return [...new Set(error.message
    .slice(start + marker.length)
    .split(",")
    .map((detail) => detail.trim())
    .filter((detail) => /^[a-z0-9_:-]{1,120}$/.test(detail)))]
    .slice(0, 12);
}

function classifyProviderDiagnostic(message: string | undefined): AgentRuntimeFailure["category"] {
  const normalized = message?.toLowerCase() ?? "";
  if (/timeout|timed out|deadline|aborterror/.test(normalized)) return "timeout";
  if (/econnreset|econnrefused|enotfound|dns|network|fetch failed|socket|disconnected/.test(normalized)) return "network";
  return "provider";
}

function createMarkdownExcerpt(markdown: string): string {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}

const runtimeOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "artifactDraft", "nextSuggestedAction"],
  properties: {
    assistantMessage: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    artifactDraft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "markdown", "structuredContentJson"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        markdown: { type: "string" },
        structuredContentJson: {
          anyOf: [
            { type: "string" },
            { type: "null" },
          ],
        },
      },
    },
    nextSuggestedAction: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: {
        label: { type: "string" },
      },
    },
  },
};

function runtimeOutputJsonSchemaFor(task: AgentRuntimeTask) {
  return task === "storyboard_generate" ? storyboardRuntimeOutputJsonSchema : runtimeOutputJsonSchema;
}

const durationRangeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["minSeconds", "maxSeconds"],
  properties: {
    minSeconds: { type: "integer" },
    maxSeconds: { type: "integer" },
  },
} as const;

const storyboardRuntimeOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "artifactDraft", "nextSuggestedAction"],
  properties: {
    assistantMessage: runtimeOutputJsonSchema.properties.assistantMessage,
    artifactDraft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "videoStoryboardManifest"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        videoStoryboardManifest: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "intent", "shots", "references"],
          properties: {
            schemaVersion: { type: "string", const: "video-storyboard.v1" },
            intent: {
              type: "object",
              additionalProperties: false,
              required: ["schemaVersion", "productionPath", "videoMode", "targetDurationRange", "courseAnchor", "classroomReturnQuestion", "answerDisclosureBoundary"],
              properties: {
                schemaVersion: { type: "string", const: "video-intent.v1" },
                productionPath: { type: "string", enum: ["video_short_preview", "video_full_intro"] },
                videoMode: { type: "string", enum: ["short_preview", "full_intro"] },
                targetDurationRange: durationRangeSchema,
                courseAnchor: { type: "string" },
                classroomReturnQuestion: { type: "string" },
                answerDisclosureBoundary: { type: "string" },
              },
            },
            shots: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["shotId", "ordinal", "durationTargetRange", "sceneFunction", "mainSubject", "subjectAction", "cameraMotion", "continuityKeys", "startFrameIntent", "endFrameIntent", "referencePolicy", "textPolicy", "modelPrompt", "negativePrompt", "retakeVariables"],
                properties: {
                  shotId: { type: "string" },
                  ordinal: { type: "integer" },
                  durationTargetRange: durationRangeSchema,
                  sceneFunction: { type: "string" },
                  mainSubject: { type: "string" },
                  subjectAction: { type: "string" },
                  cameraMotion: { type: "string" },
                  continuityKeys: { type: "array", items: { type: "string" } },
                  startFrameIntent: { type: "string" },
                  endFrameIntent: { type: "string" },
                  referencePolicy: { type: "string", enum: ["required", "recommended", "none"] },
                  textPolicy: { type: "string", enum: ["no_generated_text", "post_production_only"] },
                  modelPrompt: { type: "string" },
                  negativePrompt: { type: "string" },
                  retakeVariables: { type: "array", items: { type: "string" } },
                },
              },
            },
            references: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["assetId", "assetDomain", "sha256", "applicableShotIds", "purpose"],
                properties: {
                  assetId: { type: "string" },
                  assetDomain: { type: "string", const: "video" },
                  sha256: { type: ["string", "null"] },
                  applicableShotIds: { type: "array", items: { type: "string" } },
                  purpose: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    nextSuggestedAction: runtimeOutputJsonSchema.properties.nextSuggestedAction,
  },
} as const;

function normalizeStoryboardManifestCandidate(value: unknown): StoryboardManifest {
  if (!isRecord(value)) throw new RuntimeFailureError("missing_field", true, "storyboard_candidate_missing");
  const candidate = { ...value }; delete candidate.manifestDigest;
  const references = Array.isArray(candidate.references)
    ? candidate.references.map((reference) => {
        if (!isRecord(reference)) return reference;
        const { sha256, ...rest } = reference;
        return typeof sha256 === "string" && sha256.trim() ? { ...rest, sha256 } : rest;
      })
    : candidate.references;
  const shots = Array.isArray(candidate.shots)
    ? candidate.shots.map((shot) => {
        if (!isRecord(shot)) return shot;
        const shotId = typeof shot.shotId === "string" ? shot.shotId : "";
        const referenceAssetIds = Array.isArray(references)
          ? references.filter((reference) => isRecord(reference) && Array.isArray(reference.applicableShotIds) && reference.applicableShotIds.includes(shotId))
              .map((reference) => String((reference as Record<string, unknown>).assetId ?? ""))
              .filter(Boolean)
          : [];
        return { ...shot, referenceAssetIds };
      })
    : candidate.shots;
  try {
    return createStoryboardManifest({ ...candidate, shots, references } as Omit<StoryboardManifest, "manifestDigest">);
  } catch (error) {
    const details = error instanceof Error && error.message.includes(":")
      ? error.message.slice(error.message.indexOf(":") + 1).split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    throw new RuntimeFailureError("validation", true, "storyboard_candidate_invalid", details);
  }
}

function renderStoryboardMarkdown(manifest: StoryboardManifest): string {
  const shots = manifest.shots;
  const shotLines = (render: (shot: StoryboardManifest["shots"][number]) => string) => shots.map((shot) => `- ${shot.shotId}: ${render(shot)}`);
  return [
    "## 目标总时长",
    `${manifest.intent.targetDurationRange.minSeconds}-${manifest.intent.targetDurationRange.maxSeconds} 秒。`,
    "",
    "## 分镜 ID",
    ...shots.map((shot) => `- ${shot.shotId}`),
    "",
    "## 每镜头时长",
    ...shotLines((shot) => `${shot.durationTargetRange.minSeconds}-${shot.durationTargetRange.maxSeconds} 秒`),
    "",
    "## 镜头目标",
    ...shotLines((shot) => shot.sceneFunction),
    "",
    "## 场景",
    ...shotLines((shot) => shot.mainSubject),
    "",
    "## 画面动作",
    ...shotLines((shot) => shot.subjectAction),
    "",
    "## 镜头运动",
    ...shotLines((shot) => shot.cameraMotion),
    "",
    "## 旁白或字幕",
    ...shotLines((shot) => shot.ordinal === shots.length
      ? `${manifest.intent.classroomReturnQuestion}（仅结尾回接）`
      : `${shot.sceneFunction}；按受控脚本在本镜头时段对齐`),
    "",
    "## 角色、道具、场景资产",
    ...shotLines((shot) => shot.referenceAssetIds.length ? shot.referenceAssetIds.join("、") : `${shot.mainSubject}（后续资产说明绑定）`),
    "",
    "## 关键帧要求",
    ...shotLines((shot) => `${shot.startFrameIntent} -> ${shot.endFrameIntent}`),
    "",
    "## 连贯性说明",
    ...shotLines((shot) => shot.continuityKeys.join("、")),
    "",
    "## 自检清单",
    `- 独立短片通过唯一课程锚点回接：${manifest.intent.courseAnchor}`,
    `- 答案披露边界：${manifest.intent.answerDisclosureBoundary}`,
    "- 镜头时长、顺序、资产引用和连续性均来自已校验分镜结构。",
  ].join("\n");
}
