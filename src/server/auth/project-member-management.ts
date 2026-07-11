import { createAuditLogEntry } from "@/server/auth/audit-log";
import type { WorkbenchActor } from "@/server/auth/actor";
import { canManageProjectMembers, canReadProject } from "@/server/auth/authorization";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "@/server/workbench/project-lifecycle-service";

export type ProjectMemberRole = "owner" | "editor" | "viewer";

export type ProjectMemberSummary = {
  userId: string;
  email: string | null;
  displayName: string;
  role: ProjectMemberRole;
};

type ProjectMemberManagementOptions = {
  db?: typeof prisma;
  now?: () => Date;
};

type ProjectLike = {
  id: string;
  ownerUserId?: string | null;
};

type UserLike = {
  id: string;
  email: string | null;
  displayName: string;
  authMode: string;
  passwordHash?: string | null;
};

type MembershipLike = {
  projectId: string;
  userId: string;
  role: string;
  user?: UserLike | null;
};

type ProjectMemberStore = Pick<typeof prisma, "project" | "localUser" | "projectMembership" | "auditLog">;

export class ProjectMemberManagementError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectMemberManagementError";
    this.status = status;
  }
}

export async function listProjectMembers(input: { projectId?: unknown; actor?: WorkbenchActor | null }, options: ProjectMemberManagementOptions = {}) {
  const db = options.db ?? prisma;
  const projectId = normalizeId(input.projectId, "项目不存在。");
  const project = await getReadableProject(db, projectId, input.actor ?? null);
  const memberships = (await db.projectMembership.findMany({
    where: { projectId: project.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  })) as MembershipLike[];
  return { items: memberships.map(toProjectMemberSummary) };
}

export async function addProjectMember(
  input: { projectId?: unknown; email?: unknown; userId?: unknown; role?: unknown; actor?: WorkbenchActor | null },
  options: ProjectMemberManagementOptions = {},
) {
  const db = options.db ?? prisma;
  const projectId = normalizeId(input.projectId, "项目不存在。");
  const role = normalizeMemberRole(input.role);
  const now = options.now?.() ?? new Date();

  return db.$transaction(async (transaction) => {
    await assertActiveProjectForWrite(transaction, projectId);
    const project = await getManageableProject(transaction, projectId, input.actor ?? null);
    const user = await resolveTargetUser(transaction, input);
    assertNotProjectOwner(project, user.id);
    const membership = (await transaction.projectMembership.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      update: { role, updatedAt: now },
      create: { projectId: project.id, userId: user.id, role },
    })) as MembershipLike;
    await writeAuditLog(transaction, {
      actorUserId: input.actor?.userId ?? null,
      action: "project.member.added",
      targetType: "project_member",
      targetId: user.id,
      projectId: project.id,
      metadata: { role },
    });
    return toProjectMemberSummary({ ...membership, user });
  });
}

export async function updateProjectMemberRole(
  input: { projectId?: unknown; userId?: unknown; role?: unknown; actor?: WorkbenchActor | null },
  options: ProjectMemberManagementOptions = {},
) {
  const db = options.db ?? prisma;
  const projectId = normalizeId(input.projectId, "项目不存在。");
  const userId = normalizeId(input.userId, "用户不存在。");
  const role = normalizeMemberRole(input.role);
  const now = options.now?.() ?? new Date();

  return db.$transaction(async (transaction) => {
    await assertActiveProjectForWrite(transaction, projectId);
    const project = await getManageableProject(transaction, projectId, input.actor ?? null);
    assertNotProjectOwner(project, userId);
    const user = await getUserById(transaction, userId);
    const membership = (await transaction.projectMembership.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      update: { role, updatedAt: now },
      create: { projectId: project.id, userId, role },
    })) as MembershipLike;
    await writeAuditLog(transaction, {
      actorUserId: input.actor?.userId ?? null,
      action: "project.member.role_updated",
      targetType: "project_member",
      targetId: userId,
      projectId: project.id,
      metadata: { role },
    });
    return toProjectMemberSummary({ ...membership, user });
  });
}

export async function removeProjectMember(
  input: { projectId?: unknown; userId?: unknown; actor?: WorkbenchActor | null },
  options: ProjectMemberManagementOptions = {},
) {
  const db = options.db ?? prisma;
  const projectId = normalizeId(input.projectId, "项目不存在。");
  const userId = normalizeId(input.userId, "用户不存在。");

  return db.$transaction(async (transaction) => {
    await assertActiveProjectForWrite(transaction, projectId);
    const project = await getManageableProject(transaction, projectId, input.actor ?? null);
    assertNotProjectOwner(project, userId);
    await transaction.projectMembership.deleteMany({ where: { projectId: project.id, userId } });
    await writeAuditLog(transaction, {
      actorUserId: input.actor?.userId ?? null,
      action: "project.member.removed",
      targetType: "project_member",
      targetId: userId,
      projectId: project.id,
      metadata: { status: "removed" },
    });
    return { userId, status: "removed" as const };
  });
}

async function getReadableProject(db: ProjectMemberStore, projectId: string, actor: WorkbenchActor | null): Promise<ProjectLike> {
  const project = (await db.project.findUnique({ where: { id: projectId } })) as ProjectLike | null;
  if (!project || !canReadProject(project, actor ?? undefined)) {
    throw new ProjectMemberManagementError("项目不存在。", 404);
  }
  return project;
}

async function getManageableProject(db: ProjectMemberStore, projectId: string, actor: WorkbenchActor | null): Promise<ProjectLike> {
  const project = await getReadableProject(db, projectId, actor);
  if (!canManageProjectMembers(project, actor ?? undefined)) {
    throw new ProjectMemberManagementError("无权管理项目成员。", 403);
  }
  return project;
}

async function resolveTargetUser(db: ProjectMemberStore, input: { email?: unknown; userId?: unknown }) {
  if (typeof input.userId === "string" && input.userId.trim()) {
    return getUserById(db, input.userId.trim());
  }
  const email = normalizeEmail(input.email);
  const user = (await db.localUser.findFirst({ where: { email, authMode: "password" } })) as UserLike | null;
  if (!user) throw new ProjectMemberManagementError("用户不存在。", 404);
  return user;
}

async function getUserById(db: ProjectMemberStore, userId: string) {
  const user = (await db.localUser.findUnique({ where: { id: userId } })) as UserLike | null;
  if (!user || user.authMode !== "password") throw new ProjectMemberManagementError("用户不存在。", 404);
  return user;
}

function toProjectMemberSummary(membership: MembershipLike): ProjectMemberSummary {
  return {
    userId: membership.userId,
    email: membership.user?.email ?? null,
    displayName: membership.user?.displayName ?? "教师账户",
    role: normalizeStoredMemberRole(membership.role),
  };
}

function assertNotProjectOwner(project: ProjectLike, userId: string) {
  if (project.ownerUserId === userId) {
    throw new ProjectMemberManagementError("不能移除项目拥有者或改变拥有者身份。", 400);
  }
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

function normalizeId(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new ProjectMemberManagementError(message, 404);
  return value.trim();
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") throw new ProjectMemberManagementError("请输入有效的邮箱。", 400);
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProjectMemberManagementError("请输入有效的邮箱。", 400);
  return email;
}

function normalizeMemberRole(value: unknown): Exclude<ProjectMemberRole, "owner"> {
  if (value === "editor" || value === "viewer") return value;
  throw new ProjectMemberManagementError("项目角色无效。", 400);
}

function normalizeStoredMemberRole(value: string): ProjectMemberRole {
  if (value === "owner" || value === "editor" || value === "viewer") return value;
  return "viewer";
}
