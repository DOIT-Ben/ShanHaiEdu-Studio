import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { ProjectLifecycleState } from "@/server/workbench/types";

export async function GET(request: Request) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    const view = parseProjectView(new URL(request.url).searchParams.get("view"));
    if (!view) {
      return NextResponse.json({ error: "项目列表暂时没有取回，请刷新后重试。" }, { status: 400 });
    }
    const projects = await service.listProjects(view);
    return NextResponse.json({ projects });
  });
}

export async function POST(request: Request) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    const body = await parseOptionalProjectBody(request);
    const project = await service.createProject({
      title: String(body.title ?? "未命名公开课项目"),
      grade: optionalString(body.grade),
      subject: optionalString(body.subject),
      textbookVersion: optionalString(body.textbookVersion),
      lessonTopic: optionalString(body.lessonTopic),
    });

    return NextResponse.json({ project }, { status: 201 });
  });
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

function parseProjectView(value: string | null): ProjectLifecycleState | null {
  if (!value || value === "active") return "active";
  if (value === "archived" || value === "trash") return value;
  return null;
}
