import { describe, expect, it } from "vitest";

import { createValidationReport } from "@/server/contracts/contract-validator";
import { createCriticReport, resolveEffectiveRubric } from "@/server/quality/critic-report";
import { decideQuality } from "@/server/quality/quality-decision-engine";
import {
  applyTeacherRevision,
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  clearRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  guardFinish,
  guardReActTransition,
  readAgentObservationsFromMessages,
  readLatestRunCheckpointFromMessages,
  requiresWorkingPlan,
  type WorkingPlan,
} from "@/server/conversation/react-control";

describe("V1 Stage 2C Observation and Replan", () => {
  it("returns a nonfatal failure to ReAct and allows a different action", () => {
    const failure = failedObservation("generate_pptx", "input-a", "provider_timeout");
    const decision = guardReActTransition({
      projectId: "project-1",
      planVersion: 1,
      candidate: { actionKey: "repair_ppt_design", inputHash: "input-b", requestedNextAction: "repair_upstream" },
      latestObservation: failure,
      observationHistory: [failure],
    });
    expect(decision).toMatchObject({ allowed: true, nextAction: "repair_upstream" });
  });

  it("blocks a third identical retry after two matching failure signatures", () => {
    const first = failedObservation("generate_pptx", "input-a", "provider_timeout", "obs-1");
    const second = failedObservation("generate_pptx", "input-a", "provider_timeout", "obs-2");
    const decision = guardReActTransition({
      projectId: "project-1",
      planVersion: 2,
      candidate: { actionKey: "generate_pptx", inputHash: "input-a", requestedNextAction: "continue" },
      latestObservation: second,
      observationHistory: [first, second],
    });
    expect(decision).toMatchObject({ allowed: false, nextAction: "pause", checkpoint: { status: "paused", reason: "repeated_failure" } });
  });

  it("routes page-scoped quality repair to only the located unit", () => {
    const observation = createAgentObservation({
      projectId: "project-1",
      source: "quality",
      status: "repair",
      actionKey: "review_ppt",
      inputHash: "quality-input",
      reasonCodes: ["critic_major_present"],
      reportRefs: [],
      targetLocators: [{ kind: "page", pageId: "page-5", parentArtifactId: "ppt-1" }],
      responsibleStage: "ppt_page_layout",
      minimalNextAction: "repair_unit",
      teacherSafeSummary: "第 5 页需要局部调整。",
    });
    const decision = guardReActTransition({
      projectId: "project-1",
      planVersion: 2,
      candidate: { actionKey: "repair_ppt", inputHash: "repair-input", requestedNextAction: "repair_unit" },
      latestObservation: observation,
      observationHistory: [observation],
    });
    expect(decision).toMatchObject({ allowed: true, nextAction: "repair_unit" });
    expect(decision.repairTargets).toEqual([{ kind: "page", pageId: "page-5", parentArtifactId: "ppt-1" }]);
  });

  it("increments plan version and invalidates downstream reports after a teacher revises the outline", () => {
    const plan: WorkingPlan = {
      planId: "plan-1",
      planVersion: 3,
      goal: "制作百分数公开课",
      steps: [
        { stage: "brief", status: "succeeded" },
        { stage: "narrative_outline", status: "succeeded" },
        { stage: "page_design", status: "succeeded" },
        { stage: "pptx", status: "succeeded" },
      ],
      reportRefs: [{ id: "report-outline", stage: "narrative_outline" }, { id: "report-pptx", stage: "pptx" }],
      decisionRefs: [{ id: "decision-pptx", stage: "pptx" }],
    };
    const revised = applyTeacherRevision({ projectId: "project-1", plan, revisedStage: "narrative_outline", newGoal: "修改叙事大纲后继续" });
    expect(revised.plan.planVersion).toBe(4);
    expect(revised.plan.steps).toEqual([
      { stage: "brief", status: "succeeded" },
      { stage: "narrative_outline", status: "active" },
      { stage: "page_design", status: "stale" },
      { stage: "pptx", status: "stale" },
    ]);
    expect(revised.invalidatedReportRefs).toEqual(["report-outline", "report-pptx"]);
    expect(revised.invalidatedDecisionRefs).toEqual(["decision-pptx"]);
  });

  it("creates a paused checkpoint when budget is exhausted", () => {
    const decision = guardReActTransition({
      projectId: "project-1",
      planVersion: 5,
      candidate: { actionKey: "generate_video", inputHash: "video-input", requestedNextAction: "continue" },
      observationHistory: [],
      budgetExhausted: true,
    });
    expect(decision).toMatchObject({ allowed: false, nextAction: "pause", checkpoint: { status: "paused", reason: "budget_exhausted", planVersion: 5 } });
  });

  it("rejects finish without current ValidationReport and passing QualityDecision evidence", () => {
    expect(guardFinish()).toMatchObject({ allowed: false });
    const evidence = passingEvidence();
    expect(guardFinish(evidence)).toEqual({ allowed: true, reasonCodes: [] });
    expect(guardFinish({ ...evidence, artifact: { ...evidence.artifact, digest: "changed" } })).toMatchObject({ allowed: false });
    expect(guardFinish({
      ...evidence,
      qualityDecision: { ...evidence.qualityDecision, validationReportDigests: ["another-validation"] },
    })).toMatchObject({ allowed: false, reasonCodes: expect.arrayContaining(["quality_validation_binding_mismatch"]) });
  });

  it("does not require a WorkingPlan for chat or one bounded tool call", () => {
    expect(requiresWorkingPlan({ interactionKind: "chat", actionCount: 0 })).toBe(false);
    expect(requiresWorkingPlan({ interactionKind: "single_tool", actionCount: 1 })).toBe(false);
    expect(requiresWorkingPlan({ interactionKind: "multi_step", actionCount: 3 })).toBe(true);
  });

  it("restores observations and the latest paused checkpoint from persisted message metadata", () => {
    const observation = failedObservation("generate_pptx", "input-a", "provider_timeout", "obs-persisted");
    const checkpoint = createRunCheckpoint({
      checkpointId: "checkpoint-persisted",
      projectId: "project-1",
      planVersion: 6,
      reason: "budget_exhausted",
      actionKey: observation.actionKey,
      inputHash: observation.inputHash,
      observationRefs: [observation.observationId],
      createdAt: "2026-07-12T05:00:00.000Z",
    });
    const metadata = appendRunCheckpointMetadata(appendAgentObservationMetadata(undefined, observation), checkpoint);
    const reloadedMessages = [{ metadata: JSON.parse(JSON.stringify(metadata)) }];

    expect(readAgentObservationsFromMessages(reloadedMessages)).toEqual([observation]);
    expect(readLatestRunCheckpointFromMessages(reloadedMessages)).toEqual(checkpoint);
    expect(readLatestRunCheckpointFromMessages([
      ...reloadedMessages,
      { metadata: clearRunCheckpointMetadata(undefined) },
    ])).toBeNull();
  });

  it("only blocks two consecutive failures with the same action, input, and reason", () => {
    const first = failedObservation("generate_pptx", "input-a", "provider_timeout", "obs-1");
    const differentInput = failedObservation("generate_pptx", "input-b", "provider_timeout", "obs-2");
    const second = failedObservation("generate_pptx", "input-a", "provider_timeout", "obs-3");
    const decision = guardReActTransition({
      projectId: "project-1",
      planVersion: 2,
      candidate: { actionKey: "generate_pptx", inputHash: "input-a", requestedNextAction: "continue" },
      latestObservation: second,
      observationHistory: [first, differentInput, second],
    });

    expect(decision).toMatchObject({ allowed: true, nextAction: "continue" });
  });
});

function failedObservation(actionKey: string, inputHash: string, reason: string, observationId?: string) {
  return createAgentObservation({
    observationId,
    projectId: "project-1",
    source: "tool",
    status: "failed",
    actionKey,
    inputHash,
    reasonCodes: [reason],
    reportRefs: [],
    targetLocators: [],
    minimalNextAction: "continue",
    teacherSafeSummary: "这一步暂时没有完成。",
  });
}

function passingEvidence() {
  const artifact = { id: "artifact-1", version: 1, digest: "artifact-digest" };
  const validation = createValidationReport({
    reportId: "validation-1",
    createdAt: "2026-07-12T00:00:00.000Z",
    domain: "ppt",
    stage: "ppt_final",
    target: { kind: "artifact", targetId: artifact.id, targetVersion: artifact.version, targetDigest: artifact.digest },
    contract: { id: "ppt.final", version: "v1" },
    overallStatus: "passed",
    gates: [],
  });
  const rubric = resolveEffectiveRubric("ppt_final");
  const target = { artifactId: artifact.id, artifactVersion: artifact.version, artifactDigest: artifact.digest, productionPath: "ppt_quality_asset_assembly" };
  const critic = createCriticReport({
    reportId: "critic-1",
    createdAt: "2026-07-12T00:01:00.000Z",
    status: "complete",
    domain: "ppt",
    stage: "ppt_final",
    target,
    validationReportRefs: [{ reportId: validation.reportId, digest: validation.reportDigest }],
    effectiveRubric: { id: rubric.id, version: rubric.version, digest: rubric.digest },
    targetLocators: [{ kind: "artifact", artifactKind: "pptx_artifact", artifactId: artifact.id }],
    dimensions: rubric.dimensions.map((dimension, index) => ({ dimensionId: dimension.dimensionId, score: 95, evidenceRefs: [`render:${index}`], rationale: "通过。" })),
    findings: [],
    recommendation: "pass",
  });
  const qualityDecision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });
  return { artifact, validationReport: validation, qualityDecision };
}
