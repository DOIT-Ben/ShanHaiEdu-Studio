import { publicCsrfHeaderName, validateCsrfToken } from "@/server/auth/csrf";
import { addProjectMember, listProjectMembers, ProjectMemberManagementError } from "@/server/auth/project-member-management";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  const { projectId } = await context.params;
  try {
    const result = await listProjectMembers({ projectId, actor: session.actor });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProjectMemberManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireActorWithCsrf(request);
  if (guard.response) return guard.response;

  const { projectId } = await context.params;
  const body = await readJsonObject(request);
  try {
    const result = await addProjectMember({
      projectId,
      email: body.email,
      ...(typeof body.userId === "string" ? { userId: body.userId } : {}),
      role: body.role,
      actor: guard.actor,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectMemberManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

async function requireActorWithCsrf(request: Request) {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) return { response: NextResponse.json({ error: "请先登录。" }, { status: 401 }) };
  if (!session.publicSession) return { response: NextResponse.json({ error: "请求校验失败，请刷新后重试。" }, { status: 403 }) };
  const csrfValid = await validateCsrfToken({
    sessionId: session.publicSession.id,
    userId: session.actor.userId,
    token: request.headers.get(publicCsrfHeaderName),
  });
  if (!csrfValid) return { response: NextResponse.json({ error: "请求校验失败，请刷新后重试。" }, { status: 403 }) };
  return { actor: session.actor };
}

async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
