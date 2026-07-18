import { addProjectMember, listProjectMembers, ProjectMemberManagementError } from "@/server/auth/project-member-management";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { projectId } = await context.params;
    try {
      const result = await listProjectMembers({ projectId, actor });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof ProjectMemberManagementError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { projectId } = await context.params;
    const body = await readJsonObject(request);
    try {
      const result = await addProjectMember({
        projectId,
        email: body.email,
        ...(typeof body.userId === "string" ? { userId: body.userId } : {}),
        role: body.role,
        actor,
      });
      return NextResponse.json(result, { status: 201 });
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
