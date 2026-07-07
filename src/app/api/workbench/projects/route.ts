import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

export async function GET() {
  const projects = await service.listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = await parseOptionalProjectBody(request);
  const project = await service.createProject({
    title: String(body.title ?? "未命名公开课项目"),
    grade: optionalString(body.grade),
    subject: optionalString(body.subject),
    textbookVersion: optionalString(body.textbookVersion),
    lessonTopic: optionalString(body.lessonTopic),
  });

  return NextResponse.json({ project }, { status: 201 });
}

async function parseOptionalProjectBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const body = JSON.parse(text) as unknown;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
