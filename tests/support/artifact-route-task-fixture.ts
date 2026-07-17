import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import type { ProjectRecord } from "@/server/workbench/types";

export async function seedArtifactRouteTask(
  project: Pick<ProjectRecord, "id" | "intentEpoch" | "generationIntensity">,
  requestedOutputs: string[],
) {
  const taskBrief = createTaskBrief({
    taskId: `task:artifact-route:${project.id}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: `离线验证 ${requestedOutputs.join("、")} 产物路由`,
    requestedOutputs,
    constraints: ["offline_fixture_only"],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: `message:artifact-route:${project.id}`,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "offline-artifact-route-fixture.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 1,
    requiredCheckpoints: [],
    expiresAt: null,
  };

  await createControlPlaneStore().upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:artifact-route:${project.id}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  return { taskBrief, intentGrant };
}
