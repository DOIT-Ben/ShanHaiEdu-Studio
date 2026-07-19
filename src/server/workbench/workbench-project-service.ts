import { normalizeGenerationIntensity, type GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import { mutateProjectLifecycle as applyProjectLifecycleMutation } from "./project-lifecycle-service";
import type {
  CreateProjectInput,
  ProjectLifecycleMutation,
  ProjectLifecycleState,
  ProjectRecord,
} from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import { mapProject } from "./workbench-service-mappers";

export function createWorkbenchProjectService(context: WorkbenchServiceContext) {
  const { actor, ensureProjectAccess, repository } = context;
  return {
    async listProjects(view: ProjectLifecycleState = "active"): Promise<ProjectRecord[]> {
      const projects = await repository.listProjects({ actor, view });
      return projects.map(mapProject);
    },

    async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
      const project = await repository.createProject({
        ...input,
        ownerUserId: input.ownerUserId ?? actor?.userId,
      });
      return mapProject(project);
    },

    async getProject(projectId: string): Promise<ProjectRecord> {
      return mapProject(await ensureProjectAccess(projectId));
    },

    async mutateProjectLifecycle(projectId: string, mutation: ProjectLifecycleMutation) {
      const result = await applyProjectLifecycleMutation({ projectId, actor, mutation });
      return { changed: result.changed, project: mapProject(result.project) };
    },

    async advanceProjectIntentEpoch(projectId: string, expectedIntentEpoch: number): Promise<number> {
      await ensureProjectAccess(projectId, "write");
      const project = await repository.advanceProjectIntentEpoch(projectId, expectedIntentEpoch);
      return project.intentEpoch;
    },

    async updateProjectGenerationIntensity(
      projectId: string,
      input: { intensity: GenerationIntensity; expectedVersion: number },
    ) {
      await ensureProjectAccess(projectId, "write");
      const project = await repository.updateProjectGenerationIntensity(projectId, {
        intensity: normalizeGenerationIntensity(input.intensity),
        expectedVersion: input.expectedVersion,
      });
      return mapProject(project);
    },
  };
}
