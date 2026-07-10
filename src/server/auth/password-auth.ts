import { createAuditLogEntry } from "@/server/auth/audit-log";
import { issueCsrfToken } from "@/server/auth/csrf";
import { hashPassword, type PasswordHashOptions, verifyPassword } from "@/server/auth/password";
import {
  createPublicSessionClearCookieHeader,
  createPublicSessionSetCookieHeader,
  generatePublicSessionToken,
  hashPublicSessionToken,
  readPublicSessionToken,
  type PublicWorkbenchSession,
} from "@/server/auth/session";
import { prisma } from "@/server/db/client";

export type PasswordUserSummary = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: "password";
};

export type PasswordAuthResult = {
  user: PasswordUserSummary;
  session: PublicWorkbenchSession;
  csrfToken: string;
  setCookieHeader: string;
};

export type PasswordAuthOptions = {
  db?: typeof prisma;
  now?: () => Date;
  passwordHashOptions?: PasswordHashOptions;
  generateSessionToken?: () => string;
  generateUserId?: () => string;
  request?: Request;
};

export class PasswordAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PasswordAuthError";
    this.status = status;
  }
}

const genericLoginError = "账号或密码不正确。";
const disabledLoginError = "账号已停用，请联系管理员。";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

export async function registerPasswordUser(
  input: { email?: unknown; password?: unknown; displayName?: unknown },
  options: PasswordAuthOptions = {},
): Promise<PasswordAuthResult> {
  const normalized = normalizeRegistrationInput(input);
  const db = options.db ?? prisma;
  const now = resolveNow(options);
  const userId = options.generateUserId?.() ?? crypto.randomUUID();
  const storedPasswordHash = await hashPassword(normalized.password, options.passwordHashOptions);

  let user: StoredPasswordUser;
  try {
    user = await db.localUser.create({
      data: {
        id: userId,
        email: normalized.email,
        displayName: normalized.displayName,
        role: "teacher",
        authMode: "password",
        passwordHash: storedPasswordHash,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new PasswordAuthError("这个邮箱已经可以登录，请直接登录。", 409);
    }
    throw error;
  }

  const result = await createPasswordSession(user, options);
  await writeAuditLog(db, {
    actorUserId: user.id,
    action: "auth.register",
    targetType: "user",
    targetId: user.id,
    metadata: { authMode: "password" },
  });
  return result;
}

export async function loginPasswordUser(
  input: { email?: unknown; password?: unknown },
  options: PasswordAuthOptions = {},
): Promise<PasswordAuthResult> {
  const normalized = normalizeLoginInput(input);
  const db = options.db ?? prisma;
  const user = (await db.localUser.findUnique({
    where: { email: normalized.email },
  })) as StoredPasswordUser | null;

  if (!user?.passwordHash || user.authMode !== "password") {
    throw new PasswordAuthError(genericLoginError, 401);
  }
  const isValid = await verifyPassword(normalized.password, user.passwordHash);
  if (!isValid) {
    throw new PasswordAuthError(genericLoginError, 401);
  }
  if (user.disabledAt) {
    throw new PasswordAuthError(disabledLoginError, 403);
  }

  const result = await createPasswordSession(user, options);
  await db.localUser.update({
    where: { id: user.id },
    data: { lastLoginAt: resolveNow(options), updatedAt: resolveNow(options) },
  });
  await writeAuditLog(db, {
    actorUserId: user.id,
    action: "auth.login",
    targetType: "user",
    targetId: user.id,
    metadata: { authMode: "password" },
  });
  return result;
}

export async function getCurrentPasswordUser(request: Request, options: PasswordAuthOptions = {}) {
  const token = readPublicSessionToken(request);
  if (!token) return { authenticated: false, user: null };

  const db = options.db ?? prisma;
  const now = resolveNow(options);
  const session = await db.authSession.findFirst({
    where: {
      sessionTokenHash: hashPublicSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: { user: true },
  });

  if (!session?.user || session.user.authMode !== "password" || (session.user as StoredPasswordUser).disabledAt) {
    return { authenticated: false, user: null };
  }

  const csrf = await issueCsrfToken({
    sessionId: session.id,
    userId: session.user.id,
    expiresAt: session.expiresAt,
    db,
  });

  return {
    authenticated: true,
    user: toPasswordUserSummary(session.user as StoredPasswordUser),
    csrfToken: csrf.token,
  };
}

export async function logoutPasswordSession(request: Request, options: PasswordAuthOptions = {}) {
  const token = readPublicSessionToken(request);
  const db = options.db ?? prisma;
  const now = resolveNow(options);
  let revoked = false;

  if (token) {
    const session = await db.authSession.findFirst({
      where: {
        sessionTokenHash: hashPublicSessionToken(token),
        revokedAt: null,
      },
    });
    if (session) {
      await db.authSession.update({
        where: { id: session.id },
        data: {
          revokedAt: now,
          updatedAt: now,
        },
      });
      await db.csrfToken.updateMany({
        where: {
          sessionId: session.id,
          consumedAt: null,
        },
        data: {
          consumedAt: now,
        },
      });
      revoked = true;
    }
  }

  if (revoked) {
    await writeAuditLog(db, {
      action: "auth.logout",
      targetType: "session",
      metadata: { authMode: "password" },
    });
  }

  return {
    revoked,
    clearCookieHeader: createPublicSessionClearCookieHeader(request),
  };
}

function normalizeRegistrationInput(input: { email?: unknown; password?: unknown; displayName?: unknown }) {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  if (!email || !password) {
    throw new PasswordAuthError("请输入有效的邮箱和密码。", 400);
  }
  return {
    email,
    password,
    displayName: normalizeDisplayName(input.displayName) ?? "山海教师",
  };
}

function normalizeLoginInput(input: { email?: unknown; password?: unknown }) {
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  if (!email || !password) {
    throw new PasswordAuthError("请输入有效的邮箱和密码。", 400);
  }
  return { email, password };
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string") return null;
  if (value.length < 12 || value.length > 256) return null;
  return value;
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string") return null;
  const displayName = value.trim();
  if (!displayName) return null;
  return displayName.slice(0, 80);
}

async function createPasswordSession(user: StoredPasswordUser, options: PasswordAuthOptions): Promise<PasswordAuthResult> {
  const db = options.db ?? prisma;
  const now = resolveNow(options);
  const token = options.generateSessionToken?.() ?? generatePublicSessionToken();
  const session: PublicWorkbenchSession = {
    id: token,
    expiresAt: new Date(now.getTime() + sessionTtlMs),
  };

  const storedSession = await db.authSession.create({
    data: {
      userId: user.id,
      sessionTokenHash: hashPublicSessionToken(token),
      authMode: "password",
      expiresAt: session.expiresAt,
      revokedAt: null,
      updatedAt: now,
    },
  });
  const csrf = await issueCsrfToken({
    sessionId: storedSession.id,
    userId: user.id,
    expiresAt: session.expiresAt,
    db,
  });

  return {
    user: toPasswordUserSummary(user),
    session,
    csrfToken: csrf.token,
    setCookieHeader: createPublicSessionSetCookieHeader(session, options.request),
  };
}

function toPasswordUserSummary(user: StoredPasswordUser): PasswordUserSummary {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: user.displayName,
    role: user.role,
    authMode: "password",
  };
}

function resolveNow(options: PasswordAuthOptions) {
  return options.now?.() ?? new Date();
}

async function writeAuditLog(db: typeof prisma, input: Parameters<typeof createAuditLogEntry>[0]) {
  const entry = createAuditLogEntry(input);
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      projectId: entry.projectId,
      metadataJson: JSON.stringify(entry.metadata),
    },
  });
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

type StoredPasswordUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: string;
  passwordHash?: string | null;
  disabledAt?: Date | string | null;
};
