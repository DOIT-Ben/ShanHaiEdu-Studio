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

      if (!conversationDecision.shouldGenerateRequirement) {
        const assistantMessage = await service.addMessage(projectId, {
          role: "assistant",
          content: formatAssistantContent(conversationDecision.assistantMessage),
        });
        return NextResponse.json({ message, assistantMessage }, { status: 201 });
      }

      const result = await runtime.run({
        projectId,
        runId: randomUUID(),
        task: "requirement_spec",
        userMessage: content,
        projectContext: {
          grade: conversationDecision.normalizedBrief?.grade ?? project.grade ?? "五年级",
          subject: conversationDecision.normalizedBrief?.subject ?? project.subject ?? "数学",
          topic: conversationDecision.normalizedBrief?.topic ?? project.lessonTopic ?? "待确认课题",
          textbookVersion: project.textbookVersion ?? undefined,
          teacherGoal: conversationDecision.normalizedBrief?.teacherGoal ?? teacherContent,
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
