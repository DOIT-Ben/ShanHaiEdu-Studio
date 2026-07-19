import { validateInteractiveCoursewareSpec } from "@/server/activities/interactive-courseware-spec";
import { getCapabilityDefinition } from "@/server/capabilities/capability-registry";
import type { CapabilityId } from "@/server/capabilities/types";
import type { TaskBrief } from "@/server/conversation/task-contract";
import { isCapabilityInTaskScope } from "@/server/conversation/task-output-scope";
import { buildPptFullDeckReviewArtifact, buildPptSampleReviewArtifact } from "@/server/ppt-quality/ppt-review-artifact";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToRequestedOutput } from "@/server/quality/artifact-truth-boundary";
import type {
  ArtifactRecord,
  SaveArtifactInput,
  SaveInteractiveCoursewareSpecInput,
  SubmitPptFullDeckReviewInput,
  SubmitPptSampleReviewInput,
} from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import { mapArtifact } from "./workbench-service-mappers";

export function createWorkbenchArtifactService(context: WorkbenchServiceContext) {
  const { ensureProjectAccess, repository } = context;
  return {
    async saveArtifact(projectId: string, input: SaveArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      return mapArtifact(await repository.saveArtifact(projectId, input));
    },

    async getArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId);
      const artifact = await repository.getArtifact(projectId, artifactId);
      if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
      return mapArtifact(artifact);
    },

    async approveArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      return mapArtifact(await repository.approveArtifact(projectId, artifactId));
    },

    async saveInteractiveCoursewareSpec(
      projectId: string,
      input: SaveInteractiveCoursewareSpecInput,
    ): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const validation = validateInteractiveCoursewareSpec(input.spec);
      if (!validation.ok) {
        const details = validation.errors.map((entry) => `${entry.path}: ${entry.code}`).join("; ");
        throw new Error(`Interactive courseware spec is invalid: ${details}`);
      }
      const activityCount = input.spec.pages.reduce((total, page) => total + page.activities.length, 0);
      return mapArtifact(await repository.saveArtifact(projectId, {
        nodeKey: "interactive_courseware_spec",
        kind: "interactive_courseware_spec",
        title: `互动课件：${input.spec.title}`,
        status: "needs_review",
        summary: `包含 ${input.spec.pages.length} 个页面和 ${activityCount} 个互动活动，等待教师审阅。`,
        markdownContent: `# ${input.spec.title}\n\n互动课件规格草稿，包含 ${input.spec.pages.length} 个页面和 ${activityCount} 个互动活动。`,
        structuredContent: { interactiveCoursewareSpec: input.spec },
      }));
    },

    async submitPptSampleReview(
      projectId: string,
      artifactId: string,
      input: SubmitPptSampleReviewInput,
    ): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const stored = await repository.getArtifact(projectId, artifactId);
      if (!stored) throw new Error(`Artifact not found: ${artifactId}`);
      const saved = await repository.saveArtifact(projectId, buildPptSampleReviewArtifact(mapArtifact(stored), input));
      return mapArtifact(saved);
    },

    async submitPptFullDeckReview(
      projectId: string,
      artifactId: string,
      input: SubmitPptFullDeckReviewInput,
    ): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const stored = await repository.getArtifact(projectId, artifactId);
      if (!stored) throw new Error(`Artifact not found: ${artifactId}`);
      const saved = await repository.saveArtifact(projectId, buildPptFullDeckReviewArtifact(mapArtifact(stored), input));
      return mapArtifact(saved);
    },

    async getApprovedInputs(
      projectId: string,
      capabilityId: CapabilityId,
      taskBrief: TaskBrief,
    ): Promise<ArtifactRecord[]> {
      await ensureProjectAccess(projectId);
      if (!isCapabilityInTaskScope(capabilityId, taskBrief)) {
        throw new Error(`Capability ${capabilityId} is outside the current task scope.`);
      }
      const upstreamArtifactKinds = Array.from(new Set(
        getCapabilityDefinition(capabilityId).upstreamCapabilities
          .map((upstreamCapabilityId) => getCapabilityDefinition(upstreamCapabilityId).artifactKind),
      ));
      if (upstreamArtifactKinds.length === 0) return [];
      const artifacts = (await repository.getArtifactsByKinds(projectId, upstreamArtifactKinds))
        .map(mapArtifact)
        .filter((artifact) =>
          isArtifactTrustedForDownstream(artifact) && isArtifactBoundToRequestedOutput(artifact, taskBrief));
      const latestByKind = new Map<string, ArtifactRecord>();
      for (const artifact of artifacts) {
        const current = latestByKind.get(artifact.kind);
        if (!current || artifact.version > current.version) latestByKind.set(artifact.kind, artifact);
      }
      return upstreamArtifactKinds.flatMap((kind) => {
        const artifact = latestByKind.get(kind);
        return artifact ? [artifact] : [];
      });
    },

    async getArtifacts(projectId: string): Promise<ArtifactRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getArtifacts(projectId)).map(mapArtifact);
    },
  };
}
