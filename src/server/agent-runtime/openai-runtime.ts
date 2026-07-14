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
  createPptDesignCandidateProjection,
  type PptDesignCandidateInput,
} from "@/server/ppt-quality/ppt-design-candidate";
import { createStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { createVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";

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

type OpenAIResponse = {
  output_text?: string;
};

export type OpenAIResponsesClient = {
  responses: {
    create(payload: Record<string, unknown>): Promise<OpenAIResponse>;
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
    markdown: string;
    structuredContentJson?: string | null;
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
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: this.model });
      const request = buildOpenAIResponseRequest(input, this.reasoningEffort);
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
  return {
    reasoning: { effort: reasoningEffort },
    instructions: [
      "你是山海课伴的小学数学公开课备课助手。",
      "每个任务都生成面向教师可阅读的 Markdown 审阅层；需要机器执行的专业任务还要同时返回对应结构化内容。",
      "不要输出工程实现细节、密钥、调试信息、本地路径或底层错误。",
      "如果是导入视频方案，必须保持独立创意，不提前讲知识点结论，并通过课程锚点回到课堂。",
      "如果是视频工作流任务，先让独立创意短片脱离教材仍能成立，再用唯一最小课程锚点回接课程任务；不得从教案知识点反推或限制创意主题。视频脚本之后仍按分镜、资产、每镜头时长和课堂边界约束推进；缺分镜或资产图时不得调用视频生成服务。",
      "如果是最终视频组装，只允许只拼接：按分镜顺序拼接已校验片段，不重排、不加转场、不加滤镜、不重写内容。",
      "如果是 PPT 设计稿，输出逐页紧凑设计候选；逐页只写清目标引用、叙事职责、教师动作、结论式标题和主视觉意图，不得使用页码范围或通用占位描述。",
      "如果任务是 ppt_design，只把 ppt-design-candidate.v1 写入 artifactDraft.structuredContentJson 的 pptDesignCandidate；不要输出完整生产页面结构、样张计划、可编辑图层或生产检查，不要计算 candidateDigest，服务端只验证任务语义、证据绑定和最低逐页结构。",
      "如果任务是 storyboard_generate，还必须把完整 video-storyboard.v1 作为 videoStoryboardManifest 写入 artifactDraft.structuredContentJson；Full Intro要在intent.targetDurationRange声明30-60秒的目标总时长（教师明确要求时可在30-90秒内调整），镜头数由叙事决定，但每镜头时长总和必须完整覆盖目标；镜头要形成钩子、目标、阻碍、变化和结尾悬念，不能只重复展示同一状态。参考资产此时只声明需求，不得伪造尚未生成的文件哈希。其他任务写 null。",
      "如果任务是 video_script_generate，还必须把受控中文旁白作为 videoNarrationScript 写入 artifactDraft.structuredContentJson；旁白只能制造悬念并完成唯一课程回接，不得提前解释答案。",
      "artifactDraft.markdown 必须包含任务必备字段，并以 ## 自检清单 结尾。",
      "taskGuidance.requiredFields 中的每个字段名都必须逐字作为二级标题写入 artifactDraft.markdown，格式为 ## 字段名；不得用同义标题替代。",
      "taskInput 是服务端为当前业务 Tool 绑定的步骤输入，包含 TaskBrief、强度和已知默认时必须作为权威输入使用。年级、学科、课题、页数范围或其他可从 taskInput、projectContext、userMessage 与可信上游产物推断的信息，不得再次向教师询问；缺少教材版本、页码或照片时使用明确标注、可修改且不伪造教材证据的通用课程默认继续。",
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
        schema: runtimeOutputJsonSchema,
      },
    },
  };
}

function parseStructuredOutput(outputText: string | undefined, task: AgentRuntimeTask): StructuredRuntimeOutput {
  if (!outputText) {
    throw new RuntimeFailureError("missing_field", true);
  }

  let parsed: Partial<StructuredRuntimeOutput>;
  try {
    parsed = JSON.parse(outputText) as Partial<StructuredRuntimeOutput>;
  } catch {
    throw new RuntimeFailureError("parse", true);
  }
  assertNonEmptyString(parsed.assistantMessage?.title);
  assertNonEmptyString(parsed.assistantMessage?.body);
  assertNonEmptyString(parsed.artifactDraft?.title);
  assertNonEmptyString(parsed.artifactDraft?.summary);
  assertNonEmptyString(parsed.artifactDraft?.markdown);
  assertNonEmptyString(parsed.nextSuggestedAction?.label);
  assertMarkdownMeetsTaskGuidance(parsed.artifactDraft.markdown, task);

  parsed.artifactDraft.structuredContent = parseStructuredContent(
    parsed.artifactDraft.structuredContentJson,
    task,
  );

  return parsed as StructuredRuntimeOutput;
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeFailureError("missing_field", true);
  }
}

function assertMarkdownMeetsTaskGuidance(markdown: string, task: AgentRuntimeTask): void {
  const guidance = taskGuidance[task];
  const missingField = guidance.requiredFields.find((field) => !markdown.includes(field));

  if (missingField || !markdown.includes("## 自检清单")) {
    throw new RuntimeFailureError("validation", true);
  }
}

function parseStructuredContent(
  structuredContentJson: string | null | undefined,
  task: AgentRuntimeTask,
): Record<string, unknown> | undefined {
  if (structuredContentJson === null || structuredContentJson === undefined) {
    if (task === "ppt_design" || task === "storyboard_generate" || task === "video_script_generate") {
      throw new RuntimeFailureError("missing_field", true);
    }
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(structuredContentJson) as unknown;
  } catch {
    throw new RuntimeFailureError("parse", true);
  }
  if (!isRecord(parsed)) throw new RuntimeFailureError("validation", true);
  if (task === "storyboard_generate") {
    const manifest = parsed.videoStoryboardManifest;
    if (!isRecord(manifest)) throw new RuntimeFailureError("missing_field", true);
    const { manifestDigest: _untrustedDigest, ...semantic } = manifest as unknown as StoryboardManifest;
    const validatedManifest = createStoryboardManifest(semantic);
    return { ...parsed, videoStoryboardManifest: validatedManifest };
  }
  if (task === "video_script_generate") {
    const script = parsed.videoNarrationScript;
    if (!isRecord(script)) throw new RuntimeFailureError("missing_field", true);
    const { scriptDigest: _untrustedDigest, ...semantic } = script as unknown as VideoNarrationScript;
    return { ...parsed, videoNarrationScript: createVideoNarrationScript(semantic) };
  }
  if (task !== "ppt_design") return parsed;

  const candidateValue = parsed.pptDesignCandidate;
  if (!isRecord(candidateValue)) throw new RuntimeFailureError("missing_field", true);
  let projection;
  try {
    projection = createPptDesignCandidateProjection(candidateValue as PptDesignCandidateInput);
  } catch {
    throw new RuntimeFailureError("validation", true);
  }
  return {
    ...parsed,
    pptDesignCandidate: projection.candidate,
  };
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
      shotRequiredFields: ["shotId", "ordinal", "durationTargetRange", "sceneFunction", "mainSubject", "subjectAction", "cameraMotion", "continuityKeys", "startFrameIntent", "endFrameIntent", "referencePolicy", "referenceAssetIds", "textPolicy", "modelPrompt", "negativePrompt", "retakeVariables"],
      invariants: [
        "full_intro intent.targetDurationRange is normally 30-60 seconds and must stay within 30-90 seconds",
        "full_intro requires at least three shots with continuous ordinals starting at 1; shot count is chosen by narrative needs, not fixed globally",
        "the sum of shot minimum durations covers the target minimum and the sum of shot maximum durations does not exceed the target maximum",
        "shots form a complete hook, goal, obstacle, change, and unresolved ending rather than repeated display states",
        "shotId uses shot_N or shot_name and is unique",
        "courseAnchor is the single minimal return to the course, not the whole story world",
        "references declare future video-domain asset needs and applicable shotIds; omit sha256 until a real file exists",
        "do not calculate manifestDigest; the product contract computes and binds it after validation",
      ],
    };
  }
  if (task !== "ppt_design") return null;
  return {
    field: "artifactDraft.structuredContentJson",
    encoding: "JSON string",
    root: "pptDesignCandidate",
    schemaVersion: "ppt-design-candidate.v1",
    requiredSections: [
      "taskBriefDigest",
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
      evidenceBinding: ["evidenceId", "sourceArtifactId", "sourceType", "pageRefs", "claims", "digest"],
      objective: ["objectiveId", "statement", "evidenceRefs"],
      narrative: ["openingTension", "learningProgression", "closingResolution"],
    },
    invariants: [
      "pageNumber is continuous from 1 and pagePlans length equals brief.targetSlideCount",
      "taskBriefDigest and evidence binding digests copy the supplied TaskBrief and approved artifacts exactly",
      "each page advances a distinct learning action and visual event; generic ordinal titles and placeholder plans are forbidden",
      "production PageSpec, editable layers, sample planning, and provider gates belong to the later production design expansion stage",
      "do not calculate candidateDigest; the product computes it after validation",
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
    markdown: sanitizeRuntimeTeacherText(parsed.artifactDraft.markdown),
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
  constructor(readonly category: AgentRuntimeFailure["category"], readonly retryable: boolean) {
    super(category);
    this.name = "RuntimeFailureError";
  }
}

function classifyRuntimeFailure(error: unknown): AgentRuntimeFailure {
  if (error instanceof RuntimeFailureError) {
    return { category: error.category, retryable: error.retryable };
  }
  return { category: classifyProviderDiagnostic(error instanceof Error ? error.message : String(error)), retryable: true };
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
