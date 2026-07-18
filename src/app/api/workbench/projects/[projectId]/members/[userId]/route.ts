import { ProjectMemberManagementError, removeProjectMember, updateProjectMemberRole } from "@/server/auth/project-member-management";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ projectId: string; userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { projectId, userId } = await context.params;
    const body = await readJsonObject(request);
    try {
      const result = await updateProjectMemberRole({ projectId, userId, role: body.role, actor });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof ProjectMemberManagementError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { projectId, userId } = await context.params;
    try {
      const result = await removeProjectMember({ projectId, userId, actor });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof ProjectMemberManagementError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}

async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
