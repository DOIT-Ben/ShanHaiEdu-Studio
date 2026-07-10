import { createAuditLogEntry } from "@/server/auth/audit-log";
import { hashPassword, type PasswordHashOptions } from "@/server/auth/password";
import { prisma } from "@/server/db/client";

export type ManagedUserStatus = "active" | "disabled";

export type ManagedUserSummary = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: string;
  status: ManagedUserStatus;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type AdminUserManagementOptions = {
  db?: typeof prisma;
  now?: () => Date;
  passwordHashOptions?: PasswordHashOptions;
};

type StoredManagedUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: string;
  passwordHash?: string | null;
  disabledAt?: Date | null;
  disabledReason?: string | null;
  lastLoginAt?: Date | null;
  passwordResetAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type AdminUserStore = Pick<typeof prisma, "localUser" | "authSession" | "csrfToken" | "auditLog">;

export class AdminUserManagementError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminUserManagementError";
    this.status = status;
  }
}

export async function listManagedUsers(input: { query?: unknown } = {}, options: AdminUserManagementOptions = {}) {
  const db = options.db ?? prisma;
  const query = normalizeQuery(input.query);
  const rows = (await db.localUser.findMany({
    where: query
      ? {
          OR: [
            { email: { contains: query } },
            { displayName: { contains: query } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "asc" },
  })) as StoredManagedUser[];

  return {
    items: rows.filter((user) => user.authMode === "password").map(toManagedUserSummary),
  };
}

export async function updateManagedUserStatus(
  input: { userId?: unknown; disabled?: unknown; reason?: unknown; actorUserId?: string | null },
  options: AdminUserManagementOptions = {},
) {
  const userId = normalizeUserId(input.userId);
  const disabled = Boolean(input.disabled);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 240) : null;
  const db = options.db ?? prisma;
  const now = resolveNow(options);

  return db.$transaction(async (transaction) => {
    const existing = (await transaction.localUser.findUnique({ where: { id: userId } })) as StoredManagedUser | null;
    if (!existing || existing.authMode !== "password") {
      throw new AdminUserManagementError("用户不存在。", 404);
    }
    if (disabled && input.actorUserId === userId) {
      throw new AdminUserManagementError("不能停用当前登录的管理员账号。", 400);
    }

    const user = (await transaction.localUser.update({
      where: { id: userId },
      data: disabled
        ? { disabledAt: existing.disabledAt ?? now, disabledReason: reason, updatedAt: now }
        : { disabledAt: null, disabledReason: null, updatedAt: now },
    })) as StoredManagedUser;

    if (disabled) {
      await revokeSessionsForUser(transaction, userId, now);
    }
    await writeAuditLog(transaction, {
      actorUserId: input.actorUserId ?? null,
      action: disabled ? "auth.user.disabled" : "auth.user.enabled",
      targetType: "user",
      targetId: userId,
      metadata: { status: disabled ? "disabled" : "active" },
    });
    return toManagedUserSummary(user);
  });
}

export async function updateManagedUserRole(
  input: { userId?: unknown; role?: unknown; actorUserId?: string | null },
  options: AdminUserManagementOptions = {},
) {
  const userId = normalizeUserId(input.userId);
  const role = normalizeSystemRole(input.role);
  const db = options.db ?? prisma;
  const now = resolveNow(options);

  return db.$transaction(async (transaction) => {
    const existing = (await transaction.localUser.findUnique({ where: { id: userId } })) as StoredManagedUser | null;
    if (!existing || existing.authMode !== "password") {
      throw new AdminUserManagementError("用户不存在。", 404);
    }
    if (input.actorUserId === userId) {
      throw new AdminUserManagementError("不能修改当前登录管理员的角色。", 400);
    }
    const user = (await transaction.localUser.update({ where: { id: userId }, data: { role, updatedAt: now } })) as StoredManagedUser;
    await revokeSessionsForUser(transaction, userId, now);
    await writeAuditLog(transaction, {
      actorUserId: input.actorUserId ?? null,
      action: "auth.user.role_updated",
      targetType: "user",
      targetId: userId,
      metadata: { role },
    });
    return toManagedUserSummary(user);
  });
}

export async function resetManagedUserPassword(
  input: { userId?: unknown; newPassword?: unknown; actorUserId?: string | null },
  options: AdminUserManagementOptions = {},
) {
  const userId = normalizeUserId(input.userId);
  const newPassword = normalizePassword(input.newPassword);
  const db = options.db ?? prisma;
  const now = resolveNow(options);
  const passwordHash = await hashPassword(newPassword, options.passwordHashOptions);

  return db.$transaction(async (transaction) => {
    const existing = (await transaction.localUser.findUnique({ where: { id: userId } })) as StoredManagedUser | null;
    if (!existing || existing.authMode !== "password") {
      throw new AdminUserManagementError("用户不存在。", 404);
    }
    await transaction.localUser.update({
      where: { id: userId },
      data: { passwordHash, passwordResetAt: now, updatedAt: now },
    });
    await revokeSessionsForUser(transaction, userId, now);
    await writeAuditLog(transaction, {
      actorUserId: input.actorUserId ?? null,
      action: "auth.user.password_reset",
      targetType: "user",
      targetId: userId,
      metadata: { status: "password_reset" },
    });
    return { userId, status: "password_reset" as const };
  });
}

export async function revokeManagedUserSessions(
  input: { userId?: unknown; actorUserId?: string | null },
  options: AdminUserManagementOptions = {},
) {
  const userId = normalizeUserId(input.userId);
  const db = options.db ?? prisma;
  const now = resolveNow(options);
  await revokeSessionsForUser(db, userId, now);
  await writeAuditLog(db, {
    actorUserId: input.actorUserId ?? null,
    action: "auth.user.sessions_revoked",
    targetType: "user",
    targetId: userId,
    metadata: { status: "sessions_revoked" },
  });
  return { userId, status: "sessions_revoked" as const };
}

async function revokeSessionsForUser(db: AdminUserStore, userId: string, now: Date) {
  await db.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, updatedAt: now },
  });
  await db.csrfToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: now },
  });
}

function toManagedUserSummary(user: StoredManagedUser): ManagedUserSummary {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: user.displayName,
    role: user.role,
    authMode: user.authMode,
    status: user.disabledAt ? "disabled" : "active",
    disabledAt: user.disabledAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function writeAuditLog(db: Pick<typeof prisma, "auditLog">, input: Parameters<typeof createAuditLogEntry>[0]) {
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

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().slice(0, 80);
}

function normalizeUserId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminUserManagementError("用户不存在。", 404);
  }
  return value.trim();
}

function normalizeSystemRole(value: unknown) {
  if (value === "teacher" || value === "admin") return value;
  throw new AdminUserManagementError("角色无效。", 400);
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) {
    throw new AdminUserManagementError("新密码长度必须为 12 到 256 个字符。", 400);
  }
  return value;
}

function resolveNow(options: AdminUserManagementOptions) {
  return options.now?.() ?? new Date();
}
