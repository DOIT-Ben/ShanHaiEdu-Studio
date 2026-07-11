import { loginPasswordUser, PasswordAuthError } from "@/server/auth/password-auth";
import { checkRateLimit, rateLimitKeyFromRequest, resetRateLimit } from "@/server/auth/rate-limit";
import { NextResponse } from "next/server";

const maxLoginBodyBytes = 16 * 1024;

export async function POST(request: Request) {
  if (declaredBodyTooLarge(request)) return bodyTooLargeResponse();
  const clientKey = rateLimitKeyFromRequest(request);
  const trustedClient = clientKey !== "unknown-client";
  const clientRateLimit = checkRateLimit({
    scope: trustedClient ? "auth-login-client" : "auth-login-direct",
    key: clientKey,
    limit:
      trustedClient
        ? readRateLimit("SHANHAI_LOGIN_CLIENT_RATE_LIMIT", 20)
        : readRateLimit("SHANHAI_LOGIN_DIRECT_RATE_LIMIT", 1000),
    windowMs: trustedClient ? 15 * 60 * 1000 : 60 * 1000,
  });
  if (!clientRateLimit.allowed) return rateLimitedResponse(clientRateLimit.retryAfterSeconds);

  let clientAccountRateLimitInput: { scope: string; key: string; limit: number; windowMs: number } | null = null;
  try {
    const body = await readJsonObject(request);
    if (!hasValidEmailAndPassword(body)) {
      return NextResponse.json({ error: "请输入有效的账号和密码。" }, { status: 400 });
    }
    if (trustedClient) {
      clientAccountRateLimitInput = {
        scope: "auth-login-client-account",
      key: `${clientKey}:${String(body.account ?? body.email).trim().toLowerCase()}`,
        limit: readRateLimit("SHANHAI_LOGIN_CLIENT_ACCOUNT_RATE_LIMIT", 5),
        windowMs: 15 * 60 * 1000,
      };
      const clientAccountRateLimit = checkRateLimit(clientAccountRateLimitInput);
      if (!clientAccountRateLimit.allowed) return rateLimitedResponse(clientAccountRateLimit.retryAfterSeconds);
    }
    const result = await loginPasswordUser(body, { request });
    if (clientAccountRateLimitInput) resetRateLimit(clientAccountRateLimitInput);
    return NextResponse.json(
      { authenticated: true, user: result.user, csrfToken: result.csrfToken },
      { status: 200, headers: { "set-cookie": result.setCookieHeader } },
    );
  } catch (error) {
    if (error instanceof LoginBodyTooLargeError) return bodyTooLargeResponse();
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
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxLoginBodyBytes) {
      await reader.cancel();
      throw new LoginBodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes) || "null");
  } catch {
    return {};
  }
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function declaredBodyTooLarge(request: Request) {
  const raw = request.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return false;
  return Number(raw) > maxLoginBodyBytes;
}

function bodyTooLargeResponse() {
  return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
}

class LoginBodyTooLargeError extends Error {}

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

function readRateLimit(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
