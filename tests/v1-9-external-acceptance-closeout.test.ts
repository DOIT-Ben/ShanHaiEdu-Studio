import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStatePackageReady,
  normalizeV1_9RunState,
  recordV1_9RunStateMutation,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import {
  closeV1_9RunAfterExternalAcceptance,
  createV1_9ExternalAcceptanceReportDigest,
  formatV1_9CloseoutCliResult,
  normalizeV1_9ExternalAcceptanceReport,
} from "../scripts/close-v1-9-run";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V1-9 versioned external acceptance closeout", () => {
  it("projects completed CLI paths to repo-relative run paths without exposing the host root", () => {
    const rootDir = path.join(os.tmpdir(), "private-user-root", "ShanHaiEdu-Studio", "main");
    const runId = "v1-9-cli-safe-output";
    const runRoot = path.join(rootDir, "test-results", runId);

    const result = formatV1_9CloseoutCliResult({
      outcome: "completed",
      runId,
      auditRound: 1,
      reportPath: path.join(runRoot, "external-acceptance", "round-0001", "report.json"),
      reportSha256: "a".repeat(64),
      finalReportPath: path.join(runRoot, "external-acceptance-report.json"),
      statePath: path.join(runRoot, "run-state.json"),
      closedPointerPath: path.join(runRoot, "closed-active-pointer.json"),
    }, rootDir);

    expect(result).toEqual({
      outcome: "completed",
      runId,
      auditRound: 1,
      reportPath: `test-results/${runId}/external-acceptance/round-0001/report.json`,
      reportSha256: "a".repeat(64),
      finalReportPath: `test-results/${runId}/external-acceptance-report.json`,
      statePath: `test-results/${runId}/run-state.json`,
      closedPointerPath: `test-results/${runId}/closed-active-pointer.json`,
    });
    expect(JSON.stringify(result)).not.toContain(rootDir);
  });

  it("projects repair CLI paths and the active pointer without exposing the host root", () => {
    const rootDir = path.join(os.tmpdir(), "private-user-root", "ShanHaiEdu-Studio", "main");
    const runId = "v1-9-cli-safe-output";
    const runRoot = path.join(rootDir, "test-results", runId);

    const result = formatV1_9CloseoutCliResult({
      outcome: "repair_required",
      runId,
      auditRound: 2,
      reportPath: path.join(runRoot, "external-acceptance", "round-0002", "report.json"),
      reportSha256: "a".repeat(64),
      repairHandoffPath: path.join(runRoot, "external-acceptance", "round-0002", "repair-handoff.json"),
      repairHandoffSha256: "b".repeat(64),
      statePath: path.join(runRoot, "run-state.json"),
      activePointerPath: path.join(rootDir, "test-results", "v1-9-product-e2e-active.json"),
    }, rootDir);

    expect(result).toMatchObject({
      outcome: "repair_required",
      reportPath: `test-results/${runId}/external-acceptance/round-0002/report.json`,
      repairHandoffPath: `test-results/${runId}/external-acceptance/round-0002/repair-handoff.json`,
      statePath: `test-results/${runId}/run-state.json`,
      activePointerPath: "test-results/v1-9-product-e2e-active.json",
    });
    expect(JSON.stringify(result)).not.toContain(rootDir);
  });

  it("fails closed instead of printing a CLI path outside the repository", () => {
    const rootDir = path.join(os.tmpdir(), "private-user-root", "ShanHaiEdu-Studio", "main");
    const runId = "v1-9-cli-safe-output";
    const runRoot = path.join(rootDir, "test-results", runId);

    expect(() => formatV1_9CloseoutCliResult({
      outcome: "repair_required",
      runId,
      auditRound: 1,
      reportPath: path.join(runRoot, "external-acceptance", "round-0001", "report.json"),
      reportSha256: "a".repeat(64),
      repairHandoffPath: path.join(rootDir, "..", "private-repair-handoff.json"),
      repairHandoffSha256: "b".repeat(64),
      statePath: path.join(runRoot, "run-state.json"),
      activePointerPath: path.join(rootDir, "test-results", "v1-9-product-e2e-active.json"),
    }, rootDir)).toThrowError("v1_9_closeout_cli_path_outside_repo");
  });

  it("writes an immutable first round, completes run-state, and closes the pointer last when P0 is zero", async () => {
    const fixture = await createFixture();
    const manifestBefore = await readFile(fixture.manifestPath);
    const report = acceptedReport(fixture);

    const result = await closeV1_9RunAfterExternalAcceptance({ rootDir: fixture.rootDir, report });

    const reportBytes = await readFile(fixture.roundReportPath(1));
    const completedState = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
    expect(result).toMatchObject({
      outcome: "completed",
      runId: fixture.runId,
      auditRound: 1,
      reportPath: fixture.roundReportPath(1),
      reportSha256: sha256(reportBytes),
      finalReportPath: fixture.finalReportPath,
      statePath: fixture.statePath,
      closedPointerPath: fixture.closedPointerPath,
    });
    expect(await readFile(fixture.finalReportPath)).toEqual(reportBytes);
    expect(completedState).toMatchObject({
      status: "completed",
      packageAcceptance: {
        acceptedAt: "2026-07-15T13:30:00.000Z",
        rounds: [{ auditRound: 1, outcome: "accepted", reportDigest: sha256(reportBytes) }],
        currentRepair: null,
      },
    });
    expect(await readFile(fixture.manifestPath)).toEqual(manifestBefore);
    await expect(readFile(fixture.pointerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists a P0 round and repair handoff, invokes the product ingress, and keeps the active pointer", async () => {
    const fixture = await createFixture();
    const report = acceptedReport(fixture, { findings: [finding({ severity: "P0" })] });
    const commitRepairHandoff = vi.fn(async () => ({ status: "committed" as const }));

    const result = await closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report,
      dependencies: { commitRepairHandoff },
    });

    const state = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
    const reportBytes = await readFile(fixture.roundReportPath(1));
    const handoffBytes = await readFile(fixture.repairHandoffPath(1));
    expect(result).toMatchObject({
      outcome: "repair_required",
      auditRound: 1,
      reportPath: fixture.roundReportPath(1),
      repairHandoffPath: fixture.repairHandoffPath(1),
      activePointerPath: fixture.pointerPath,
    });
    expect(state).toMatchObject({
      status: "external_acceptance_repair_required",
      packageAcceptance: {
        rounds: [{ auditRound: 1, outcome: "repair_required", openP0FindingIds: ["finding-1"] }],
        currentRepair: {
          openP0FindingIds: ["finding-1"],
          responsibilityLayers: ["quality_gate"],
          affectedUnits: [{ unitId: "ppt_deck:page:3" }],
        },
      },
    });
    expect(sha256(reportBytes)).toBe(createV1_9ExternalAcceptanceReportDigest(normalizeV1_9ExternalAcceptanceReport(report)));
    expect(sha256(handoffBytes)).toBe(state.packageAcceptance!.currentRepair!.repairHandoffDigest);
    expect(commitRepairHandoff).toHaveBeenCalledWith(expect.objectContaining({
      runStateBinding: expect.objectContaining({
        actorUserId: "teacher-1",
        actorAuthMode: "local",
        projectId: "project-1",
        taskId: "task-1",
        turnJobId: "turn-job-1",
        teacherMessageId: "teacher-message-1",
      }),
      handoff: expect.objectContaining({ preserveUnlistedVersions: true, openFindingIds: ["finding-1"] }),
    }));
    expect(await readFile(fixture.pointerPath)).toBeTruthy();
    await expect(readFile(fixture.closedPointerPath)).rejects.toMatchObject({ code: "ENOENT" });

    const replay = await closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report,
      dependencies: { commitRepairHandoff },
    });
    expect(replay).toMatchObject({ outcome: "repair_required", reportSha256: sha256(reportBytes) });
    expect(await readFile(fixture.roundReportPath(1))).toEqual(reportBytes);
  });

  it("closes historical P0 only after a new package and targeted second round", async () => {
    const fixture = await createFixture();
    const first = normalizeV1_9ExternalAcceptanceReport(acceptedReport(fixture, {
      findings: [finding({ severity: "P0" })],
    }));
    const firstDigest = createV1_9ExternalAcceptanceReportDigest(first);
    await closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: first,
      dependencies: { commitRepairHandoff: async () => ({ status: "committed" as const }) },
    });
    const firstReportBytes = await readFile(fixture.roundReportPath(1));

    const package2Bytes = Buffer.from("real revised zip fixture bytes", "utf8");
    await writeFile(fixture.packagePath("package-2"), package2Bytes);
    let state = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
    state = recordV1_9RunStateMutation(state, {
      method: "GET",
      pathname: "/api/workbench/projects/project-1/artifacts/package-2/package",
      source: "ui",
      recordedAt: "2026-07-15T13:35:00.000Z",
    });
    state = markV1_9RunStatePackageReady(state, {
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: sha256(package2Bytes),
      turnJobId: "turn-job-1",
      teacherMessageId: "teacher-message-1",
      downloadedAt: "2026-07-15T13:35:01.000Z",
    });
    await writeFile(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const second = acceptedReport(fixture, {
      reportId: "external-acceptance-round-2",
      auditRound: 2,
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: sha256(package2Bytes),
      reviewScope: {
        kind: "targeted_recheck",
        previousReportDigest: firstDigest,
        reviewedFindingIds: ["finding-1"],
      },
      findings: [finding({
        status: "closed",
        severity: "P0",
        locator: {
          artifactRole: "ppt_deck",
          artifactId: "pptx-2",
          artifactVersion: "course-v2",
          pageNumber: 3,
          shotId: null,
          packageEntry: "materials/course-v2.pptx",
        },
      })],
      generatedAt: "2026-07-15T13:40:00.000Z",
    });
    const result = await closeV1_9RunAfterExternalAcceptance({ rootDir: fixture.rootDir, report: second });

    const completed = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
    expect(result).toMatchObject({ outcome: "completed", auditRound: 2 });
    expect(completed).toMatchObject({
      status: "completed",
      packageAcceptance: { rounds: [{ auditRound: 1 }, { auditRound: 2, outcome: "accepted" }] },
    });
    expect(await readFile(fixture.roundReportPath(1))).toEqual(firstReportBytes);
    expect(await readFile(fixture.roundReportPath(2))).toEqual(await readFile(fixture.finalReportPath));
    await expect(readFile(fixture.pointerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects report package version and digest mismatches before writing a round", async () => {
    const fixture = await createFixture();
    const before = await contractSnapshot(fixture);

    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: acceptedReport(fixture, { packageArtifactVersion: 2 }),
    })).rejects.toThrow(/v1_9_external_acceptance_package_binding_mismatch/);
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: acceptedReport(fixture, { packageSha256: "f".repeat(64) }),
    })).rejects.toThrow(/v1_9_external_acceptance_package_binding_mismatch/);

    expect(await contractSnapshot(fixture)).toEqual(before);
    await expect(readFile(fixture.roundReportPath(1))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls forward after state commit when the final pointer move fails", async () => {
    const fixture = await createFixture();
    const report = acceptedReport(fixture);
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report,
      dependencies: { renameActivePointer: async () => { throw new Error("injected_pointer_rename_failure"); } },
    })).rejects.toThrow(/injected_pointer_rename_failure/);

    expect(normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8"))).status).toBe("completed");
    expect(await readFile(fixture.pointerPath)).toBeTruthy();
    const reportBytes = await readFile(fixture.roundReportPath(1));

    const recovered = await closeV1_9RunAfterExternalAcceptance({ rootDir: fixture.rootDir, report });
    expect(recovered).toMatchObject({ outcome: "completed", reportSha256: sha256(reportBytes) });
    await expect(readFile(fixture.pointerPath)).rejects.toMatchObject({ code: "ENOENT" });

    const idempotent = await closeV1_9RunAfterExternalAcceptance({ rootDir: fixture.rootDir, report });
    expect(idempotent).toMatchObject({ outcome: "completed", reportSha256: sha256(reportBytes) });
  });

  it("rolls forward after external-audit ingress commits but its response is lost", async () => {
    const fixture = await createFixture();
    const report = acceptedReport(fixture, { findings: [finding({ severity: "P0" })] });
    let ingressCommitted = false;
    const commitRepairHandoff = vi.fn(async () => {
      if (!ingressCommitted) {
        ingressCommitted = true;
        throw new Error("injected_ingress_response_lost");
      }
      return { status: "replayed" as const };
    });

    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report,
      dependencies: { commitRepairHandoff },
    })).rejects.toThrow(/injected_ingress_response_lost/);
    const reportBytes = await readFile(fixture.roundReportPath(1));
    const handoffBytes = await readFile(fixture.repairHandoffPath(1));
    expect(normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8"))).status)
      .toBe("package_ready_for_external_acceptance");

    const recovered = await closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report,
      dependencies: { commitRepairHandoff },
    });
    expect(recovered).toMatchObject({ outcome: "repair_required", auditRound: 1 });
    expect(await readFile(fixture.roundReportPath(1))).toEqual(reportBytes);
    expect(await readFile(fixture.repairHandoffPath(1))).toEqual(handoffBytes);
    expect(commitRepairHandoff).toHaveBeenCalledTimes(2);
  });

  it("rejects different bytes for the same uncommitted audit round", async () => {
    const fixture = await createFixture();
    const first = acceptedReport(fixture, { findings: [finding({ severity: "P0" })] });
    const firstIngress = vi.fn(async () => { throw new Error("injected_ingress_failure"); });
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: first,
      dependencies: { commitRepairHandoff: firstIngress },
    })).rejects.toThrow(/injected_ingress_failure/);
    const secondIngress = vi.fn(async () => ({ status: "committed" as const }));
    const conflicting = acceptedReport(fixture, {
      findings: [finding({ severity: "P0", summary: "同一轮出现了不同的审核字节。" })],
    });

    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: conflicting,
      dependencies: { commitRepairHandoff: secondIngress },
    })).rejects.toThrow(/v1_9_external_acceptance_report_already_exists/);
    expect(secondIngress).not.toHaveBeenCalled();
    expect(normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8"))).status)
      .toBe("package_ready_for_external_acceptance");
  });

  it("rejects a rewritten historical report before writing the targeted next round", async () => {
    const fixture = await createFixture();
    const prepared = await prepareTargetedSecondRound(fixture);
    const stateBefore = await readFile(fixture.statePath);
    await writeFile(fixture.roundReportPath(1), Buffer.from("{}\n", "utf8"));

    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: fixture.rootDir,
      report: prepared.secondReport,
    })).rejects.toThrow(/v1_9_external_acceptance_history_digest_invalid/);
    expect(await readFile(fixture.statePath)).toEqual(stateBefore);
    await expect(readFile(fixture.roundReportPath(2))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(fixture.pointerPath)).toBeTruthy();
  });

  it("rejects a live lock and takes over a dead lock", async () => {
    const live = await createFixture();
    await writeFile(live.lockPath, `${JSON.stringify({
      pid: process.pid, token: "live-token", createdAt: new Date().toISOString(),
    })}\n`, "utf8");
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: live.rootDir,
      report: acceptedReport(live),
    })).rejects.toThrow(/v1_9_external_acceptance_closeout_locked/);
    await expect(readFile(live.roundReportPath(1))).rejects.toMatchObject({ code: "ENOENT" });

    const dead = await createFixture();
    await writeFile(dead.lockPath, `${JSON.stringify({
      pid: 2147483647, token: "dead-token", createdAt: new Date().toISOString(),
    })}\n`, "utf8");
    const result = await closeV1_9RunAfterExternalAcceptance({
      rootDir: dead.rootDir,
      report: acceptedReport(dead),
    });
    expect(result).toMatchObject({ outcome: "completed" });
    await expect(readFile(dead.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes over only stale malformed or PID-reused locks", async () => {
    const malformed = await createFixture();
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await writeFile(malformed.lockPath, "{", "utf8");
    await utimes(malformed.lockPath, staleAt, staleAt);
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: malformed.rootDir,
      report: acceptedReport(malformed),
    })).resolves.toMatchObject({ outcome: "completed" });

    const reusedPid = await createFixture();
    await writeFile(reusedPid.lockPath, `${JSON.stringify({
      pid: process.pid, token: "stale-live-pid", createdAt: staleAt.toISOString(),
    })}\n`, "utf8");
    await utimes(reusedPid.lockPath, staleAt, staleAt);
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: reusedPid.rootDir,
      report: acceptedReport(reusedPid),
    })).resolves.toMatchObject({ outcome: "completed" });

    const freshMalformed = await createFixture();
    await writeFile(freshMalformed.lockPath, "{", "utf8");
    await expect(closeV1_9RunAfterExternalAcceptance({
      rootDir: freshMalformed.rootDir,
      report: acceptedReport(freshMalformed),
    })).rejects.toThrow(/v1_9_external_acceptance_lock_invalid/);
  });
});

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-closeout-"));
  temporaryRoots.push(rootDir);
  const runId = `v1-9-closeout-${temporaryRoots.length}`;
  const relativeRunRoot = `test-results/${runId}`;
  const runRoot = path.join(rootDir, "test-results", runId);
  const manifestPath = path.join(runRoot, "run-manifest.json");
  const statePath = path.join(runRoot, "run-state.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const closedPointerPath = path.join(runRoot, "closed-active-pointer.json");
  const finalReportPath = path.join(runRoot, "external-acceptance-report.json");
  const packageBytes = Buffer.from("real zip fixture bytes", "utf8");
  const packageSha256 = sha256(packageBytes);
  const manifest = createManifest(runId, relativeRunRoot);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);

  await mkdir(path.join(runRoot, "evidence"), { recursive: true });
  await writeFile(manifestPath, manifestBytes);
  await writeFile(path.join(runRoot, "evidence", "v1-9-final-package-package-1.zip"), packageBytes);
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
    initialPlanRevision: 8,
    boundAt: "2026-07-15T13:02:00.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects/project-1/messages", source: "ui",
    recordedAt: "2026-07-15T13:03:00.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "GET", pathname: "/api/workbench/projects/project-1/artifacts/package-1/package", source: "ui",
    recordedAt: "2026-07-15T13:20:00.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256,
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T13:20:01.000Z",
  });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(pointerPath, `${JSON.stringify({
    schemaVersion: "v1-9-active-run.v2",
    runId,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256,
    statePath: `${relativeRunRoot}/run-state.json`,
  }, null, 2)}\n`, "utf8");

  return {
    rootDir, runId, runRoot, relativeRunRoot, manifestPath, manifestSha256, statePath, pointerPath,
    closedPointerPath, finalReportPath, packageSha256,
    lockPath: path.join(runRoot, ".external-acceptance-closeout.lock"),
    packagePath: (artifactId: string) => path.join(runRoot, "evidence", `v1-9-final-package-${artifactId}.zip`),
    roundReportPath: (round: number) => path.join(runRoot, "external-acceptance", `round-${String(round).padStart(4, "0")}`, "report.json"),
    repairHandoffPath: (round: number) => path.join(runRoot, "external-acceptance", `round-${String(round).padStart(4, "0")}`, "repair-handoff.json"),
  };
}

async function prepareTargetedSecondRound(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const first = normalizeV1_9ExternalAcceptanceReport(acceptedReport(fixture, {
    findings: [finding({ severity: "P0" })],
  }));
  const firstDigest = createV1_9ExternalAcceptanceReportDigest(first);
  await closeV1_9RunAfterExternalAcceptance({
    rootDir: fixture.rootDir,
    report: first,
    dependencies: { commitRepairHandoff: async () => ({ status: "committed" as const }) },
  });
  const package2Bytes = Buffer.from("real revised zip fixture bytes for tamper test", "utf8");
  await writeFile(fixture.packagePath("package-2"), package2Bytes);
  let state = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
  state = recordV1_9RunStateMutation(state, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/artifacts/package-2/package",
    source: "ui",
    recordedAt: "2026-07-15T13:35:00.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-2",
    packageArtifactVersion: 2,
    packageVersion: "course-v2",
    packageSha256: sha256(package2Bytes),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T13:35:01.000Z",
  });
  await writeFile(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return {
    secondReport: acceptedReport(fixture, {
      reportId: "external-acceptance-round-2",
      auditRound: 2,
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: sha256(package2Bytes),
      reviewScope: {
        kind: "targeted_recheck",
        previousReportDigest: firstDigest,
        reviewedFindingIds: ["finding-1"],
      },
      findings: [finding({
        status: "closed",
        severity: "P0",
        locator: {
          artifactRole: "ppt_deck",
          artifactId: "pptx-2",
          artifactVersion: "course-v2",
          pageNumber: 3,
          shotId: null,
          packageEntry: "materials/course-v2.pptx",
        },
      })],
      generatedAt: "2026-07-15T13:40:00.000Z",
    }),
  };
}

function acceptedReport(fixture: Awaited<ReturnType<typeof createFixture>>, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "v1-9-external-acceptance-report.v2",
    reportId: "external-acceptance-round-1",
    auditRound: 1,
    runId: fixture.runId,
    manifestSha256: fixture.manifestSha256,
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: fixture.packageSha256,
    rubricVersion: "v1-9-product-rubric.v1",
    auditMode: "external_read_only",
    auditBoundary: { businessToolCalls: 0, artifactMutations: 0, teacherApprovalActions: 0, packageRebuilds: 0 },
    reviewScope: { kind: "full_package", previousReportDigest: null, reviewedFindingIds: [] },
    findings: [finding()],
    generatedAt: "2026-07-15T13:30:00.000Z",
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "finding-1",
    status: "open",
    severity: "P1",
    responsibilityLayer: "quality_gate",
    category: "design_quality",
    summary: "一处非阻断版式问题。",
    feedback: { design: "第3页正文接近安全边距。", vulnerability: null, engineering: "保留为后续优化。" },
    locator: {
      artifactRole: "ppt_deck",
      artifactId: "pptx-1",
      artifactVersion: "course-v1",
      pageNumber: 3,
      shotId: null,
      packageEntry: "materials/course-v1.pptx",
    },
    suggestedRegressionTest: "验证第3页正文不会越过安全边距。",
    ...overrides,
  };
}

function createManifest(runId: string, relativeRunRoot: string) {
  return createV1_9RunManifestV2({
    runId,
    relativeRunRoot,
    prompt: "完成一套公开课材料包。",
    createdAt: "2026-07-15T13:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v1", branch: "main", gitHead: "a".repeat(40),
      generationIntensity: "standard", runtimeSourceDigest: "4".repeat(64),
      requirementsBaselineDigest: "5".repeat(64), registryDigest: "6".repeat(64),
      projectionRegistryDigest: "6".repeat(64), providerLedgerManifestDigest: "7".repeat(64),
      projectionId: "runtime-projection-a23",
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

async function contractSnapshot(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    manifest: (await readFile(fixture.manifestPath)).toString("base64"),
    state: (await readFile(fixture.statePath)).toString("base64"),
    pointer: (await readFile(fixture.pointerPath)).toString("base64"),
  };
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
