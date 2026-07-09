import type { ArtifactItem, ProjectItem } from "@/lib/types";

export type WorkbenchExecutionFeedback = {
  label: string;
  stageIndex: number;
};

type ProgressArtifact = Pick<ArtifactItem, "kind" | "nodeKey" | "status">;

export function deriveWorkbenchStageIndex({
  project,
  artifacts,
  executionFeedback,
}: {
  project: Pick<ProjectItem, "currentStep"> | null;
  artifacts: ProgressArtifact[];
  executionFeedback: WorkbenchExecutionFeedback | null;
}) {
  const projectStage = stageIndexFromProjectStep(project?.currentStep ?? "");
  const artifactStage = stageIndexFromArtifacts(artifacts);
  const feedbackStage = executionFeedback?.stageIndex ?? 0;

  return Math.max(projectStage, artifactStage, feedbackStage, 0);
}

function stageIndexFromProjectStep(step: string) {
  if (/交付|完成/.test(step)) return 4;
  if (/检查|优化|重审/.test(step)) return 3;
  if (/PPT|图片|视频|导入|资源/.test(step)) return 2;
  if (/教材|教案|教学/.test(step)) return 1;
  return 0;
}

function stageIndexFromArtifacts(artifacts: ProgressArtifact[]) {
  return artifacts.reduce((highest, artifact) => {
    if (!isProgressed(artifact.status)) return highest;
    const key = artifact.nodeKey ?? artifact.kind;
    if (key === "final_delivery" || key === "final_delivery_checklist") return Math.max(highest, 4);
    if (key === "video_storyboard") return Math.max(highest, 3);
    if (key === "ppt_draft" || key === "ppt_outline" || key === "intro_video_plan" || key === "image_prompts") return Math.max(highest, 2);
    if (key === "lesson_plan" || key === "textbook_evidence") return Math.max(highest, 1);
    return highest;
  }, 0);
}

function isProgressed(status: ArtifactItem["status"]) {
  return status === "in_progress" || status === "needs_review" || status === "approved" || status === "stale";
}
