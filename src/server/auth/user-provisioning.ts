import { createAuditLogEntry } from "@/server/auth/audit-log";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";

export type ProvisionedUserRole = "teacher" | "admin";

export type ProvisionPasswordUserInput = {
  email?: unknown;
  displayName?: unknown;
  initialPassword?: unknown;
  role: ProvisionedUserRole;
  actorUserId?: string | null;
  source: "admin_api" | "bootstrap_cli" | "invite_cli";
};

export type ProvisionPasswordUserOptions = {
  db?: typeof prisma;
  generateUserId?: () => string;
  now?: () => Date;
};

export class UserProvisioningError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UserProvisioningError";
    this.status = status;
  }
}

export async function provisionPasswordUser(
  input: ProvisionPasswordUserInput,
  options: ProvisionPasswordUserOptions = {},
) {
  const normalized = normalizeInput(input);
  const db = options.db ?? prisma;
  const now = options.now?.() ?? new Date();
  const passwordHash = await hashPassword(normalized.initialPassword);
  try {
    return await db.$transaction(async (transaction) => {
      const existing = await transaction.localUser.findUnique({ where: { email: normalized.email } });
      if (existing) {
        throw new UserProvisioningError("该邮箱已被使用。", 409);
      }

      const user = await transaction.localUser.create({
        data: {
          id: options.generateUserId?.() ?? crypto.randomUUID(),
          email: normalized.email,
          displayName: normalized.displayName,
          role: normalized.role,
          authMode: "password",
          passwordHash,
          updatedAt: now,
        },
      });
      const audit = createAuditLogEntry({
        actorUserId: input.actorUserId ?? user.id,
        action: normalized.role === "admin" ? "auth.admin.bootstrapped" : "auth.user.invited",
        targetType: "user",
        targetId: user.id,
        metadata: {
          authMode: "password",
          role: normalized.role,
          source: input.source,
          status: "active",
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: audit.actorUserId,
          action: audit.action,
          targetType: audit.targetType,
          targetId: audit.targetId,
          projectId: audit.projectId,
          metadataJson: JSON.stringify(audit.metadata),
        },
      });

      return { userId: user.id, status: "created" as const };
    });
  } catch (error) {
    if (error instanceof UserProvisioningError) throw error;
    if (isUniqueConstraintError(error)) {
      throw new UserProvisioningError("该邮箱已被使用。", 409);
    }
    throw error;
  }
}

function normalizeInput(input: ProvisionPasswordUserInput) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 80) : "";
  const initialPassword = typeof input.initialPassword === "string" ? input.initialPassword : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UserProvisioningError("请输入有效的邮箱。", 400);
  }
  if (!displayName) {
    throw new UserProvisioningError("请输入用户名称。", 400);
  }
  if (initialPassword.length < 8 || initialPassword.length > 256) {
    throw new UserProvisioningError("初始密码长度必须为 8 到 256 个字符。", 400);
  }
  return { email, displayName, initialPassword, role: input.role };
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
