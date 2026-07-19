import { deriveGenerationIntensitySuggestion } from "@/server/generation-intensity/generation-intensity-policy";
import type { ProjectSnapshot } from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import {
  mapArtifact,
  mapConversationTurnJob,
  mapGenerationJob,
  mapMessage,
  mapProject,
  mapVideoShot,
} from "./workbench-service-mappers";

export function createWorkbenchSnapshotService(context: WorkbenchServiceContext) {
  const { actor, ensureProjectAccess, repository } = context;
  return {
    async getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
      const project = await ensureProjectAccess(projectId);
      const [messages, artifacts, generationJobs, videoShots, turnJobs, reactions] = await Promise.all([
        repository.getMessages(projectId),
        repository.getArtifacts(projectId),
        repository.getGenerationJobs(projectId),
        typeof repository.getVideoShots === "function"
          ? repository.getVideoShots(projectId)
          : Promise.resolve([]),
        repository.getConversationTurnJobs(projectId),
        actor?.userId && typeof repository.getMessageReactions === "function"
          ? repository.getMessageReactions(projectId, actor.userId)
          : Promise.resolve([]),
      ]);
      const reactionsByMessageId = new Map(reactions.map((reaction) => [reaction.messageId, reaction.value]));
      const mappedProject = mapProject(project);
      const mappedTurnJobs = turnJobs.map(mapConversationTurnJob);
      mappedProject.generationIntensitySuggestion = deriveGenerationIntensitySuggestion({
        current: mappedProject.generationIntensity ?? "standard",
        intentEpoch: mappedProject.intentEpoch ?? 0,
        recentJobs: mappedTurnJobs,
      });
      return {
        project: mappedProject,
        messages: messages.map((message) => mapMessage(message, reactionsByMessageId.get(message.id))),
        artifacts: artifacts.map(mapArtifact),
        generationJobs: generationJobs.map(mapGenerationJob),
        videoShots: videoShots.map(mapVideoShot),
        turnJobs: mappedTurnJobs,
      };
    },
  };
}
