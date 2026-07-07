import { randomUUID } from "node:crypto";
import type { AgentRuntime, AgentRuntimeTask, ApprovedArtifactInput } from "@/server/agent-runtime/types";
import { DeterministicRuntime } from "@/server/agent-runtime";
import type { ArtifactRecord } from "./types";
import { createWorkbenchService } from "./service";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type M2RuntimeTask = Extract<AgentRuntimeTask, "textbook_evidence" | "lesson_plan">;

const runtime = new DeterministicRuntime();

export async function advanceM2AfterApproval(
  projectId: string,
  approvedArtifact: ArtifactRecord,
  service: WorkbenchService,
  agentRuntime: AgentRuntime = runtime,
) {
  if (approvedArtifact.nodeKey === "requirement_spec") {
    await generateNextArtifactIfMissing(projectId, "textbook_evidence", service, agentRuntime, [approvedArtifact]);
  }

  if (approvedArtifact.nodeKey === "textbook_evidence") {
    const approvedInputs = await service.getApprovedInputs(projectId, "lesson_plan");
    const hasRequiredInputs = approvedInputs.some((artifact) => artifact.nodeKey === "requirement_spec") && approvedInputs.some((artifact) => artifact.nodeKey === "textbook_evidence");
    if (hasRequiredInputs) {
      await generateNextArtifactIfMissing(projectId, "lesson_plan", service, agentRuntime, approvedInputs);
    }
  }
}

async function generateNextArtifactIfMissing(
  projectId: string,
  task: M2RuntimeTask,
  service: WorkbenchService,
  agentRuntime: AgentRuntime,
  approvedInputs: ArtifactRecord[],
) {
  const snapshot = await service.getProjectSnapshot(projectId);
  const existing = snapshot.artifacts.some((artifact) => artifact.nodeKey === task && ["needs_review", "approved", "stale"].includes(artifact.status));
  if (existing) return;

  const project = await service.getProject(projectId);
  const result = await agentRuntime.run({
    projectId,
    runId: randomUUID(),
    task,
    userMessage: approvedInputs.map((artifact) => `${artifact.title}：${artifact.summary}`).join("\n"),
    projectContext: {
      grade: project.grade ?? "五年级",
      subject: project.subject ?? "数学",
      topic: project.lessonTopic ?? "百分数",
      textbookVersion: project.textbookVersion ?? undefined,
      teacherGoal: approvedInputs.find((artifact) => artifact.nodeKey === "requirement_spec")?.summary,
      requestedOutputs: ["需求规格", "教材说明", "教案", "PPT 大纲", "导入视频方案"],
    },
    approvedArtifacts: approvedInputs.map(toApprovedArtifactInput),
  });

  if (result.status !== "succeeded") return;

  await service.saveArtifact(projectId, {
    nodeKey: task,
    kind: task,
    title: result.artifactDraft.title,
    status: "needs_review",
    summary: result.artifactDraft.summary,
    markdownContent: result.artifactDraft.markdown,
    structuredContent: {
      generationMode: result.artifactDraft.generationMode,
      nextSuggestedAction: result.nextSuggestedAction.label,
    },
  });
}

function toApprovedArtifactInput(artifact: ArtifactRecord): ApprovedArtifactInput {
  return {
    nodeKey: artifact.nodeKey,
    title: artifact.title,
    summary: artifact.summary,
    markdown: artifact.markdownContent,
  };
}
