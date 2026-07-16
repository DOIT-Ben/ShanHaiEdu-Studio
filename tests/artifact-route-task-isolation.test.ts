import { afterEach, describe, expect, it, vi } from "vitest";

const routeToolCallMock = vi.hoisted(() => vi.fn(async () => {
  throw new Error("provider_should_not_run_for_stale_task_source");
}));

vi.mock("@/server/tools/tool-router", () => ({
  routeToolCall: routeToolCallMock,
}));

import { POST as postCozePpt } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route";
import { POST as postImage } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { POST as postVideo } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { prisma } from "@/server/db/client";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

type ArtifactRouteCase = {
  name: string;
  capabilityId: "coze_ppt" | "image_asset" | "video_segment_generate";
  sourceKind: Extract<ArtifactKind, "ppt_design_draft" | "ppt_draft" | "video_segment_plan">;
  post: typeof postImage;
  requestedOutput: string;
};

const routeCases: ArtifactRouteCase[] = [
  {
    name: "image",
    capabilityId: "image_asset",
    sourceKind: "ppt_draft",
    post: postImage,
    requestedOutput: "image",
  },
  {
    name: "video",
    capabilityId: "video_segment_generate",
    sourceKind: "video_segment_plan",
    post: postVideo,
    requestedOutput: "video",
  },
  {
    name: "coze-ppt",
    capabilityId: "coze_ppt",
    sourceKind: "ppt_design_draft",
    post: postCozePpt,
    requestedOutput: "ppt",
  },
];

afterEach(() => {
  routeToolCallMock.mockClear();
});

describe("Artifact route current-task source isolation", () => {
  it.each(routeCases)(
    "rejects an old IntentEpoch source and actionId before the $name Provider or GenerationJob",
    async ({ capabilityId, sourceKind, post, requestedOutput }) => {
      const service = createWorkbenchService();
      const projectA = await service.createProject({ title: `旧任务来源隔离 ${sourceKind}` });
      await seedTask(projectA, `task-a:${projectA.id}`, [requestedOutput]);
      const sourceArtifacts = await createApprovedRouteSources(service, projectA.id, sourceKind);
      const source = sourceArtifacts.find((artifact) => artifact.kind === sourceKind);
      if (!source) throw new Error(`Missing source fixture for ${sourceKind}`);
      const oldActionId = createHumanGateActionId({
        projectId: projectA.id,
        capabilityId,
        messageId: source.id,
      });

      await service.advanceProjectIntentEpoch(projectA.id, projectA.intentEpoch ?? 0);
      const projectB = await service.getProject(projectA.id);
      await seedTask(projectB, `task-b:${projectB.id}`, ["video_script"]);

      const response = await post(
        routeRequest({ confirmedActionId: oldActionId }),
        routeContext(projectB.id, source.id),
      );
      const [jobs, invocationCount] = await Promise.all([
        service.getGenerationJobs(projectB.id),
        prisma.toolInvocationRecord.count({ where: { projectId: projectB.id, intentEpoch: projectB.intentEpoch ?? 0 } }),
      ]);

      expect(response.status).toBe(400);
      expect(routeToolCallMock).not.toHaveBeenCalled();
      expect(jobs).toHaveLength(0);
      expect(invocationCount).toBe(0);
    },
  );

  it("returns only current-task trusted video upstreams from getApprovedInputs", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "视频上游任务隔离" });
    await seedTask(projectA, `task-a:${projectA.id}`, ["video"]);
    const taskAArtifacts = await createApprovedRouteSources(service, projectA.id, "video_segment_plan");

    await service.advanceProjectIntentEpoch(projectA.id, projectA.intentEpoch ?? 0);
    const projectB = await service.getProject(projectA.id);
    const taskB = await seedTask(projectB, `task-b:${projectB.id}`, ["video"]);
    const taskBArtifacts = await createApprovedRouteSources(service, projectB.id, "video_segment_plan");

    const approvedInputs = await service.getApprovedInputs(projectB.id, "video_segment_plan", taskB);
    const taskAIds = new Set(taskAArtifacts.map((artifact) => artifact.id));
    const taskBInputIds = taskBArtifacts
      .filter((artifact) => artifact.kind === "storyboard_generate" || artifact.kind === "asset_image_generate")
      .map((artifact) => artifact.id);

    expect(approvedInputs.map((artifact) => artifact.id)).toEqual(taskBInputIds);
    expect(approvedInputs.some((artifact) => taskAIds.has(artifact.id))).toBe(false);
    expect(approvedInputs.every((artifact) =>
      artifact.taskId === taskB.taskId &&
      artifact.taskBriefDigest === taskB.digest &&
      artifact.intentEpoch === taskB.intentEpoch
    )).toBe(true);
  });
});

async function seedTask(project: ProjectRecord, taskId: string, requestedOutputs: string[]) {
  const taskBrief = createTaskBrief({
    taskId,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: requestedOutputs.includes("video_script") ? "只做当前任务的视频脚本" : "完成当前任务的真实生成入口准备",
    requestedOutputs,
    constraints: ["offline_contract_test"],
    excludedOutputs: requestedOutputs.includes("video_script") ? ["ppt", "image", "video", "package"] : [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: `message:${taskId}`,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "offline-task-isolation.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 1,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await createControlPlaneStore().upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${taskId}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  return taskBrief;
}

async function createApprovedRouteSources(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  sourceKind: ArtifactRouteCase["sourceKind"],
) {
  const kinds: ArtifactKind[] = sourceKind === "video_segment_plan"
    ? ["storyboard_generate", "asset_image_generate", sourceKind]
    : [sourceKind];
  const artifacts: ArtifactRecord[] = [];
  for (const kind of kinds) {
    const draft = await service.saveArtifact(projectId, {
      nodeKey: kind,
      kind,
      title: `旧任务 ${kind}`,
      status: "needs_review",
      summary: `旧任务 ${kind} 来源`,
      markdownContent: `# 旧任务 ${kind}`,
    });
    artifacts.push(await service.approveArtifact(projectId, draft.id));
  }
  return artifacts;
}

function routeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/workbench/projects/project/artifacts/artifact/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function routeContext(projectId: string, artifactId: string) {
  return { params: Promise.resolve({ projectId, artifactId }) };
}
