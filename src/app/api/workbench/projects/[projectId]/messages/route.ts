import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import { createConversationOrchestratorFromEnv } from "@/server/conversation/conversation-orchestrator";

const runtime = createAgentRuntimeFromEnv();
const conversationOrchestrator = createConversationOrchestratorFromEnv();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const messages = await service.getMessages(projectId);
      return NextResponse.json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Messages lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目消息暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const body = await request.json();
      const teacherContent = String(body.body ?? body.content ?? "").trim();
      const reference = body.reference ? String(body.reference).trim() : "";
      const content = reference ? `${teacherContent}\n\n引用：${reference}` : teacherContent;
      const message = await service.addMessage(projectId, {
        role: body.role === "assistant" || body.role === "system" ? body.role : "teacher",
        content,
        artifactRefs: Array.isArray(body.artifactRefs) ? body.artifactRefs.map(String) : [],
      });

      if (message.role !== "teacher") {
        return NextResponse.json({ message }, { status: 201 });
      }

      const project = await service.getProject(projectId);
      const recentMessages = await service.getMessages(projectId);
      const conversationDecision = await conversationOrchestrator.decide({
        userMessage: teacherContent,
        artifactRefs: message.artifactRefs,
        projectContext: {
          grade: project.grade,
          subject: project.subject,
          topic: project.lessonTopic,
          textbookVersion: project.textbookVersion,
        },
        recentMessages: recentMessages.map((recentMessage) => ({
          role: recentMessage.role,
          content: recentMessage.content,
        })),
      });
      const pendingTeacherRequest = findPendingTeacherRequest(recentMessages, teacherContent);
      const shouldStartRequirement = conversationDecision.shouldGenerateRequirement || Boolean(isTeacherConfirmation(teacherContent) && pendingTeacherRequest);

      if (!shouldStartRequirement) {
        const assistantMessage = await service.addMessage(projectId, {
          role: "assistant",
          content: formatAssistantContent(conversationDecision.assistantMessage),
        });
        return NextResponse.json({ message, assistantMessage }, { status: 201 });
      }

      if (!isTeacherConfirmation(teacherContent)) {
        const assistantMessage = await service.addMessage(projectId, {
          role: "assistant",
          content: formatRequirementConfirmation(conversationDecision, project),
        });
        return NextResponse.json({ message, assistantMessage }, { status: 201 });
      }

      const generationUserMessage = pendingTeacherRequest ?? teacherContent;
      const result = await runtime.run({
        projectId,
        runId: randomUUID(),
        task: "requirement_spec",
        userMessage: reference ? `${generationUserMessage}\n\n引用：${reference}` : generationUserMessage,
        projectContext: {
          grade: conversationDecision.normalizedBrief?.grade ?? project.grade ?? "五年级",
          subject: conversationDecision.normalizedBrief?.subject ?? project.subject ?? "数学",
          topic: conversationDecision.normalizedBrief?.topic ?? project.lessonTopic ?? "待确认课题",
          textbookVersion: project.textbookVersion ?? undefined,
          teacherGoal: conversationDecision.normalizedBrief?.teacherGoal ?? generationUserMessage,
          requestedOutputs: conversationDecision.normalizedBrief?.requestedOutputs ?? ["需求规格", "教案", "PPT 大纲", "导入视频方案"],
        },
        approvedArtifacts: [],
      });

      const assistantMessage = await service.addMessage(projectId, {
        role: "assistant",
        content:
          result.status === "succeeded"
            ? `${result.assistantMessage.title}\n\n${result.assistantMessage.body}`
            : result.assistantMessage.body,
      });

      if (result.status !== "succeeded") {
        return NextResponse.json({ message, assistantMessage, result }, { status: 201 });
      }

      const artifact = await service.saveArtifact(projectId, {
        nodeKey: "requirement_spec",
        kind: "requirement_spec",
        title: result.artifactDraft.title,
        status: "needs_review",
        summary: result.artifactDraft.summary,
        markdownContent: result.artifactDraft.markdown,
        structuredContent: {
          generationMode: result.artifactDraft.generationMode,
          nextSuggestedAction: result.nextSuggestedAction.label,
        },
      });

      return NextResponse.json({ message, assistantMessage, artifact }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message create failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这条消息暂时没有发送成功，请稍后再试。" }, { status });
    }
  });
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function isTeacherConfirmation(content: string) {
  const text = content.trim();
  return /确认开始|开始生成|直接生成|按默认生成|确认生成|可以生成|开始吧|没问题/.test(text);
}

function findPendingTeacherRequest(messages: { role: "teacher" | "assistant" | "system"; content: string }[], currentContent: string) {
  const candidates = messages
    .filter((message) => message.role === "teacher")
    .map((message) => message.content.trim())
    .filter((content) => content && content !== currentContent && !isTeacherConfirmation(content));
  return candidates.at(-1) ?? null;
}

function formatRequirementConfirmation(
  decision: {
    normalizedBrief?: {
      grade?: string;
      subject?: string;
      topic?: string;
      requestedOutputs?: string[];
      teacherGoal?: string;
    };
  },
  project: {
    grade?: string | null;
    subject?: string | null;
    lessonTopic?: string | null;
    textbookVersion?: string | null;
  },
) {
  const brief = decision.normalizedBrief ?? {};
  const grade = brief.grade ?? project.grade ?? "待补充";
  const subject = brief.subject ?? project.subject ?? "待补充";
  const topic = brief.topic ?? project.lessonTopic ?? "待补充";
  const textbook = project.textbookVersion ?? "可稍后补充";
  const outputs = brief.requestedOutputs?.length ? brief.requestedOutputs : ["需求规格", "教案", "PPT 大纲", "导入视频方案"];
  return [
    "备课任务确认",
    "",
    `我理解你要做的是：${grade}${subject}《${topic}》公开课备课。`,
    "",
    `已确认：年级 ${grade}；学科 ${subject}；课题 ${topic}。`,
    `还缺的信息：教材版本 ${textbook}；课时长度和课堂风格可以稍后补充。`,
    `推荐先生成：${outputs.join("、")}。`,
    "",
    "如果方向对，请回复“确认开始”；如果要调整，请直接补充年级、课题、教材版本或交付物。",
  ].join("\n");
}
