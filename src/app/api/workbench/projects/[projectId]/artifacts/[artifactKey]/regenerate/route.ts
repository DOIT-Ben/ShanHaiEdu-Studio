import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, WorkflowNodeKey } from "@/server/workbench/types";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactKey: string }>;
};

const nodeKeys = new Set<WorkflowNodeKey>([
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "ppt_draft",
  "intro_video_plan",
  "image_prompts",
  "video_storyboard",
  "final_delivery",
]);

export async function POST(_request: Request, context: RouteContext) {
  const { projectId, artifactKey } = await context.params;
  const nodeKey = assertNodeKey(artifactKey);
  const artifacts = await service.getArtifacts(projectId);
  const latest = artifacts
    .filter((artifact) => artifact.nodeKey === nodeKey)
    .sort((left, right) => right.version - left.version)[0];

  if (!latest) {
    throw new Error("Artifact not found");
  }

  const artifact = await service.saveArtifact(projectId, {
    nodeKey,
    kind: latest.kind as ArtifactKind,
    title: latest.title,
    status: "needs_review",
    summary: `${latest.summary} 已保留旧版，新草稿等待确认。`,
    markdownContent: latest.markdownContent,
    structuredContent: {
      ...latest.structuredContent,
      regeneratedFromArtifactId: latest.id,
    },
  });

  return NextResponse.json({ artifact }, { status: 201 });
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  const normalized = typeof value === "string" ? value.replaceAll("-", "_") : "";
  if (nodeKeys.has(normalized as WorkflowNodeKey)) {
    return normalized as WorkflowNodeKey;
  }
  throw new Error("Invalid artifact key");
}
