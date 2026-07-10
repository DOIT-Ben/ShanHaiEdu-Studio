import { canManageUsers } from "@/server/auth/authorization";
import { publicCsrfHeaderName, validateCsrfToken } from "@/server/auth/csrf";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { provisionPasswordUser, UserProvisioningError } from "@/server/auth/user-provisioning";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await resolveWorkbenchSession(request);
  if (!session.actor) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  if (!canManageUsers(session.actor) || !session.publicSession) {
    return NextResponse.json({ error: "无权执行此操作。" }, { status: 403 });
  }

  const csrfValid = await validateCsrfToken({
    sessionId: session.publicSession.id,
    userId: session.actor.userId,
    token: request.headers.get(publicCsrfHeaderName),
  });
  if (!csrfValid) {
    return NextResponse.json({ error: "请求校验失败，请刷新后重试。" }, { status: 403 });
  }

  const rateLimit = checkRateLimit({
    scope: "auth-invite",
    key: session.actor.userId,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后重试。" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const body = await readJsonObject(request);
    const result = await provisionPasswordUser({
      email: body.email,
      displayName: body.displayName,
      initialPassword: body.initialPassword,
      role: normalizeInviteRole(body.role),
      actorUserId: session.actor.userId,
      source: "admin_api",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (isUserProvisioningError(error) || isStatusError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function isUserProvisioningError(error: unknown): error is UserProvisioningError {
  return typeof UserProvisioningError === "function" && error instanceof UserProvisioningError;
}

function isStatusError(error: unknown): error is { message: string; status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "status" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function normalizeInviteRole(value: unknown) {
  return value === "admin" ? "admin" : "teacher";
}
