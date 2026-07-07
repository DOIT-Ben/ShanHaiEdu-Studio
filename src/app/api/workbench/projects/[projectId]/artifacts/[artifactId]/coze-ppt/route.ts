import { NextResponse } from "next/server";
import { generateCozePptFromArtifact } from "@/server/coze-ppt/coze-ppt-run";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { projectId, artifactId } = await context.params;
    const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
    if (sourceArtifact.nodeKey !== "ppt_draft" && sourceArtifact.kind !== "ppt_draft") {
      return NextResponse.json({ error: "这个 PPT 暂时不能生成真实文件。" }, { status: 400 });
    }

    const generated = await generateCozePptFromArtifact({ project, artifact: sourceArtifact });
    const artifact = await service.saveArtifact(projectId, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "真实 PPTX 文件",
      status: "needs_review",
      summary: "已生成可下载的真实 PPTX 文件，请下载后核对页面内容。",
      markdownContent: [
        "# 真实 PPTX 文件",
        "",
        "已基于当前 PPT 大纲生成真实 PPTX 文件。",
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
            generationMode: "coze_generated",
            sourceArtifactId: sourceArtifact.id,
          },
        },
        文件状态: "真实 PPTX 已生成",
        文件大小: `${generated.bytes} bytes`,
      },
    });

    return NextResponse.json({ artifact });
  } catch {
    return NextResponse.json({ error: "这个 PPT 文件暂时没有生成成功，请稍后再试。" }, { status: 400 });
  }
}
