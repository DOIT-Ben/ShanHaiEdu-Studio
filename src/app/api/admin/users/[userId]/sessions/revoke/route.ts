import { canManageUsers } from "@/server/auth/authorization";
import { publicCsrfHeaderName, validateCsrfToken } from "@/server/auth/csrf";
import { AdminUserManagementError, revokeManagedUserSessions } from "@/server/auth/admin-user-management";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  if (!canManageUsers(session.actor) || !session.publicSession) return NextResponse.json({ error: "无权执行此操作。" }, { status: 403 });
  const csrfValid = await validateCsrfToken({
    sessionId: session.publicSession.id,
    userId: session.actor.userId,
    token: request.headers.get(publicCsrfHeaderName),
  });
  if (!csrfValid) return NextResponse.json({ error: "请求校验失败，请刷新后重试。" }, { status: 403 });

  const { userId } = await context.params;
  try {
    const result = await revokeManagedUserSessions({ userId, actorUserId: session.actor.userId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminUserManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
