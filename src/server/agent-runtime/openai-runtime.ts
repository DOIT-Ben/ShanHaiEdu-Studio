import type {
  AgentArtifactDraft,
  AgentRuntime,
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
  };
  nextSuggestedAction: {
    label: string;
  };
};

export class OpenAIRuntime implements AgentRuntime {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;

  constructor(options: OpenAIRuntimeOptions) {
    this.client = options.client;
    this.model = options.model;
    this.nativeToolLoop = options.nativeToolLoop;
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    try {
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: this.model });
      const request = buildOpenAIResponseRequest(input);
      const assistantText = await this.createAssistantText(adapter, request, input);
      const parsed = parseStructuredOutput(assistantText, input.task);

      return buildSucceededResult(input, parsed);
    } catch {
      return buildFailedResult(input);
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
      throw new Error("OpenAI native tool loop did not complete");
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

export function buildOpenAIResponseRequest(input: AgentRuntimeInput, _model?: string): OpenAIResponsePayload {
  return {
    instructions: [
      "你是山海课伴的小学数学公开课备课助手。",
      "只生成面向教师可阅读的 Markdown 文本产物。",
      "不要输出工程实现细节、密钥、调试信息、本地路径或底层错误。",
      "如果是导入视频方案，必须保持独立创意，不提前讲知识点结论，并通过课程锚点回到课堂。",
      "如果是视频工作流任务，必须按知识锚点、创意主题、视频脚本、分镜、资产、每镜头时长、课堂边界约束逐步生成；缺分镜或资产图时不得调用视频生成服务。",
      "如果是最终视频组装，只允许只拼接：按分镜顺序拼接已校验片段，不重排、不加转场、不加滤镜、不重写内容。",
      "如果是 PPT 设计稿，必须输出逐页四层 PPT 设计稿，并逐页写清底图、元素、文字、排版。",
      "artifactDraft.markdown 必须包含任务必备字段，并以 ## 自检清单 结尾。",
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
      approvedArtifacts: input.approvedArtifacts.map((artifact) => ({
        nodeKey: artifact.nodeKey,
        title: artifact.title,
        summary: artifact.summary,
        markdownExcerpt: createMarkdownExcerpt(artifact.markdown),
      })),
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
    throw new Error("Missing model output");
  }

  const parsed = JSON.parse(outputText) as Partial<StructuredRuntimeOutput>;
  assertNonEmptyString(parsed.assistantMessage?.title);
  assertNonEmptyString(parsed.assistantMessage?.body);
  assertNonEmptyString(parsed.artifactDraft?.title);
  assertNonEmptyString(parsed.artifactDraft?.summary);
  assertNonEmptyString(parsed.artifactDraft?.markdown);
  assertNonEmptyString(parsed.nextSuggestedAction?.label);
  assertMarkdownMeetsTaskGuidance(parsed.artifactDraft.markdown, task);

  return parsed as StructuredRuntimeOutput;
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid model output");
  }
}

function assertMarkdownMeetsTaskGuidance(markdown: string, task: AgentRuntimeTask): void {
  const guidance = taskGuidance[task];
  const missingField = guidance.requiredFields.find((field) => !markdown.includes(field));

  if (missingField || !markdown.includes("## 自检清单")) {
    throw new Error("Model output missed required teacher review sections");
  }
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

function buildFailedResult(input: AgentRuntimeInput): AgentRuntimeResult {
  return {
    status: "failed",
    run: {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      runtimeKind: "openai",
      status: "failed",
    },
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
      required: ["title", "summary", "markdown"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        markdown: { type: "string" },
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
