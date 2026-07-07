import { PasswordAuthError, registerPasswordUser } from "@/server/auth/password-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!hasValidEmailAndPassword(body)) {
      return NextResponse.json({ error: "请输入有效的邮箱和密码。" }, { status: 400 });
    }
    const result = await registerPasswordUser(body, { request });
    return NextResponse.json(
      { authenticated: true, user: result.user },
      { status: 201, headers: { "set-cookie": result.setCookieHeader } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
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

function hasValidEmailAndPassword(body: Record<string, unknown>) {
  return (
    typeof body.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) &&
    typeof body.password === "string" &&
    body.password.length >= 12 &&
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
