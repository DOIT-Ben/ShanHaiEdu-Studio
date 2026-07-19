import type { Project } from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import { canReadProject, canTriggerGeneration, canWriteProjectContent } from "@/server/auth/authorization";
import type { WorkbenchRepository } from "./repository";
import type { ExecutionIdentitySnapshot, ProjectExecutionGuard } from "./types";

export type WorkbenchProjectAccess = "read" | "write" | "generate";

export type WorkbenchServiceContext = {
  repository: WorkbenchRepository;
  actor?: WorkbenchActor;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionGuard?: ProjectExecutionGuard;
  ensureProjectAccess(projectId: string, access?: WorkbenchProjectAccess): Promise<Project>;
};

export function createWorkbenchServiceContext(input: {
  repository: WorkbenchRepository;
  actor?: WorkbenchActor;
  executionIdentity?: ExecutionIdentitySnapshot;
  executionGuard?: ProjectExecutionGuard;
}): WorkbenchServiceContext {
  async function ensureProjectAccess(
    projectId: string,
    access: WorkbenchProjectAccess = "read",
  ): Promise<Project> {
    const project = await input.repository.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (input.executionGuard && access !== "read") {
      await input.repository.assertExecutionGuard(projectId, input.executionGuard);
      return project;
    }
    if (!canAccessProject(project, input.actor, access)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  return { ...input, ensureProjectAccess };
}

function canAccessProject(
  project: Project,
  actor: WorkbenchActor | undefined,
  access: WorkbenchProjectAccess,
) {
  if (access === "write") return canWriteProjectContent(project, actor);
  if (access === "generate") return canTriggerGeneration(project, actor);
  return canReadProject(project, actor);
}
