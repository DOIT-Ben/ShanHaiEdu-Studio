import { canManageUsers } from "@/server/auth/authorization";
import { publicCsrfHeaderName, validateCsrfToken } from "@/server/auth/csrf";
import { AdminUserManagementError, updateManagedUserRole, updateManagedUserStatus } from "@/server/auth/admin-user-management";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdminWithCsrf(request);
  if (guard.response) return guard.response;

  const { userId } = await context.params;
  const body = await readJsonObject(request);
  try {
    if (typeof body.role === "string") {
      const result = await updateManagedUserRole({ userId, role: body.role, actorUserId: guard.actorUserId });
      return NextResponse.json(result);
    }
    const result = await updateManagedUserStatus({
      userId,
      disabled: body.disabled === true,
      reason: body.reason,
      actorUserId: guard.actorUserId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminUserManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

async function requireAdminWithCsrf(request: Request): Promise<{ actorUserId: string; response?: undefined } | { actorUserId?: undefined; response: Response }> {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) {
    return { response: NextResponse.json({ error: "请先登录。" }, { status: 401 }) };
  }
  if (!canManageUsers(session.actor) || !session.publicSession) {
    return { response: NextResponse.json({ error: "无权执行此操作。" }, { status: 403 }) };
  }
  const csrfValid = await validateCsrfToken({
    sessionId: session.publicSession.id,
    userId: session.actor.userId,
    token: request.headers.get(publicCsrfHeaderName),
  });
  if (!csrfValid) {
    return { response: NextResponse.json({ error: "请求校验失败，请刷新后重试。" }, { status: 403 }) };
  }
  return { actorUserId: session.actor.userId };
}

async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
