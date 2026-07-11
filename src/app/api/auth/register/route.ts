import { PasswordAuthError, registerPasswordUser } from "@/server/auth/password-auth";
import { checkRateLimit, rateLimitKeyFromRequest } from "@/server/auth/rate-limit";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.SHANHAI_PUBLIC_REGISTRATION_ENABLED !== "1") {
    return NextResponse.json({ error: "公开注册未开放。" }, { status: 403 });
  }
  try {
    const body = await readJsonObject(request);
    if (!hasValidEmailAndPassword(body)) {
      return NextResponse.json({ error: "请输入有效的账号和密码。" }, { status: 400 });
    }
    const clientRateLimit = checkRateLimit({
      scope: "auth-register-client",
      key: rateLimitKeyFromRequest(request),
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!clientRateLimit.allowed) return rateLimitedResponse(clientRateLimit.retryAfterSeconds);
    const accountRateLimit = checkRateLimit({
      scope: "auth-register-account",
      key: String(body.account ?? body.email).trim().toLowerCase(),
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!accountRateLimit.allowed) return rateLimitedResponse(accountRateLimit.retryAfterSeconds);
    const result = await registerPasswordUser(body, { request });
    return NextResponse.json(
      { authenticated: true, user: result.user, csrfToken: result.csrfToken },
      { status: 201, headers: { "set-cookie": result.setCookieHeader } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "请求过于频繁，请稍后重试。" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function authErrorResponse(error: unknown) {
  if (isPasswordAuthError(error) || isAuthStatusError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

function hasValidEmailAndPassword(
  body: Record<string, unknown>,
): body is Record<string, unknown> & { email: string; password: string } {
  return (
    typeof (body.account ?? body.email) === "string" &&
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.account ?? body.email).trim()) || /^[A-Za-z0-9_]{3,64}$/.test(String(body.account ?? body.email).trim())) &&
    typeof body.password === "string" &&
    body.password.length >= 8 &&
    body.password.length <= 256
  );
}

function isPasswordAuthError(error: unknown): error is PasswordAuthError {
  return typeof PasswordAuthError === "function" && error instanceof PasswordAuthError;
}

function isAuthStatusError(error: unknown): error is { message: string; status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "status" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}
