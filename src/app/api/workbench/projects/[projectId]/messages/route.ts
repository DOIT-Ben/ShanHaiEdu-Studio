import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { DeterministicRuntime } from "@/server/agent-runtime";

const runtime = new DeterministicRuntime();

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
      const result = await runtime.run({
        projectId,
        runId: randomUUID(),
        task: "requirement_spec",
        userMessage: content,
        projectContext: {
          grade: project.grade ?? "五年级",
          subject: project.subject ?? "数学",
          topic: project.lessonTopic ?? "百分数",
          textbookVersion: project.textbookVersion ?? undefined,
          teacherGoal: teacherContent,
          requestedOutputs: ["需求规格", "教案", "PPT 大纲", "导入视频方案"],
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
