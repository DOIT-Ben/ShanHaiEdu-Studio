import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createExternalAuditRepairHandoff } from "@/server/conversation/external-audit-repair-contract";
import { resolveV1_9ExternalAuditRecoveryAuthority } from "@/server/conversation/external-audit-startup-recovery";
import { resolveV1_9RepositoryRoot } from "@/server/conversation/conversation-turn-recovery";
import {
  createV1_9ExternalAcceptanceReportDigest,
  normalizeV1_9ExternalAcceptanceReport,
} from "@/server/quality/v1-9-external-acceptance";
import {
  advanceV1_9PlanRevision,
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStatePackageReady,
  recordV1_9ExternalAcceptanceRound,
  recordV1_9RunStateMutation,
} from "../scripts/lib/v1-9-e2e-contract.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V1-9 external-audit startup recovery authority", () => {
  it("wires external-audit recovery before Provider-health recovery without requeueing", async () => {
    const source = await readFile(path.resolve("src/server/conversation/conversation-turn-recovery.ts"), "utf8");
    expect(source).toMatch(/resolveV1_9ExternalAuditRecoveryAuthority/);
    expect(source).toMatch(/recoverV1_9ExternalAuditTurn/);
    expect(source.indexOf("resolveV1_9ExternalAuditRecoveryAuthority")).toBeLessThan(
      source.indexOf("resolveV1_9ProviderHealthRecoveryAuthority({ cwd: repositoryRoot, env })"),
    );
    expect(source).toMatch(/const repositoryRoot = resolveV1_9RepositoryRoot\(env\)/);
    expect(source).toMatch(/verifyContractRepairRecoveryEvidence\(\{[\s\S]*cwd: repositoryRoot/);
    expect(source).toMatch(/resolveV1_9ExternalAuditRecoveryAuthority\(\{ cwd: repositoryRoot, env \}\)/);
    expect(source).not.toMatch(/requeueConversationTurnJobAfterExternalAudit/);
  });

  it("keeps V1-9 recovery on the repository root after Next moves to the frozen cwd", async () => {
    const fixture = await createFixture();
    expect(resolveV1_9RepositoryRoot({
      SHANHAI_V1_9_REPOSITORY_ROOT: fixture.rootDir,
    })).toBe(path.resolve(fixture.rootDir));
    expect(resolveV1_9RepositoryRoot({})).toBe(process.cwd());

    const authority = resolveV1_9ExternalAuditRecoveryAuthority({
      cwd: resolveV1_9RepositoryRoot({ SHANHAI_V1_9_REPOSITORY_ROOT: fixture.rootDir }),
      env: fixture.env,
    });
    expect(authority?.runId).toBe(fixture.runId);
  });

  it("binds the immutable v2 run-state and handoff without Provider health evidence", async () => {
    const fixture = await createFixture();

    const authority = resolveV1_9ExternalAuditRecoveryAuthority({ cwd: fixture.rootDir, env: fixture.env });

    expect(authority).toMatchObject({
      runId: fixture.runId,
      projectId: "project-1",
      taskId: "task-1",
      intentEpoch: 0,
      taskBriefDigest: "1".repeat(64),
      sourcePlanRevision: 8,
      committedPlanRevision: 9,
      turnJobId: "turn-job-1",
      teacherMessageId: "teacher-message-1",
      handoffDigest: fixture.handoffDigest,
      observationId: `external-audit:${fixture.handoffDigest}`,
    });
    expect("V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID" in fixture.env).toBe(false);
  });

  it.each([
    ["task", (state: Record<string, any>) => { state.identity.taskId = "other-task"; }],
    ["IntentEpoch", (state: Record<string, any>) => {
      state.identity.intentEpoch = 2;
      state.taskContractLock.intentEpoch = 2;
    }],
    ["plan revision", (state: Record<string, any>) => {
      state.ledger.currentPlanRevision = 7;
      state.ledger.planRevisionHistory.at(-1).revision = 7;
    }],
    ["handoff file digest", (state: Record<string, any>) => {
      state.packageAcceptance.currentRepair.repairHandoffDigest = "f".repeat(64);
      state.packageAcceptance.rounds[0].repairHandoffDigest = "f".repeat(64);
    }],
  ])("fails closed when %s drifts before database recovery", async (_label, mutate) => {
    const fixture = await createFixture();
    const state = JSON.parse(await readFile(fixture.statePath, "utf8")) as Record<string, any>;
    mutate(state);
    await writeFile(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    expect(() => resolveV1_9ExternalAuditRecoveryAuthority({
      cwd: fixture.rootDir,
      env: fixture.env,
    })).toThrow(/v1_9_external_audit_recovery_invalid/);
  });

  it("rejects changed handoff bytes even when run-state still carries the frozen digest", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.handoffPath, `${await readFile(fixture.handoffPath, "utf8")}\n`, "utf8");

    expect(() => resolveV1_9ExternalAuditRecoveryAuthority({
      cwd: fixture.rootDir,
      env: fixture.env,
    })).toThrow(/v1_9_external_audit_recovery_invalid/);
  });
});

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-external-audit-authority-"));
  roots.push(rootDir);
  const runId = `v1-9-external-audit-${randomUUID()}`;
  const relativeRunRoot = `test-results/${runId}`;
  const runRoot = path.join(rootDir, "test-results", runId);
  const manifestPath = path.join(runRoot, "run-manifest.json");
  const statePath = path.join(runRoot, "run-state.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const handoffRelativePath = "external-acceptance/round-0001/repair-handoff.json";
  const handoffPath = path.join(runRoot, ...handoffRelativePath.split("/"));
  const manifest = createManifest(runId, relativeRunRoot);
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);

  let state = createV1_9RunState({ manifest, createdAt: "2026-07-15T13:00:01.000Z" });
  state = bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1", projectId: "project-1", boundAt: "2026-07-15T13:01:00.000Z",
  });
  state = bindV1_9TaskContractLock(state, {
    actorUserId: "teacher-1",
    actorAuthMode: "local",
    projectId: "project-1",
    taskId: "task-1",
    teacherMessageId: "teacher-message-1",
    turnJobId: "turn-job-1",
    taskBriefDigest: "1".repeat(64),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: "2".repeat(64),
    budgetDigest: "3".repeat(64),
    initialPlanRevision: 0,
    boundAt: "2026-07-15T13:02:00.000Z",
  });
  state = advanceV1_9PlanRevision(state, { nextPlanRevision: 8, advancedAt: "2026-07-15T13:03:00.000Z" });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects/project-1/messages", source: "ui",
    recordedAt: "2026-07-15T13:04:00.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "GET", pathname: "/api/workbench/projects/project-1/artifacts/package-1/package", source: "ui",
    recordedAt: "2026-07-15T13:05:00.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "a".repeat(64),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T13:05:01.000Z",
  });
  const report = normalizeV1_9ExternalAcceptanceReport(reportFixture({ runId, manifestSha256 }));
  const reportDigest = createV1_9ExternalAcceptanceReportDigest(report);
  const handoff = createExternalAuditRepairHandoff({
    report,
    reportDigest,
    binding: {
      actorUserId: "teacher-1",
      actorAuthMode: "local",
      projectId: "project-1",
      taskId: "task-1",
      intentEpoch: 0,
      taskBriefDigest: "1".repeat(64),
      planRevision: 8,
      turnJobId: "turn-job-1",
      teacherMessageId: "teacher-message-1",
      idempotencyKey: `external-audit:${runId}:round:1`,
    },
  });
  const handoffBytes = serialize(handoff);
  const handoffFileSha256 = sha256(handoffBytes);
  const finding = report.findings[0];
  state = recordV1_9ExternalAcceptanceRound(state, {
    auditRound: 1,
    reportId: report.reportId,
    reportPath: "external-acceptance/round-0001/report.json",
    reportDigest,
    packageArtifactId: report.packageArtifactId,
    packageArtifactVersion: report.packageArtifactVersion,
    packageVersion: report.packageVersion,
    packageSha256: report.packageSha256,
    outcome: "repair_required",
    reviewedFindingIds: [],
    openP0FindingIds: [finding.findingId],
    affectedUnits: handoff.affectedUnits,
    repairFeedback: [{
      findingId: finding.findingId,
      responsibilityLayer: finding.responsibilityLayer,
      category: finding.category,
      design: finding.feedback.design,
      vulnerability: finding.feedback.vulnerability,
      engineering: finding.feedback.engineering,
    }],
    repairHandoffPath: handoffRelativePath,
    repairHandoffDigest: handoffFileSha256,
    generatedAt: report.generatedAt,
  });

  await mkdir(path.dirname(handoffPath), { recursive: true });
  await writeFile(manifestPath, serialize(manifest));
  await writeFile(statePath, serialize(state));
  await writeFile(handoffPath, handoffBytes);
  await writeFile(pointerPath, serialize({
    schemaVersion: "v1-9-active-run.v2",
    runId,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256,
    statePath: `${relativeRunRoot}/run-state.json`,
  }));
  return {
    rootDir,
    runId,
    statePath,
    handoffPath,
    handoffDigest: handoff.handoffDigest,
    env: {
      V1_9_E2E_MANIFEST_PATH: manifestPath,
      V1_9_E2E_STATE_PATH: statePath,
    },
  };
}

function createManifest(runId: string, relativeRunRoot: string) {
  return createV1_9RunManifestV2({
    runId,
    relativeRunRoot,
    createdAt: "2026-07-15T13:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v2", branch: "main", gitHead: "a".repeat(40),
      generationIntensity: "standard", runtimeSourceDigest: "4".repeat(64),
      requirementsBaselineDigest: "5".repeat(64), registryDigest: "6".repeat(64),
      projectionRegistryDigest: "6".repeat(64), providerLedgerManifestDigest: "7".repeat(64),
      projectionId: "runtime-projection-a23",
      verificationManifestSha256: "1".repeat(64), workingTreeDigest: "2".repeat(64),
      policySha256: "3".repeat(64), stageSha256: "4".repeat(64),
      providerContinuityManifestSha256: "4".repeat(64), providerContinuityReceiptSha256: "5".repeat(64),
      providerContinuityEvidenceRootDigest: "e".repeat(64), providerContinuitySubjectDigest: "f".repeat(64),
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1", projectionLockDigest: "8".repeat(64),
      bindingPolicyDigest: "9".repeat(64), activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    agentBrain: { providerLock: {
      schemaVersion: "v1-9-provider-lock.v1", channel: "primary", model: "gpt-5.6-terra",
      endpointCategory: "openai_compatible_responses", reasoningEffort: "medium",
      credentialSource: "ledger_private_env", configDigest: "a".repeat(64),
    } },
    providerRuntimeLocks: ["agent_brain", "coze_ppt", "image_generation", "tts_minimax", "video_generation"]
      .map((capability, index) => ({
        capability: capability as "agent_brain" | "coze_ppt" | "image_generation" | "tts_minimax" | "video_generation",
        credentialSource: "ledger_private_env" as const,
        configDigest: String.fromCharCode(97 + index).repeat(64),
      })),
    predecessor: {
      runId: "v1-9-previous", relativeRunRoot: "test-results/v1-9-previous",
      manifestSha256: "f".repeat(64), disposition: "historical_failed",
    },
  });
}

function reportFixture(input: { runId: string; manifestSha256: string }) {
  return {
    schemaVersion: "v1-9-external-acceptance-report.v2",
    reportId: "external-acceptance-round-1",
    auditRound: 1,
    runId: input.runId,
    manifestSha256: input.manifestSha256,
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "a".repeat(64),
    rubricVersion: "v1-9-product-rubric.v1",
    auditMode: "external_read_only",
    auditBoundary: { businessToolCalls: 0, artifactMutations: 0, teacherApprovalActions: 0, packageRebuilds: 0 },
    reviewScope: { kind: "full_package", previousReportDigest: null, reviewedFindingIds: [] },
    findings: [{
      findingId: "finding-page-3",
      status: "open",
      severity: "P0",
      responsibilityLayer: "quality_gate",
      category: "design_quality",
      summary: "第3页版式不合格。",
      feedback: { design: "第3页越过安全边距。", vulnerability: null, engineering: "仅返修第3页。" },
      locator: {
        artifactRole: "ppt_deck", artifactId: "pptx-1", artifactVersion: "course-v1",
        pageNumber: 3, shotId: null, packageEntry: "materials/course-v1.pptx",
      },
      suggestedRegressionTest: "复验第3页安全边距。",
    }],
    generatedAt: "2026-07-15T13:30:00.000Z",
  };
}

function serialize(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
