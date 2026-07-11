import type { Prisma, Project } from "@/generated/prisma/client";
import { createAuditLogEntry } from "@/server/auth/audit-log";
import type { WorkbenchActor } from "@/server/auth/actor";
import { getProjectMembershipRole } from "@/server/auth/actor";
import { canManageProjectLifecycle } from "@/server/auth/authorization";
import { prisma } from "@/server/db/client";
import type { ProjectLifecycleMutation, ProjectLifecycleState } from "./types";

const staleJobThresholdMs = 30 * 60 * 1000;

export class ProjectLifecycleError extends Error {
  constructor(
    readonly code: "project_not_found" | "project_forbidden" | "project_version_conflict" | "project_lifecycle_conflict" | "project_busy",
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ProjectLifecycleError";
  }
}

export type ProjectLifecycleMutationResult = {
  changed: boolean;
  project: Project;
};

export function getProjectLifecycleState(project: Pick<Project, "archivedAt" | "deletedAt">): ProjectLifecycleState {
  if (project.deletedAt) return "trash";
  if (project.archivedAt) return "archived";
  return "active";
}

export async function assertActiveProjectForWrite(tx: Prisma.TransactionClient, projectId: string) {
  const project = await tx.project.findFirst({
    where: { id: projectId, archivedAt: null, deletedAt: null },
  });
  if (!project) {
    throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "该项目当前不可继续编辑。");
  }
  return project;
}

export async function mutateProjectLifecycle(input: {
  projectId: string;
  actor?: WorkbenchActor;
  mutation: ProjectLifecycleMutation;
  now?: Date;
}): Promise<ProjectLifecycleMutationResult> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) {
      throw new ProjectLifecycleError("project_not_found", 404, "项目不存在。");
    }

    assertLifecycleAuthority(project, input.actor);
    await reconcileStaleProjectJobs(tx, project.id, now);

    const current = await tx.project.findUnique({ where: { id: project.id } });
    if (!current) {
      throw new ProjectLifecycleError("project_not_found", 404, "项目不存在。");
    }
    if (current.lifecycleVersion !== input.mutation.expectedLifecycleVersion) {
      throw new ProjectLifecycleError("project_version_conflict", 409, "项目状态已变化，请刷新后再操作。");
    }

    const transition = resolveLifecycleTransition(current, input.mutation, now);
    if (!transition) return { changed: false, project: current };

    if (input.mutation.action === "archive" || input.mutation.action === "trash") {
      const busy = await hasPendingProjectWork(tx, current.id);
      if (busy) {
        throw new ProjectLifecycleError("project_busy", 409, "项目正在生成内容，请等待当前任务完成后再操作。");
      }
    }

    const updated = await tx.project.updateMany({
      where: { id: current.id, lifecycleVersion: input.mutation.expectedLifecycleVersion },
      data: transition,
    });
    if (updated.count !== 1) {
      throw new ProjectLifecycleError("project_version_conflict", 409, "项目状态已变化，请刷新后再操作。");
    }

    const action = auditActionFor(input.mutation.action);
    const audit = createAuditLogEntry({
      actorUserId: input.actor?.userId ?? null,
      action,
      targetType: "project",
      targetId: current.id,
      projectId: current.id,
      metadata: {
        lifecycleVersion: current.lifecycleVersion + 1,
        ...(input.mutation.action === "rename" ? { title: transition.title } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: audit.actorUserId,
        action: audit.action,
        targetType: audit.targetType,
        targetId: audit.targetId,
        projectId: audit.projectId,
        metadataJson: JSON.stringify(audit.metadata),
      },
    });

    const persisted = await tx.project.findUnique({ where: { id: current.id } });
    if (!persisted) throw new ProjectLifecycleError("project_not_found", 404, "项目不存在。");
    return { changed: true, project: persisted };
  });
}

function assertLifecycleAuthority(project: Project, actor?: WorkbenchActor) {
  if (canManageProjectLifecycle(project, actor)) return;
  const isKnownMember = Boolean(actor && getProjectMembershipRole(actor, project.id));
  if (!isKnownMember) {
    throw new ProjectLifecycleError("project_not_found", 404, "项目不存在。");
  }
  throw new ProjectLifecycleError("project_forbidden", 403, "无权修改这个项目。");
}

async function reconcileStaleProjectJobs(tx: Prisma.TransactionClient, projectId: string, now: Date) {
  const staleBefore = new Date(now.getTime() - staleJobThresholdMs);
  const message = "这项未完成的生成已超时，请重新发起。";

  await tx.conversationTurnJob.updateMany({
    where: {
      projectId,
      status: { in: ["queued", "running"] },
      updatedAt: { lte: staleBefore },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: {
      status: "failed",
      errorCode: "lifecycle_stale",
      errorMessage: message,
      finishedAt: now,
      lockedBy: null,
      lockedUntil: null,
    },
  });
  await tx.generationJob.updateMany({
    where: { projectId, status: { in: ["queued", "running"] }, updatedAt: { lte: staleBefore } },
    data: { status: "failed", errorMessage: message, finishedAt: now },
  });
  await tx.agentRun.updateMany({
    where: { projectId, status: "running", startedAt: { lte: staleBefore } },
    data: { status: "failed", errorMessage: message, finishedAt: now },
  });
}

async function hasPendingProjectWork(tx: Prisma.TransactionClient, projectId: string) {
  const [turnJobs, generationJobs, agentRuns] = await Promise.all([
    tx.conversationTurnJob.count({ where: { projectId, status: { in: ["queued", "running"] } } }),
    tx.generationJob.count({ where: { projectId, status: { in: ["queued", "running"] } } }),
    tx.agentRun.count({ where: { projectId, status: "running" } }),
  ]);
  return turnJobs + generationJobs + agentRuns > 0;
}

function resolveLifecycleTransition(project: Project, mutation: ProjectLifecycleMutation, now: Date): Prisma.ProjectUpdateManyMutationInput | null {
  const state = getProjectLifecycleState(project);
  if (mutation.action === "rename") {
    if (state !== "active") {
      throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "归档或回收站中的项目不能重命名。");
    }
    const title = normalizeTitle(mutation.title);
    return title === project.title ? null : { title, lifecycleVersion: { increment: 1 } };
  }
  if (mutation.action === "archive") {
    if (state === "archived") return null;
    if (state !== "active") {
      throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "回收站中的项目不能归档。");
    }
    return { archivedAt: now, lifecycleVersion: { increment: 1 } };
  }
  if (mutation.action === "trash") {
    if (state === "trash") return null;
    return { deletedAt: now, lifecycleVersion: { increment: 1 } };
  }
  if (state === "active") return null;
  return { archivedAt: null, deletedAt: null, lifecycleVersion: { increment: 1 } };
}

function normalizeTitle(value: unknown) {
  if (typeof value !== "string") {
    throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "项目名称无效。");
  }
  const title = value.trim();
  if (!title || title.length > 80) {
    throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "项目名称需为 1 到 80 个字符。");
  }
  return title;
}

function auditActionFor(action: ProjectLifecycleMutation["action"]) {
  if (action === "rename") return "project.renamed";
  if (action === "archive") return "project.archived";
  if (action === "trash") return "project.trashed";
  return "project.restored";
}
