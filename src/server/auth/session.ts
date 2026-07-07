import type { AuthMode } from "@/server/auth/actor";
import { createWorkbenchActor, type WorkbenchActor } from "@/server/auth/actor";
import { createLocalSessionSetCookieHeader, resolveLocalWorkbenchActor } from "@/server/auth/local-session";

export const publicWorkbenchSessionCookieName = "shanhai_session";

export type PublicWorkbenchSession = {
  id: string;
  expiresAt: Date;
};

export type ResolvedWorkbenchSession =
  | {
      actor: WorkbenchActor;
      authMode: AuthMode;
      isNewSession: boolean;
      setCookieHeader?: string;
    }
  | {
      actor: null;
      authMode: AuthMode;
      isNewSession: false;
      reason: "missing_public_session";
    };

export function resolveWorkbenchSession(request: Request): ResolvedWorkbenchSession {
  const authMode = resolveAuthMode();
  if (authMode === "local") {
    const localSession = resolveLocalWorkbenchActor(request);
    return {
      actor: localSession.actor,
      authMode,
      isNewSession: localSession.isNewSession,
      setCookieHeader: localSession.isNewSession ? createLocalSessionSetCookieHeader(localSession, request) : undefined,
    };
  }

  const sessionId = readCookie(request.headers.get("cookie") ?? "", publicWorkbenchSessionCookieName);
  if (!sessionId || !isSafePublicSessionId(sessionId)) {
    return { actor: null, authMode, isNewSession: false, reason: "missing_public_session" };
  }

  return {
    actor: createWorkbenchActor({
      userId: `session:${sessionId}`,
      displayName: "已登录教师",
      authMode,
    }),
    authMode,
    isNewSession: false,
  };
}

export function createPublicSessionSetCookieHeader(session: PublicWorkbenchSession, request?: Request) {
  const maxAgeSeconds = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  const parts = [
    `${publicWorkbenchSessionCookieName}=${session.id}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (isSecureRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function resolveAuthMode(): AuthMode {
  const raw = process.env.SHANHAI_AUTH_MODE?.trim().toLowerCase();
  if (raw === "password" || raw === "oauth" || raw === "sso") return raw;
  return "local";
}

function readCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=").trim();
    }
  }
  return null;
}

function isSafePublicSessionId(value: string) {
  return /^[A-Za-z0-9_-]{12,160}$/.test(value);
}

function isSecureRequest(request?: Request) {
  if (!request) return false;
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto")?.toLowerCase().split(",")[0]?.trim() === "https";
}
