import type {
  AgentArtifactDraft,
  AgentRuntime,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentRuntimeTask,
} from "./types";
import { taskGuidance } from "./task-guidance";

type OpenAIResponsePayload = {
  model: string;
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
    create(payload: OpenAIResponsePayload): Promise<OpenAIResponse>;
  };
};

type OpenAIRuntimeOptions = {
  client: OpenAIResponsesClient;
  model: string;
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

  constructor(options: OpenAIRuntimeOptions) {
    this.client = options.client;
    this.model = options.model;
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    try {
      const response = await this.client.responses.create(buildOpenAIResponseRequest(input, this.model));
      const parsed = parseStructuredOutput(response.output_text, input.task);
      const artifactDraft: AgentArtifactDraft = {
        nodeKey: input.task,
        kind: input.task,
        title: parsed.artifactDraft.title,
        summary: parsed.artifactDraft.summary,
        markdown: parsed.artifactDraft.markdown,
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
        assistantMessage: parsed.assistantMessage,
        artifactDraft,
        nextSuggestedAction: {
          type: "review_artifact",
          label: parsed.nextSuggestedAction.label,
        },
      };
    } catch {
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
  }
}

export function buildOpenAIResponseRequest(input: AgentRuntimeInput, model: string): OpenAIResponsePayload {
  return {
    model,
    instructions: [
      "你是 ShanHaiEdu 小学数学公开课备课助手。",
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
