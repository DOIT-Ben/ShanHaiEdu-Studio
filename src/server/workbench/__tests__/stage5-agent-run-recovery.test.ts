import { describe, expect, it } from "vitest";
import { POST as postStartRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/route";
import { POST as postFinishRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/[runId]/finish/route";
import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { prisma } from "@/server/db/client";
import { createCriticReport, resolveEffectiveRubric } from "@/server/quality/critic-report";
import { decideQuality } from "@/server/quality/quality-decision-engine";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 5 AgentRun recovery", () => {
  it("starts an agent run and marks the node in progress", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 运行项目" });

    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");

    expect(run).toMatchObject({
      projectId: project.id,
      nodeKey: "lesson_plan",
      status: "running",
      runtime: "deterministic",
      finishedAt: null,
    });
    expect(node?.status).toBe("in_progress");
  });

  it("records failure and keeps the old approved artifact recoverable", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 失败恢复项目" });
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "旧教案",
      markdownContent: "# old lesson",
    });
    await service.approveArtifact(project.id, lesson.id);
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const failed = await service.finishAgentRun(project.id, run.id, {
      status: "failed",
      errorMessage: "生成未完成，请稍后重试。",
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");
    const retained = snapshot.artifacts.find((artifact) => artifact.id === lesson.id);

    expect(failed).toMatchObject({
      id: run.id,
      status: "failed",
      errorMessage: "生成未完成，请稍后重试。",
    });
    expect(failed.finishedAt).not.toBeNull();
    expect(node).toMatchObject({
      status: "failed",
      approvedArtifactId: lesson.id,
    });
    expect(retained).toMatchObject({
      markdownContent: "# old lesson",
      isApproved: true,
    });
  });

  it("rejects succeeded status when the run has no current validation and quality evidence", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 成功运行项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "ppt_draft",
      runtime: "deterministic",
    });

    await expect(service.finishAgentRun(project.id, run.id, {
      status: "succeeded",
    })).rejects.toThrow("缺少当前材料");
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "ppt_draft");
    const persistedRun = snapshot.agentRuns.find((entry) => entry.id === run.id);

    expect(persistedRun).toMatchObject({ status: "running", finishedAt: null });
    expect(node?.status).toBe("in_progress");
  });

  it("finishes a run only when the route binds a current Artifact, passing ValidationReport, and passing QualityDecision", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2C finish evidence 项目" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "逐页 PPT 大纲",
      status: "needs_review",
      summary: "当前待验收产物",
      markdownContent: "# 逐页 PPT 大纲",
      structuredContent: { pages: [{ page: 1, title: "导入" }] },
    });
    const run = await service.startAgentRun(project.id, { nodeKey: "ppt_draft", runtime: "deterministic" });
    const evidence = await persistPassingFinishEvidence(project.id, artifact);

    const response = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "succeeded", evidence }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: run.id }) },
    );
    const body = await response.json();
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(response.status).toBe(200);
    expect(body.run).toMatchObject({ id: run.id, status: "succeeded" });
    expect(snapshot.nodes.find((entry) => entry.key === "ppt_draft")?.status).not.toBe("approved");
  });

  it("rejects finishing another project's run", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 5 项目 A" });
    const projectB = await service.createProject({ title: "Stage 5 项目 B" });
    const runA = await service.startAgentRun(projectA.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    await expect(
      service.finishAgentRun(projectB.id, runA.id, {
        status: "failed",
        errorMessage: "不应写入",
      }),
    ).rejects.toThrow("AgentRun not found");

    const snapshotB = await service.getProjectSnapshot(projectB.id);
    expect(snapshotB.agentRuns).toEqual([]);
  });

  it("returns stable route envelopes for start and failed finish", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 route 项目" });

    const startResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "lesson_plan", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const startBody = await startResponse.json();
    const finishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "route 失败" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: startBody.run.id }) },
    );
    const finishBody = await finishResponse.json();

    expect(startResponse.status).toBe(201);
    expect(startBody.run).toMatchObject({ status: "running", nodeKey: "lesson_plan" });
    expect(finishResponse.status).toBe(200);
    expect(finishBody.run).toMatchObject({ status: "failed", errorMessage: "route 失败" });
  });

  it("returns route-level errors for invalid node keys and cross-project run finish", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 5 route A" });
    const projectB = await service.createProject({ title: "Stage 5 route B" });
    const runA = await service.startAgentRun(projectA.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const invalidStartResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "bad_node", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId: projectB.id }) },
    );
    const crossProjectFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "不应写入" }),
      }),
      { params: Promise.resolve({ projectId: projectB.id, runId: runA.id }) },
    );

    expect(invalidStartResponse.status).toBe(400);
    await expect(invalidStartResponse.json()).resolves.toMatchObject({ error: "Invalid nodeKey" });
    expect(crossProjectFinishResponse.status).toBe(404);
    await expect(crossProjectFinishResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("AgentRun not found") });
  });

  it("returns route-level 400 for invalid finish status", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 invalid finish 项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const invalidFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "done" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: run.id }) },
    );
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");
    const persistedRun = snapshot.agentRuns.find((entry) => entry.id === run.id);

    expect(invalidFinishResponse.status).toBe(400);
    await expect(invalidFinishResponse.json()).resolves.toMatchObject({ error: "Invalid run status" });
    expect(node?.status).toBe("in_progress");
    expect(persistedRun?.status).toBe("running");
  });
});

async function persistPassingFinishEvidence(
  projectId: string,
  artifact: Awaited<ReturnType<ReturnType<typeof createWorkbenchService>["saveArtifact"]>>,
) {
  const artifactDigest = hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  });
  const validation = createValidationReport({
    reportId: `validation-finish-${artifact.id}`,
    createdAt: new Date().toISOString(),
    domain: "ppt",
    stage: "ppt_final",
    target: { kind: "artifact", targetId: artifact.id, targetVersion: artifact.version, targetDigest: artifactDigest },
    contract: { id: "ppt.final", version: "v1" },
    overallStatus: "passed",
    gates: [],
  });
  const rubric = resolveEffectiveRubric("ppt_final");
  const target = {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    artifactDigest,
    productionPath: "ppt_quality_asset_assembly",
  };
  const critic = createCriticReport({
    reportId: `critic-finish-${artifact.id}`,
    createdAt: new Date().toISOString(),
    status: "complete",
    domain: "ppt",
    stage: "ppt_final",
    target,
    validationReportRefs: [{ reportId: validation.reportId, digest: validation.reportDigest }],
    effectiveRubric: { id: rubric.id, version: rubric.version, digest: rubric.digest },
    targetLocators: [{ kind: "artifact", artifactKind: artifact.kind, artifactId: artifact.id }],
    dimensions: rubric.dimensions.map((dimension, index) => ({
      dimensionId: dimension.dimensionId,
      score: 95,
      evidenceRefs: [`render:${index}`],
      rationale: "通过。",
    })),
    findings: [],
    recommendation: "pass",
  });
  const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });
  await prisma.validationReportRecord.create({
    data: {
      id: validation.reportId,
      projectId,
      capabilityId: "ppt_outline",
      stage: validation.stage,
      authority: validation.authority,
      domain: validation.domain,
      targetKind: validation.target.kind,
      targetId: validation.target.targetId,
      targetVersion: validation.target.targetVersion,
      targetDigest: validation.target.targetDigest,
      contractId: validation.contract.id,
      contractVersion: validation.contract.version,
      overallStatus: validation.overallStatus,
      reportDigest: validation.reportDigest,
      payloadJson: JSON.stringify(validation),
      artifactId: artifact.id,
      createdAt: new Date(validation.createdAt),
    },
  });
  await prisma.qualityDecisionRecord.create({
    data: {
      id: decision.decisionId,
      projectId,
      artifactId: artifact.id,
      decisionDigest: decision.decisionDigest,
      authority: decision.authority,
      domain: decision.domain,
      stage: decision.stage,
      targetVersion: decision.target.artifactVersion,
      targetDigest: decision.target.artifactDigest,
      productionPath: decision.target.productionPath,
      inputHash: decision.inputHash,
      outcome: decision.outcome,
      weightedScore: decision.weightedScore,
      reasonCodesJson: JSON.stringify(decision.reasonCodes),
      nextAction: decision.nextAction,
      repairTargetsJson: JSON.stringify(decision.repairTargets),
      deliveryEligibility: decision.deliveryEligibility,
      validationDigestsJson: JSON.stringify(decision.validationReportDigests),
      rubricDigest: decision.rubricDigest,
      payloadJson: JSON.stringify(decision),
      createdAt: new Date(decision.createdAt),
    },
  });
  return {
    artifactId: artifact.id,
    validationReportId: validation.reportId,
    qualityDecisionId: decision.decisionId,
  };
}
