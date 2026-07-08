import OpenAI from "openai";
import { pickOpenAICompatibleConfig, type OpenAICompatibleEnv } from "@/server/openai-compatible-config";

export type ConversationIntent = "chat" | "clarify" | "start_requirement";
export type ConversationRuntimeKind = "openai" | "deterministic";

export type ConversationProjectContext = {
  grade?: string | null;
  subject?: string | null;
  topic?: string | null;
  textbookVersion?: string | null;
  teacherGoal?: string | null;
  requestedOutputs?: string[];
};

export type RecentConversationMessage = {
  role: "teacher" | "assistant" | "system";
  content: string;
};

export type ConversationInput = {
  userMessage: string;
  projectContext: ConversationProjectContext;
  artifactRefs: string[];
  recentMessages: RecentConversationMessage[];
};

export type ConversationDecision = {
  intent: ConversationIntent;
  assistantMessage: {
    title?: string;
    body: string;
  };
  shouldGenerateRequirement: boolean;
  normalizedBrief?: {
    grade?: string;
    subject?: string;
    topic?: string;
    requestedOutputs?: string[];
    teacherGoal?: string;
  };
  runtimeKind: ConversationRuntimeKind;
};

type OpenAIConversationResponsePayload = {
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

type OpenAIConversationResponse = {
  output_text?: string;
};

export type OpenAIConversationClient = {
  responses: {
    create(payload: OpenAIConversationResponsePayload): Promise<OpenAIConversationResponse>;
  };
};

export type ConversationOrchestrator = {
  decide(input: ConversationInput): Promise<ConversationDecision>;
};

type OpenAIConversationOrchestratorOptions = {
  client: OpenAIConversationClient;
  model: string;
  fallback: ConversationOrchestrator;
};

export class OpenAIConversationOrchestrator implements ConversationOrchestrator {
  private readonly client: OpenAIConversationClient;
  private readonly model: string;
  private readonly fallback: ConversationOrchestrator;

  constructor(options: OpenAIConversationOrchestratorOptions) {
    this.client = options.client;
    this.model = options.model;
    this.fallback = options.fallback;
  }

  async decide(input: ConversationInput): Promise<ConversationDecision> {
    try {
      const response = await this.client.responses.create(buildOpenAIConversationRequest(input, this.model));
      return {
        ...parseConversationDecision(response.output_text),
        runtimeKind: "openai",
      };
    } catch {
      return this.fallback.decide(input);
    }
  }
}

export function createConversationOrchestratorFromEnv(env: OpenAICompatibleEnv = process.env): ConversationOrchestrator {
  const fallback = createDeterministicConversationOrchestrator();
  const config = pickOpenAICompatibleConfig(env);
  if (!config) {
    return fallback;
  }

  const client = new OpenAI({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout: 20000,
    maxRetries: 0,
  }) as OpenAIConversationClient;

  return new OpenAIConversationOrchestrator({
    client,
    model: config.model,
    fallback,
  });
}

export function createDeterministicConversationOrchestrator(): ConversationOrchestrator {
  return {
    async decide(input: ConversationInput): Promise<ConversationDecision> {
      if (!isExplicitLessonWorkRequest(input.userMessage, input.artifactRefs)) {
        if (isCasualChat(input.userMessage)) {
          return {
            intent: "chat",
            assistantMessage: {
              body: "我在。你可以先随便聊；如果要开始备课，请补充年级、课题、学科和想要的材料。",
            },
            shouldGenerateRequirement: false,
            normalizedBrief: {},
            runtimeKind: "deterministic",
          };
        }

        return {
          intent: "clarify",
          assistantMessage: {
            body: "我先不启动备课链路。你可以补充年级、学科、课题和想要的材料；确认后我再整理成可选择的备课需求。",
          },
          shouldGenerateRequirement: false,
          normalizedBrief: {},
          runtimeKind: "deterministic",
        };
      }

      return {
        intent: "start_requirement",
        assistantMessage: {
          title: "开始整理备课需求",
          body: "我先把这条需求整理成可确认的需求规格，之后再进入教案、PPT 大纲和导入视频方案。",
        },
        shouldGenerateRequirement: true,
        normalizedBrief: normalizeBrief(input),
        runtimeKind: "deterministic",
      };
    },
  };
}

export function buildOpenAIConversationRequest(input: ConversationInput, model: string): OpenAIConversationResponsePayload {
  return {
    model,
    instructions: [
      "你是 ShanHaiEdu 小学公开课备课工作台的对话智能体。",
      "你的任务是先理解教师消息，而不是每句话都启动生成。",
      "把输入分成三类：chat 表示普通寒暄或陪聊；clarify 表示信息不足需要追问；start_requirement 表示教师明确要开始备课材料生成。",
      "只有教师明确提供备课意图、课题、年级、教材、教案、PPT、导入视频等信号时，才使用 start_requirement。",
      "输出必须面向教师自然可读，不要出现 API、provider、schema、debug、baseURL、密钥、本地路径或底层错误。",
      "返回内容必须严格符合指定 JSON 结构。",
    ].join("\n"),
    input: JSON.stringify({
      userMessage: input.userMessage,
      projectContext: input.projectContext,
      artifactRefs: input.artifactRefs,
      recentMessages: input.recentMessages.slice(-8),
    }),
    text: {
      format: {
        type: "json_schema",
        name: "shanhai_conversation_decision",
        strict: true,
        schema: conversationDecisionJsonSchema,
      },
    },
  };
}

function parseConversationDecision(outputText: string | undefined): Omit<ConversationDecision, "runtimeKind"> {
  if (!outputText) {
    throw new Error("Missing conversation output");
  }

  const parsed = JSON.parse(outputText) as Partial<ConversationDecision>;
  const intent = parsed.intent;
  if (intent !== "chat" && intent !== "clarify" && intent !== "start_requirement") {
    throw new Error("Invalid conversation intent");
  }

  if (typeof parsed.assistantMessage?.body !== "string" || parsed.assistantMessage.body.trim().length === 0) {
    throw new Error("Invalid assistant message");
  }

  if (typeof parsed.shouldGenerateRequirement !== "boolean") {
    throw new Error("Invalid generation decision");
  }

  if (intent === "start_requirement" && !parsed.shouldGenerateRequirement) {
    throw new Error("Inconsistent start requirement decision");
  }

  if (intent !== "start_requirement" && parsed.shouldGenerateRequirement) {
    throw new Error("Inconsistent non-generation decision");
  }

  return {
    intent,
    assistantMessage: {
      title: typeof parsed.assistantMessage.title === "string" && parsed.assistantMessage.title.trim()
        ? parsed.assistantMessage.title.trim()
        : undefined,
      body: parsed.assistantMessage.body.trim(),
    },
    shouldGenerateRequirement: parsed.shouldGenerateRequirement,
    normalizedBrief: normalizeParsedBrief(parsed.normalizedBrief),
  };
}

function normalizeParsedBrief(value: unknown): ConversationDecision["normalizedBrief"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const brief = value as Record<string, unknown>;
  return {
    grade: optionalString(brief.grade),
    subject: optionalString(brief.subject),
    topic: optionalString(brief.topic),
    requestedOutputs: Array.isArray(brief.requestedOutputs) ? brief.requestedOutputs.map(String).filter(Boolean) : undefined,
    teacherGoal: optionalString(brief.teacherGoal),
  };
}

function normalizeBrief(input: ConversationInput): ConversationDecision["normalizedBrief"] {
  return {
    grade: extractGrade(input.userMessage) ?? optionalString(input.projectContext.grade),
    subject: extractSubject(input.userMessage) ?? optionalString(input.projectContext.subject),
    topic: extractTopic(input.userMessage) ?? optionalString(input.projectContext.topic),
    requestedOutputs: extractRequestedOutputs(input.userMessage),
    teacherGoal: input.userMessage.trim(),
  };
}

function isCasualChat(content: string): boolean {
  const text = content.trim().toLowerCase();
  return ["你好", "您好", "hi", "hello", "在吗", "在不在", "谢谢", "你是谁"].includes(text);
}

function isExplicitLessonWorkRequest(content: string, artifactRefs: string[]) {
  const text = content.trim();
  if (artifactRefs.length > 0) return true;
  if (text.length < 6) return false;

  const directWorkSignals = [
    "公开课",
    "备课",
    "教案",
    "PPT",
    "ppt",
    "课件",
    "导入视频",
    "教学设计",
    "课堂活动",
  ];
  if (directWorkSignals.some((signal) => text.includes(signal))) return true;

  const hasGrade = Boolean(extractGrade(text));
  const hasSubject = Boolean(extractSubject(text));
  const hasTopic = Boolean(extractTopic(text)) || /课题|教材|版本/.test(text);
  if (hasGrade && (hasSubject || hasTopic)) return true;

  return /做一节|上一节|准备一节|帮我做/.test(text) && (hasSubject || hasGrade || hasTopic);
}

function extractGrade(text: string): string | undefined {
  const match = text.match(/([一二三四五六1-6])年级/);
  return match ? `${match[1]}年级` : undefined;
}

function extractSubject(text: string): string | undefined {
  for (const subject of ["数学", "语文", "英语", "科学", "道德与法治"]) {
    if (text.includes(subject)) return subject;
  }
  return undefined;
}

function extractTopic(text: string): string | undefined {
  for (const marker of ["百分数", "分数", "小数", "乘法", "除法", "面积", "周长"]) {
    if (text.includes(marker)) return marker;
  }
  return undefined;
}

function extractRequestedOutputs(text: string): string[] {
  const outputs = ["需求规格"];
  if (text.includes("教案")) outputs.push("教案");
  if (text.includes("PPT") || text.includes("ppt") || text.includes("课件")) outputs.push("PPT 大纲");
  if (text.includes("导入") || text.includes("视频")) outputs.push("导入视频方案");
  return outputs.length > 1 ? outputs : ["需求规格", "教案", "PPT 大纲", "导入视频方案"];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const conversationDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "assistantMessage", "shouldGenerateRequirement", "normalizedBrief"],
  properties: {
    intent: { type: "string", enum: ["chat", "clarify", "start_requirement"] },
    assistantMessage: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: ["string", "null"] },
        body: { type: "string" },
      },
    },
    shouldGenerateRequirement: { type: "boolean" },
    normalizedBrief: {
      type: "object",
      additionalProperties: false,
      required: ["grade", "subject", "topic", "requestedOutputs", "teacherGoal"],
      properties: {
        grade: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
        topic: { type: ["string", "null"] },
        requestedOutputs: {
          type: "array",
          items: { type: "string" },
        },
        teacherGoal: { type: ["string", "null"] },
      },
    },
  },
};
