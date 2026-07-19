import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite, ProjectLifecycleError } from "./project-lifecycle-service";
import type { CreateProjectInput, ProjectLifecycleState } from "./types";

async function listProjects(
  client: PrismaClient,
  input: { actor?: WorkbenchActor; view?: ProjectLifecycleState } = {},
) {
  const lifecycleWhere = input.view === "archived"
    ? { archivedAt: { not: null }, deletedAt: null }
    : input.view === "trash"
      ? { deletedAt: { not: null } }
      : { archivedAt: null, deletedAt: null };
  return client.project.findMany({
    where: input.actor
      ? {
          ...lifecycleWhere,
          OR: [
            { ownerUserId: input.actor.userId },
            ...((input.actor.authMode ?? "local") === "local" ? [{ ownerUserId: null }] : []),
            { memberships: { some: { userId: input.actor.userId } } },
          ],
        }
      : lifecycleWhere,
    orderBy: { updatedAt: "desc" },
  });
}

async function createProject(client: PrismaClient, input: CreateProjectInput) {
  return client.$transaction(async (tx) => {
    if (input.ownerUserId) {
      const existingOwner = await tx.localUser.findUnique({
        where: { id: input.ownerUserId },
      });
      if (!existingOwner) {
        await tx.localUser.create({
          data: { id: input.ownerUserId, displayName: "本地教师", role: "teacher", authMode: "local" },
        });
      }
    }

    const project = await tx.project.create({
      data: {
        title: input.title,
        // Retained only for the legacy non-null SQLite column; it is not an orchestration cursor.
        currentNodeKey: "requirement_spec",
        ownerUserId: input.ownerUserId,
        grade: input.grade,
        subject: input.subject,
        textbookVersion: input.textbookVersion,
        lessonTopic: input.lessonTopic,
      },
    });

    if (input.ownerUserId) {
      await tx.projectMembership.upsert({
        where: { projectId_userId: { projectId: project.id, userId: input.ownerUserId } },
        update: { role: "owner" },
        create: { projectId: project.id, userId: input.ownerUserId, role: "owner" },
      });
    }

    return project;
  });
}

async function getProject(client: PrismaClient, projectId: string) {
  return client.project.findUnique({ where: { id: projectId } });
}

async function advanceProjectIntentEpoch(client: PrismaClient, projectId: string, expectedIntentEpoch: number) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const updated = await tx.project.updateMany({
      where: { id: projectId, intentEpoch: expectedIntentEpoch },
      data: { intentEpoch: { increment: 1 } },
    });
    if (updated.count !== 1) throw new Error("Project intent epoch conflict.");
    return tx.project.findUniqueOrThrow({ where: { id: projectId } });
  });
}

async function updateProjectGenerationIntensity(
  client: PrismaClient,
  projectId: string,
  input: { intensity: string; expectedVersion: number },
) {
  const updated = await client.project.updateMany({
    where: { id: projectId, archivedAt: null, deletedAt: null, intensityVersion: input.expectedVersion },
    data: { generationIntensity: input.intensity, intensityVersion: { increment: 1 } },
  });
  if (updated.count !== 1) {
    const project = await client.project.findUnique({ where: { id: projectId }, select: { archivedAt: true, deletedAt: true } });
    if (!project || project.archivedAt || project.deletedAt) {
      throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "该项目当前不可继续编辑。");
    }
    throw new Error("Project generation intensity version conflict.");
  }
  return client.project.findUniqueOrThrow({ where: { id: projectId } });
}

export function createProjectRepository(client: PrismaClient = prisma) {
  return {
    listProjects: listProjects.bind(null, client),
    createProject: createProject.bind(null, client),
    getProject: getProject.bind(null, client),
    advanceProjectIntentEpoch: advanceProjectIntentEpoch.bind(null, client),
    updateProjectGenerationIntensity: updateProjectGenerationIntensity.bind(null, client),
  };
}
