import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { routeToolCall } from "@/server/tools/tool-router";
import { isVerifiedProviderToolSuccess } from "@/server/tools/tool-types";
import type { ArtifactKind, WorkflowNodeKey } from "@/server/workbench/types";
import {
  assertRouteLevelGenerationConfirmation,
  readConfirmedActionId,
  readRouteGenerationBody,
  routeLevelGenerationConfirmationStatus,
} from "@/server/guards/route-level-generation-gate";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    let projectId = "";
    let jobId: string | null = null;
    try {
      const params = await context.params;
      projectId = params.projectId;
      const { artifactId } = params;
      const body = await readRouteGenerationBody(request);
      const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
      if (sourceArtifact.nodeKey !== "ppt_design_draft" || sourceArtifact.kind !== "ppt_design_draft") {
        return NextResponse.json({ error: "需要先生成 PPT 设计稿，才能生成真实 PPTX 文件。" }, { status: 400 });
      }
      assertRouteLevelGenerationConfirmation({
        projectId,
        capabilityId: "coze_ppt",
        sourceArtifact,
        confirmedActionId: readConfirmedActionId(body),
      });
      const queuedJob = await service.createGenerationJob(projectId, {
        kind: "pptx",
        sourceArtifactId: sourceArtifact.id,
      });
      jobId = queuedJob.id;
      await service.startGenerationJob(projectId, jobId);

      const result = await routeToolCall({
        capabilityId: "coze_ppt",
        projectId,
        project,
        artifactRefs: [{
          kind: sourceArtifact.kind,
          artifactId: sourceArtifact.id,
          title: sourceArtifact.title,
          summary: sourceArtifact.summary,
          markdownContent: sourceArtifact.markdownContent,
          structuredContent: sourceArtifact.structuredContent,
        }],
        resolvedArtifacts: [sourceArtifact],
      });
      if (!isVerifiedProviderToolSuccess(result)) {
        const teacherSafeError = result.status === "succeeded"
          ? "PPTX 生成结果没有通过交付校验，我没有保存这份结果。"
          : result.observation.teacherSafeSummary;
        await service.failGenerationJob(projectId, jobId, { errorMessage: teacherSafeError });
        jobId = null;
        return NextResponse.json({ error: teacherSafeError }, { status: 400 });
      }

      const artifact = await service.saveArtifact(projectId, {
        nodeKey: result.artifactDraft.nodeKey as WorkflowNodeKey,
        kind: result.artifactDraft.kind as ArtifactKind,
        title: result.artifactDraft.title,
        status: "needs_review",
        summary: result.artifactDraft.summary,
        markdownContent: result.artifactDraft.markdownContent ?? "",
        structuredContent: result.artifactDraft.structuredContent,
      });
      const job = await service.finishGenerationJob(projectId, jobId, { resultArtifactId: artifact.id });

      return NextResponse.json({ artifact, job });
    } catch (error) {
      if (projectId && jobId) {
        await service.failGenerationJob(projectId, jobId, { errorMessage: "Coze PPT generation failed" }).catch(() => null);
      }
      const message = error instanceof Error ? error.message : "Coze PPT generation failed";
      const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
      const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
      return NextResponse.json({ error: "这个 PPT 文件暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}
