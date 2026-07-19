import type { UpsertVideoShotsInput, VideoShotRecord } from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import { mapVideoShot } from "./workbench-service-mappers";

export function createWorkbenchVideoShotService(context: WorkbenchServiceContext) {
  const { ensureProjectAccess, repository } = context;
  return {
    async upsertVideoShots(projectId: string, input: UpsertVideoShotsInput): Promise<VideoShotRecord[]> {
      await ensureProjectAccess(projectId, "generate");
      return (await repository.upsertVideoShots(projectId, input)).map(mapVideoShot);
    },

    async recordVideoShotProviderTask(
      projectId: string,
      sourceArtifactId: string,
      shotId: string,
      providerTaskId: string,
    ): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.recordVideoShotProviderTask(
        projectId,
        sourceArtifactId,
        shotId,
        providerTaskId,
      ));
    },

    async selectVideoShotArtifact(
      projectId: string,
      sourceArtifactId: string,
      shotId: string,
      artifactId: string,
      qa: Record<string, unknown> = {},
    ): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.selectVideoShotArtifact(
        projectId,
        sourceArtifactId,
        shotId,
        artifactId,
        qa,
      ));
    },

    async updateVideoShotQa(
      projectId: string,
      sourceArtifactId: string,
      shotId: string,
      status: "ready" | "needs_retake" | "failed",
      qa: Record<string, unknown>,
    ): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.updateVideoShotQa(
        projectId,
        sourceArtifactId,
        shotId,
        status,
        qa,
      ));
    },

    async getVideoShots(projectId: string, sourceArtifactId?: string): Promise<VideoShotRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getVideoShots(projectId, sourceArtifactId)).map(mapVideoShot);
    },
  };
}
