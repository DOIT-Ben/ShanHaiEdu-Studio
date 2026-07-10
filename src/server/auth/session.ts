import type { AuthMode } from "@/server/auth/actor";
import { createWorkbenchActor, type ProjectMembershipRole, type WorkbenchActor } from "@/server/auth/actor";
import { createLocalSessionSetCookieHeader, resolveLocalWorkbenchActor } from "@/server/auth/local-session";
import { prisma } from "@/server/db/client";
import { createHash, randomBytes } from "node:crypto";

export const publicWorkbenchSessionCookieName = "shanhai_session";

export type PublicWorkbenchSession = {
  id: string;
  expiresAt: Date;
};

export type PublicWorkbenchSessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
};

export type ResolveWorkbenchSessionOptions = {
  db?: typeof prisma;
  now?: () => Date;
};

export type ResolvedWorkbenchSession =
  | {
      actor: WorkbenchActor;
      authMode: AuthMode;
      isNewSession: boolean;
      publicSession?: PublicWorkbenchSessionRecord;
      setCookieHeader?: string;
    }
  | {
      actor: null;
      authMode: AuthMode;
      isNewSession: false;
      reason: "missing_public_session";
    };

export async function resolveWorkbenchSession(
  request: Request,
  options: ResolveWorkbenchSessionOptions = {},
): Promise<ResolvedWorkbenchSession> {
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

  const db = options.db ?? prisma;
  const session = await db.authSession.findFirst({
    where: {
      sessionTokenHash: hashPublicSessionToken(sessionId),
      authMode,
      revokedAt: null,
      expiresAt: { gt: options.now?.() ?? new Date() },
    },
    include: {
      user: {
        include: {
          memberships: true,
        },
      },
    },
  });

  if (!session?.user || session.user.authMode !== authMode) {
    return { actor: null, authMode, isNewSession: false, reason: "missing_public_session" };
  }

  return {
    actor: createWorkbenchActor({
      userId: session.user.id,
      displayName: session.user.displayName,
      authMode,
      role: session.user.role === "admin" ? "admin" : "teacher",
      projectRoles: toProjectRoles(session.user.memberships ?? []),
    }),
    authMode,
    isNewSession: false,
    publicSession: {
      id: session.id,
      userId: session.user.id,
      expiresAt: session.expiresAt,
    },
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

export function createPublicSessionClearCookieHeader(request?: Request) {
  const parts = [
    `${publicWorkbenchSessionCookieName}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (isSecureRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function generatePublicSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPublicSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function readPublicSessionToken(request: Request) {
  const token = readCookie(request.headers.get("cookie") ?? "", publicWorkbenchSessionCookieName);
  if (!token || !isSafePublicSessionId(token)) return null;
  return token;
}

export function resolveAuthMode(): AuthMode {
  const raw = process.env.SHANHAI_AUTH_MODE?.trim().toLowerCase();
  if (raw === "password" || raw === "oauth" || raw === "sso") return raw;
  if (raw === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new AuthConfigurationError("SHANHAI_AUTH_MODE must use a public authentication mode in production.");
    }
    return "local";
  }
  if (!raw && process.env.NODE_ENV !== "production") return "local";
  throw new AuthConfigurationError("SHANHAI_AUTH_MODE is missing or invalid.");
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
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

function toProjectRoles(memberships: Array<{ projectId: string; role: string }>) {
  const roles: Record<string, ProjectMembershipRole> = {};
  for (const membership of memberships) {
    const role = normalizeProjectMembershipRole(membership.role);
    if (role) roles[membership.projectId] = role;
  }
  return roles;
}

function normalizeProjectMembershipRole(role: string): ProjectMembershipRole | null {
  if (role === "owner" || role === "editor" || role === "viewer") return role;
  return null;
}
