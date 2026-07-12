import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthMode } from "@/server/auth/actor";
import type { ExecutionIdentitySnapshot } from "@/server/workbench/types";

type ExecutionIdentityDatabase = {
  authSession: Pick<PrismaClient["authSession"], "findFirst">;
  project: Pick<PrismaClient["project"], "findFirst">;
};

export class ExecutionIdentityRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExecutionIdentityRejectedError";
    this.code = code;
  }
}

export function createExecutionIdentitySnapshot(input: {
  actorUserId: string;
  actorAuthMode: AuthMode;
  authSessionId?: string | null;
}): ExecutionIdentitySnapshot {
  return {
    actorUserId: input.actorUserId.trim(),
    actorAuthMode: input.actorAuthMode,
    authSessionId: input.authSessionId?.trim() || null,
  };
}

export async function assertActiveExecutionIdentity(
  db: ExecutionIdentityDatabase,
  identity: ExecutionIdentitySnapshot,
  now = new Date(),
) {
  if (!identity.actorUserId.trim()) {
    throw new ExecutionIdentityRejectedError("actor_missing", "Background execution actor is missing.");
  }

  if (identity.actorAuthMode === "local") {
    if (identity.authSessionId) {
      throw new ExecutionIdentityRejectedError("local_session_invalid", "Local execution cannot carry a public auth session.");
    }
    return;
  }

  if (!identity.authSessionId) {
    throw new ExecutionIdentityRejectedError("session_missing", "Public background execution session is missing.");
  }

  const session = await db.authSession.findFirst({
    where: {
      id: identity.authSessionId,
      userId: identity.actorUserId,
      authMode: identity.actorAuthMode,
      revokedAt: null,
      expiresAt: { gt: now },
      user: {
        authMode: identity.actorAuthMode,
        disabledAt: null,
      },
    },
    select: { id: true },
  });
  if (!session) {
    throw new ExecutionIdentityRejectedError("session_inactive", "Background execution session is inactive.");
  }
}

export async function assertExecutionIdentityCanWriteProject(
  db: ExecutionIdentityDatabase,
  identity: ExecutionIdentitySnapshot,
  projectId: string,
  now = new Date(),
) {
  await assertActiveExecutionIdentity(db, identity, now);

  const project = await db.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
      deletedAt: null,
      OR: [
        { ownerUserId: identity.actorUserId },
        ...(identity.actorAuthMode === "local" ? [{ ownerUserId: null }] : []),
        { memberships: { some: { userId: identity.actorUserId, role: { in: ["owner", "editor"] } } } },
      ],
    },
    select: { id: true },
  });
  if (!project) {
    throw new ExecutionIdentityRejectedError("project_write_denied", "Background execution actor cannot write this project.");
  }
}
