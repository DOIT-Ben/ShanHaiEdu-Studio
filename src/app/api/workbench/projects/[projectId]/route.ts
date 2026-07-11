import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { ProjectLifecycleError } from "@/server/workbench/project-lifecycle-service";
import type { ProjectLifecycleMutation } from "@/server/workbench/types";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const project = await service.getProject(projectId);
      return NextResponse.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目内容暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    const { projectId } = await context.params;
    try {
      const mutation = await parseLifecycleMutation(request);
      const result = await service.mutateProjectLifecycle(projectId, mutation);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof ProjectLifecycleError) {
        if (error.code === "project_version_conflict") {
          const project = await service.getProject(projectId).catch(() => null);
          return NextResponse.json(
            { error: "项目状态已变化，请刷新后再操作。", code: error.code, ...(project ? { project } : {}) },
            { status: error.status },
          );
        }
        return NextResponse.json({ error: lifecycleErrorMessage(error), code: error.code }, { status: error.status });
      }
      return NextResponse.json({ error: "项目操作暂时没有完成，请稍后重试。" }, { status: 400 });
    }
  });
}

async function parseLifecycleMutation(request: Request): Promise<ProjectLifecycleMutation> {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request body");
  const value = body as Record<string, unknown>;
  if (value.action !== "rename" && value.action !== "archive" && value.action !== "trash" && value.action !== "restore") {
    throw new Error("Invalid lifecycle action");
  }
  if (!Number.isInteger(value.expectedLifecycleVersion) || (value.expectedLifecycleVersion as number) < 0) {
    throw new Error("Invalid lifecycle version");
  }
  if (value.action === "rename" && typeof value.title !== "string") throw new Error("Invalid project title");
  return {
    action: value.action,
    expectedLifecycleVersion: value.expectedLifecycleVersion as number,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
  };
}

function lifecycleErrorMessage(error: ProjectLifecycleError) {
  if (error.code === "project_busy") return "项目正在生成内容，请等待当前任务完成后再操作。";
  if (error.code === "project_forbidden") return "你没有权限执行这个操作。";
  if (error.code === "project_lifecycle_conflict") return "该项目当前不能执行这个操作。";
  return "项目不存在。";
}
