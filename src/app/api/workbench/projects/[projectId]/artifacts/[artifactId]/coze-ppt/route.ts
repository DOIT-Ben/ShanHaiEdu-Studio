import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { generateCozePptFromArtifact } from "@/server/coze-ppt/coze-ppt-run";

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
      const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
      if (sourceArtifact.nodeKey !== "ppt_design_draft" || sourceArtifact.kind !== "ppt_design_draft") {
        return NextResponse.json({ error: "需要先生成 PPT 设计稿，才能生成真实 PPTX 文件。" }, { status: 400 });
      }
      const queuedJob = await service.createGenerationJob(projectId, {
        kind: "pptx",
        sourceArtifactId: sourceArtifact.id,
      });
      jobId = queuedJob.id;
      await service.startGenerationJob(projectId, jobId);

      const generated = await generateCozePptFromArtifact({ project, artifact: sourceArtifact });
      const pageLabel = `${generated.slideCount} 页`;
      const artifact = await service.saveArtifact(projectId, {
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        title: `真实 ${pageLabel} PPTX 文件`,
        status: "needs_review",
        summary: `已生成可下载的真实 ${pageLabel} PPTX 文件，请下载后核对页面内容。`,
        markdownContent: [
          `# 真实 ${pageLabel} PPTX 文件`,
          "",
          `已基于当前逐页四层 PPT 设计稿生成真实 ${pageLabel} PPTX 文件。`,
          "",
          "正式授课前请核对教材、页码、例题、页面顺序和课堂节奏。",
        ].join("\n"),
        structuredContent: {
          storage: {
            cozePptx: {
              localOutput: generated.localOutput,
              fileName: generated.fileName,
              bytes: generated.bytes,
              sha256: generated.sha256,
              slideCount: generated.slideCount,
              requestedPageCount: generated.requestedPageCount,
              generationMode: "coze_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
          文件状态: `真实 ${pageLabel} PPTX 已生成`,
          文件大小: `${generated.bytes} bytes`,
          实际页数: pageLabel,
          目标页数: `${generated.requestedPageCount} 页`,
        },
      });
      const job = await service.finishGenerationJob(projectId, jobId, { resultArtifactId: artifact.id });

      return NextResponse.json({ artifact, job });
    } catch (error) {
      if (projectId && jobId) {
        await service.failGenerationJob(projectId, jobId, { errorMessage: "Coze PPT generation failed" }).catch(() => null);
      }
      const message = error instanceof Error ? error.message : "Coze PPT generation failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这个 PPT 文件暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}
