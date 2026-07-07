import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { DeterministicRuntime } from "@/server/agent-runtime";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();
const runtime = new DeterministicRuntime();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const messages = await service.getMessages(projectId);
  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: RouteContext) {
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
}
