import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createV1_9RunManifestV2Digest,
  assertV1_9RunStateOrchestrationAuthority,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  projectV1_9OrchestrationAuthoritySummary,
  recordV1_9ExternalAcceptanceRound,
  type V1_9ExternalAcceptanceRoundState,
  type V1_9RunManifestV2,
  type V1_9RunState,
} from "./lib/v1-9-e2e-contract.mjs";
import {
  createV1_9ExternalAcceptanceReportDigest,
  evaluateV1_9ExternalAcceptanceRound,
  normalizeV1_9ExternalAcceptanceReport,
  type V1_9ExternalAcceptanceReport,
} from "./lib/v1-9-external-acceptance";
import {
  createExternalAuditRepairHandoff,
  normalizeExternalAuditRepairHandoff,
  type ExternalAuditRepairHandoff,
} from "../src/server/conversation/external-audit-repair-contract";
import type { ExternalAuditRunStateBinding } from "../src/server/conversation/external-audit-evidence-ingress";
import {
  assertV1_9PreparePath,
  ensureV1_9PrepareResultsRoot,
  withV1_9PrepareLock,
  writeV1_9RunStateCooperativeCas,
} from "./lib/v1-9-run-preparation-transaction";
import { readV1_9OrchestrationAuthoritySummaryFromSqlite } from "./lib/v1-9-orchestration-authority-sqlite";

export {
  createV1_9ExternalAcceptanceReportDigest,
  normalizeV1_9ExternalAcceptanceReport,
  type V1_9ExternalAcceptanceFinding,
  type V1_9ExternalAcceptanceReport,
} from "./lib/v1-9-external-acceptance";

const currentFilePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(currentFilePath), "..");
const ACTIVE_POINTER_FILE_NAME = "v1-9-product-e2e-active.json";
const FINAL_REPORT_FILE_NAME = "external-acceptance-report.json";
const CLOSED_POINTER_FILE_NAME = "closed-active-pointer.json";

type ActiveRunPointer = {
  schemaVersion: "v1-9-active-run.v2";
  runId: string;
  relativeRunRoot: string;
  manifestPath: string;
  manifestSha256: string;
  statePath: string;
};

type CloseoutContext = {
  rootDir: string;
  resultsRoot: string;
  runRoot: string;
  activePointerPath: string;
  closedPointerPath: string;
  pointerSourcePath: string;
  pointerBytes: Buffer;
  activePointerPresent: boolean;
  pointer: ActiveRunPointer;
  manifestPath: string;
  manifestBytes: Buffer;
  manifest: V1_9RunManifestV2;
  manifestSha256: string;
  statePath: string;
  stateBytes: Buffer;
  state: V1_9RunState;
  finalReportPath: string;
  databasePath: string;
};

type RepairCommitInput = {
  runStateBinding: ExternalAuditRunStateBinding;
  handoff: ExternalAuditRepairHandoff;
};

type CloseoutDependencies = {
  randomBytes?: (size: number) => Buffer;
  beforeActivePointerRename?: () => void | Promise<void>;
  afterClosedPointerLink?: () => void | Promise<void>;
  beforeStateCommit?: () => void | Promise<void>;
  commitRepairHandoff?: (input: RepairCommitInput) => Promise<unknown>;
  readAuthoritySummary?: typeof readV1_9OrchestrationAuthoritySummaryFromSqlite;
};

export async function closeV1_9RunAfterExternalAcceptance(input: {
  rootDir?: string;
  report: unknown;
  dependencies?: CloseoutDependencies;
}) {
  const rootDir = path.resolve(input.rootDir ?? defaultRoot);
  const report = normalizeV1_9ExternalAcceptanceReport(input.report);
  const resultsRoot = path.join(rootDir, "test-results");
  await ensureV1_9PrepareResultsRoot(rootDir, resultsRoot);
  const runRoot = resolveRunRootFromId(rootDir, report.runId);
  assertV1_9PreparePath(resultsRoot, runRoot, { kind: "directory" });
  const createRandomBytes = input.dependencies?.randomBytes ?? randomBytes;
  return withV1_9PrepareLock(
      resultsRoot,
      { now: () => new Date(), randomBytes: createRandomBytes },
      async () => {
    const context = await resolveCloseoutContext(rootDir, report.runId);
    assertReportBinding(context, report);
    await assertPackageFileBinding(context, report);
    const readAuthoritySummary = input.dependencies?.readAuthoritySummary
      ?? readV1_9OrchestrationAuthoritySummaryFromSqlite;
    let authorityState = await reconcileCloseoutAuthorityState(
      context.state,
      await readAuthoritySummary(authorityReadInput(context)),
    );

    const reportBytes = serializeJson(report);
    const reportSha256 = sha256(reportBytes);
    if (reportSha256 !== createV1_9ExternalAcceptanceReportDigest(report)) {
      throw new Error("v1_9_external_acceptance_report_digest_mismatch");
    }
    const loaded = await loadRoundHistory(context, report.auditRound, reportSha256);
    const evaluation = evaluateV1_9ExternalAcceptanceRound({ history: loaded.history, current: report });
    const relativeRoundRoot = `external-acceptance/round-${String(report.auditRound).padStart(4, "0")}`;
    const reportRelativePath = `${relativeRoundRoot}/report.json`;
    const reportPath = resolveRunRelativeFile(context.runRoot, reportRelativePath);
    const repairHandoffRelativePath = `${relativeRoundRoot}/repair-handoff.json`;
    const repairHandoffPath = resolveRunRelativeFile(context.runRoot, repairHandoffRelativePath);

    await createCloseoutDirectory(resultsRoot, path.dirname(reportPath));
    await writeImmutableFile(resultsRoot, reportPath, reportBytes, "v1_9_external_acceptance_report_already_exists");

    let handoff: ExternalAuditRepairHandoff | null = null;
    let handoffFileSha256: string | null = null;
    if (evaluation.outcome === "repair_required") {
      const taskBinding = createRepairTaskBinding(authorityState, report);
      handoff = createExternalAuditRepairHandoff({ report, reportDigest: reportSha256, binding: taskBinding });
      const handoffBytes = serializeJson(handoff);
      handoffFileSha256 = sha256(handoffBytes);
      await writeImmutableFile(
        resultsRoot,
        repairHandoffPath,
        handoffBytes,
        "v1_9_external_acceptance_repair_handoff_already_exists",
      );
      const commitRepairHandoff = input.dependencies?.commitRepairHandoff ?? commitRepairHandoffToProduct;
      await commitRepairHandoff({
        runStateBinding: createRunStateBinding(authorityState, report),
        handoff,
      });
    }

    authorityState = await reconcileCloseoutAuthorityState(
      authorityState,
      await readAuthoritySummary(authorityReadInput(context)),
    );

    const roundCommit = createRoundCommit({
      report,
      reportSha256,
      reportRelativePath,
      evaluation,
      repairHandoffRelativePath: handoff ? repairHandoffRelativePath : null,
      repairHandoffDigest: handoffFileSha256,
    });
    const nextState = loaded.currentRound
      ? assertExistingRoundReplay(authorityState, loaded.currentRound, roundCommit)
      : recordV1_9ExternalAcceptanceRound(authorityState, roundCommit);

    await assertBytesUnchanged(resultsRoot, context.manifestPath, context.manifestBytes, "v1_9_run_manifest_mutated");
    await assertBytesUnchanged(resultsRoot, context.pointerSourcePath, context.pointerBytes, "v1_9_active_run_pointer_mutated");
    if (nextState !== context.state) {
      await writeV1_9RunStateCooperativeCas({
        testResultsRoot: resultsRoot,
        statePath: context.statePath,
        expectedBytes: context.stateBytes,
        nextState,
        randomBytes: createRandomBytes,
        prepareLockHeld: true,
        beforeCommit: input.dependencies?.beforeStateCommit,
      });
    }
    await assertCommittedRound(resultsRoot, context.statePath, roundCommit);

    if (evaluation.outcome === "repair_required") {
      if (!context.activePointerPresent) throw new Error("v1_9_external_acceptance_repair_pointer_missing");
      return {
        outcome: "repair_required" as const,
        runId: report.runId,
        auditRound: report.auditRound,
        reportPath,
        reportSha256,
        repairHandoffPath,
        repairHandoffSha256: handoffFileSha256!,
        statePath: context.statePath,
        activePointerPath: context.activePointerPath,
      };
    }

    await writeImmutableFile(
      resultsRoot,
      context.finalReportPath,
      reportBytes,
      "v1_9_external_acceptance_final_report_already_exists",
    );
    await assertBytesUnchanged(resultsRoot, context.manifestPath, context.manifestBytes, "v1_9_run_manifest_mutated");
    if (context.activePointerPresent) {
      assertV1_9PreparePath(resultsRoot, context.activePointerPath, { kind: "file" });
      assertV1_9PreparePath(resultsRoot, context.closedPointerPath, { allowMissing: true });
      await input.dependencies?.beforeActivePointerRename?.();
      assertV1_9PreparePath(resultsRoot, context.runRoot, { kind: "directory" });
      await assertBytesUnchanged(
        resultsRoot,
        context.activePointerPath,
        context.pointerBytes,
        "v1_9_active_run_pointer_mutated",
      );
      if (await fileExists(resultsRoot, context.closedPointerPath)) {
        await finishClosedPointerPublication(resultsRoot, context);
      } else {
        await publishClosedPointerNoReplace(
          resultsRoot,
          context,
          input.dependencies?.afterClosedPointerLink,
        );
      }
    }
    const closedPointerBytes = await readCloseoutFile(resultsRoot, context.closedPointerPath).catch(() => {
      throw new Error("v1_9_closed_pointer_missing");
    });
    if (!closedPointerBytes.equals(context.pointerBytes)) throw new Error("v1_9_closed_pointer_digest_mismatch");

    return {
      outcome: "completed" as const,
      runId: report.runId,
      auditRound: report.auditRound,
      reportPath,
      reportSha256,
      finalReportPath: context.finalReportPath,
      statePath: context.statePath,
      closedPointerPath: context.closedPointerPath,
    };
      },
    );
}

async function resolveCloseoutContext(rootDir: string, expectedRunId: string): Promise<CloseoutContext> {
  const resultsRoot = path.join(rootDir, "test-results");
  const runRoot = resolveRunRootFromId(rootDir, expectedRunId);
  assertV1_9PreparePath(resultsRoot, runRoot, { kind: "directory" });
  const activePointerPath = path.join(rootDir, "test-results", ACTIVE_POINTER_FILE_NAME);
  const closedPointerPath = path.join(runRoot, CLOSED_POINTER_FILE_NAME);
  const activePointerPresent = await fileExists(resultsRoot, activePointerPath);
  const pointerSourcePath = activePointerPresent ? activePointerPath : closedPointerPath;
  const pointerBytes = await readCloseoutFile(resultsRoot, pointerSourcePath).catch(() => {
    throw new Error("v1_9_active_run_pointer_missing");
  });
  const pointer = normalizeActivePointer(parseJson(pointerBytes, "v1_9_active_run_pointer_invalid"));
  if (pointer.runId !== expectedRunId) throw new Error("v1_9_active_run_identity_mismatch");
  const pointerRunRoot = resolveOwnedRunRoot(rootDir, pointer.relativeRunRoot);
  if (pointerRunRoot !== runRoot) throw new Error("v1_9_active_run_identity_mismatch");
  const manifestPath = resolveOwnedRunFile(rootDir, runRoot, pointer.manifestPath, "run-manifest.json");
  const statePath = resolveOwnedRunFile(rootDir, runRoot, pointer.statePath, "run-state.json");
  const databasePath = resolveRunRelativeFile(runRoot, "m67.sqlite");
  assertV1_9PreparePath(resultsRoot, databasePath, { kind: "file" });
  const [manifestBytes, stateBytes] = await Promise.all([
    readCloseoutFile(resultsRoot, manifestPath),
    readCloseoutFile(resultsRoot, statePath),
  ]);
  const manifest = normalizeV1_9RunManifestV2(parseJson(manifestBytes, "v1_9_run_manifest_invalid"));
  const state = normalizeV1_9RunState(parseJson(stateBytes, "v1_9_run_state_invalid"));
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
  if (sha256(manifestBytes) !== manifestSha256 || pointer.manifestSha256 !== manifestSha256 ||
      state.manifestSha256 !== manifestSha256 || state.runId !== expectedRunId || manifest.runId !== expectedRunId) {
    throw new Error("v1_9_active_run_identity_mismatch");
  }
  if (!["package_ready_for_external_acceptance", "external_acceptance_repair_required", "completed"].includes(state.status) ||
      !state.packageAcceptance) {
    throw new Error("v1_9_external_acceptance_state_invalid");
  }
  if (state.ledger.taskSubmissionCount !== 1 || state.ledger.finalDownloadCount < 1 ||
      state.ledger.externalCodexOrchestrationCount !== 0 || state.ledger.violations.length !== 0) {
    throw new Error("v1_9_unique_ui_contract_incomplete");
  }
  if (!activePointerPresent && state.status !== "completed") {
    throw new Error("v1_9_closed_pointer_state_invalid");
  }
  return {
    rootDir,
    resultsRoot,
    runRoot,
    activePointerPath,
    closedPointerPath,
    pointerSourcePath,
    pointerBytes,
    activePointerPresent,
    pointer,
    manifestPath,
    manifestBytes,
    manifest,
    manifestSha256,
    statePath,
    stateBytes,
    state,
    finalReportPath: path.join(runRoot, FINAL_REPORT_FILE_NAME),
    databasePath,
  };
}

function authorityReadInput(context: CloseoutContext) {
  const { actorUserId, projectId } = context.state.identity;
  if (!actorUserId || !projectId) throw new Error("v1_9_external_acceptance_task_binding_missing");
  return { databasePath: context.databasePath, projectId, actorUserId };
}

async function reconcileCloseoutAuthorityState(state: V1_9RunState, actual: unknown) {
  if (state.status === "completed") {
    assertV1_9RunStateOrchestrationAuthority(state, actual, true);
    return state;
  }
  return projectV1_9OrchestrationAuthoritySummary(state, {
    summary: actual,
    projectedAt: state.updatedAt,
    requireReady: true,
  });
}

async function loadRoundHistory(context: CloseoutContext, currentRound: number, currentDigest: string) {
  const rounds = context.state.packageAcceptance?.rounds ?? [];
  if (rounds.length < currentRound - 1 || rounds.length > currentRound) {
    throw new Error("v1_9_external_acceptance_round_history_invalid");
  }
  const currentStateRound = rounds.length === currentRound ? rounds.at(-1)! : null;
  if (currentStateRound && currentStateRound.reportDigest !== currentDigest) {
    throw new Error("v1_9_external_acceptance_round_replay_mismatch");
  }
  const history: Array<{ report: V1_9ExternalAcceptanceReport; reportDigest: string }> = [];
  for (const round of rounds.slice(0, currentRound - 1)) {
    const reportPath = resolveRunRelativeFile(context.runRoot, round.reportPath);
    const reportBytes = await readCloseoutFile(context.resultsRoot, reportPath).catch(() => {
      throw new Error("v1_9_external_acceptance_history_report_missing");
    });
    if (sha256(reportBytes) !== round.reportDigest) throw new Error("v1_9_external_acceptance_history_digest_invalid");
    const report = normalizeV1_9ExternalAcceptanceReport(parseJson(reportBytes, "v1_9_external_acceptance_history_report_invalid"));
    if (createV1_9ExternalAcceptanceReportDigest(report) !== round.reportDigest ||
        report.auditRound !== round.auditRound || report.reportId !== round.reportId) {
      throw new Error("v1_9_external_acceptance_history_digest_invalid");
    }
    if (round.outcome === "repair_required") await assertHistoricalRepairHandoff(context, round, report);
    history.push({ report, reportDigest: round.reportDigest });
  }
  return { history, currentRound: currentStateRound };
}

async function assertHistoricalRepairHandoff(
  context: CloseoutContext,
  round: V1_9ExternalAcceptanceRoundState,
  report: V1_9ExternalAcceptanceReport,
) {
  if (!round.repairHandoffPath || !round.repairHandoffDigest) {
    throw new Error("v1_9_external_acceptance_history_handoff_invalid");
  }
  const handoffBytes = await readCloseoutFile(
    context.resultsRoot,
    resolveRunRelativeFile(context.runRoot, round.repairHandoffPath),
  ).catch(() => {
    throw new Error("v1_9_external_acceptance_history_handoff_missing");
  });
  if (sha256(handoffBytes) !== round.repairHandoffDigest) {
    throw new Error("v1_9_external_acceptance_history_handoff_invalid");
  }
  const handoff = normalizeExternalAuditRepairHandoff(parseJson(handoffBytes, "v1_9_external_acceptance_history_handoff_invalid"));
  if (handoff.reportDigest !== round.reportDigest || handoff.reportId !== report.reportId) {
    throw new Error("v1_9_external_acceptance_history_handoff_invalid");
  }
}

function assertReportBinding(context: CloseoutContext, report: V1_9ExternalAcceptanceReport) {
  const acceptance = context.state.packageAcceptance;
  if (!acceptance) throw new Error("v1_9_external_acceptance_state_invalid");
  if (report.runId !== context.manifest.runId || report.manifestSha256 !== context.manifestSha256) {
    throw new Error("v1_9_external_acceptance_run_binding_mismatch");
  }
  if (report.packageArtifactId !== acceptance.packageArtifactId ||
      report.packageArtifactVersion !== acceptance.packageArtifactVersion ||
      report.packageVersion !== acceptance.packageVersion || report.packageSha256 !== acceptance.packageSha256) {
    throw new Error("v1_9_external_acceptance_package_binding_mismatch");
  }
  if (Date.parse(report.generatedAt) < Date.parse(acceptance.downloadedAt)) {
    throw new Error("v1_9_external_acceptance_timestamp_invalid");
  }
}

async function assertPackageFileBinding(context: CloseoutContext, report: V1_9ExternalAcceptanceReport) {
  const packagePath = path.join(context.runRoot, "evidence", `v1-9-final-package-${report.packageArtifactId}.zip`);
  assertV1_9PreparePath(context.resultsRoot, packagePath, { kind: "file" });
  const packageStat = await stat(packagePath).catch(() => {
    throw new Error("v1_9_external_acceptance_package_file_missing");
  });
  if (!packageStat.isFile() || packageStat.size <= 0) throw new Error("v1_9_external_acceptance_package_file_invalid");
  if (await sha256File(context.resultsRoot, packagePath) !== report.packageSha256) {
    throw new Error("v1_9_external_acceptance_package_file_digest_mismatch");
  }
}

function createRepairTaskBinding(state: V1_9RunState, report: V1_9ExternalAcceptanceReport) {
  const lock = state.taskContractLock;
  if (!lock || !state.identity.actorUserId || !state.identity.projectId || !state.identity.taskId ||
      state.identity.intentEpoch === null || state.ledger.currentPlanRevision === null) {
    throw new Error("v1_9_external_acceptance_task_binding_missing");
  }
  return {
    actorUserId: state.identity.actorUserId,
    actorAuthMode: lock.actorAuthMode,
    projectId: state.identity.projectId,
    taskId: state.identity.taskId,
    intentEpoch: state.identity.intentEpoch,
    taskBriefDigest: lock.taskBriefDigest,
    planRevision: state.ledger.currentPlanRevision,
    turnJobId: lock.turnJobId,
    teacherMessageId: lock.teacherMessageId,
    idempotencyKey: `external-audit:${report.runId}:round:${report.auditRound}`,
  };
}

function createRunStateBinding(state: V1_9RunState, report: V1_9ExternalAcceptanceReport): ExternalAuditRunStateBinding {
  return {
    runId: report.runId,
    manifestSha256: report.manifestSha256,
    packageArtifactId: report.packageArtifactId,
    packageArtifactVersion: report.packageArtifactVersion,
    packageVersion: report.packageVersion,
    packageSha256: report.packageSha256,
    ...createRepairTaskBinding(state, report),
  };
}

function createRoundCommit(input: {
  report: V1_9ExternalAcceptanceReport;
  reportSha256: string;
  reportRelativePath: string;
  evaluation: ReturnType<typeof evaluateV1_9ExternalAcceptanceRound>;
  repairHandoffRelativePath: string | null;
  repairHandoffDigest: string | null;
}) {
  const openIds = new Set(input.evaluation.openP0FindingIds);
  const repairFeedback = input.report.findings
    .filter((finding) => openIds.has(finding.findingId))
    .map((finding) => ({
      findingId: finding.findingId,
      responsibilityLayer: finding.responsibilityLayer,
      category: finding.category,
      design: finding.feedback.design,
      vulnerability: finding.feedback.vulnerability,
      engineering: finding.feedback.engineering,
    }))
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
  return {
    auditRound: input.report.auditRound,
    reportId: input.report.reportId,
    reportPath: input.reportRelativePath,
    reportDigest: input.reportSha256,
    packageArtifactId: input.report.packageArtifactId,
    packageArtifactVersion: input.report.packageArtifactVersion,
    packageVersion: input.report.packageVersion,
    packageSha256: input.report.packageSha256,
    outcome: input.evaluation.outcome,
    reviewedFindingIds: [...input.evaluation.reviewedFindingIds],
    openP0FindingIds: [...input.evaluation.openP0FindingIds],
    affectedUnits: input.evaluation.affectedUnits,
    repairFeedback,
    repairHandoffPath: input.repairHandoffRelativePath,
    repairHandoffDigest: input.repairHandoffDigest,
    generatedAt: input.report.generatedAt,
  };
}

function assertExistingRoundReplay(
  state: V1_9RunState,
  existing: V1_9ExternalAcceptanceRoundState,
  expected: ReturnType<typeof createRoundCommit>,
) {
  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    throw new Error("v1_9_external_acceptance_round_replay_mismatch");
  }
  return state;
}

async function assertCommittedRound(
  resultsRoot: string,
  statePath: string,
  expected: ReturnType<typeof createRoundCommit>,
) {
  const state = normalizeV1_9RunState(parseJson(
    await readCloseoutFile(resultsRoot, statePath),
    "v1_9_run_state_invalid",
  ));
  const round = state.packageAcceptance?.rounds[expected.auditRound - 1];
  if (!round || JSON.stringify(round) !== JSON.stringify(expected)) {
    throw new Error("v1_9_external_acceptance_state_commit_incomplete");
  }
}

async function commitRepairHandoffToProduct(input: RepairCommitInput) {
  const [{ prisma }, { ingestExternalAuditRepairEvidence }] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/conversation/external-audit-evidence-ingress"),
  ]);
  return ingestExternalAuditRepairEvidence({ client: prisma, ...input });
}

function normalizeActivePointer(value: unknown): ActiveRunPointer {
  const pointer = requiredRecord(value, "v1_9_active_run_pointer_invalid");
  assertOnlyFields(pointer, [
    "schemaVersion", "runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath",
  ], "v1_9_active_run_pointer_invalid");
  if (pointer.schemaVersion !== "v1-9-active-run.v2") throw new Error("v1_9_active_run_pointer_invalid");
  const relativeRunRoot = requiredRelativeRunRoot(pointer.relativeRunRoot);
  return {
    schemaVersion: "v1-9-active-run.v2",
    runId: requiredRunId(pointer.runId),
    relativeRunRoot,
    manifestPath: requiredRunFile(pointer.manifestPath, relativeRunRoot, "run-manifest.json"),
    manifestSha256: requiredDigest(pointer.manifestSha256, "v1_9_active_run_pointer_invalid"),
    statePath: requiredRunFile(pointer.statePath, relativeRunRoot, "run-state.json"),
  };
}

async function writeImmutableFile(resultsRoot: string, filePath: string, bytes: Buffer, conflictCode: string) {
  try {
    assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
    await writeFile(filePath, bytes, { flag: "wx" });
    assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
    if (!(await readFile(filePath)).equals(bytes)) throw new Error(conflictCode);
  }
}

async function publishClosedPointerNoReplace(
  resultsRoot: string,
  context: CloseoutContext,
  afterClosedPointerLink?: () => void | Promise<void>,
) {
  assertV1_9PreparePath(resultsRoot, context.activePointerPath, { kind: "file" });
  assertV1_9PreparePath(resultsRoot, context.closedPointerPath, { allowMissing: true });
  try {
    await link(context.activePointerPath, context.closedPointerPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("v1_9_closed_pointer_already_exists");
    }
    throw error;
  }
  const closedBytes = await readCloseoutFile(resultsRoot, context.closedPointerPath);
  if (!closedBytes.equals(context.pointerBytes)) throw new Error("v1_9_closed_pointer_digest_mismatch");
  await afterClosedPointerLink?.();
  await finishClosedPointerPublication(resultsRoot, context);
}

async function finishClosedPointerPublication(resultsRoot: string, context: CloseoutContext) {
  const closedBytes = await readCloseoutFile(resultsRoot, context.closedPointerPath);
  if (!closedBytes.equals(context.pointerBytes)) throw new Error("v1_9_closed_pointer_already_exists");
  await assertBytesUnchanged(
    resultsRoot,
    context.activePointerPath,
    context.pointerBytes,
    "v1_9_active_run_pointer_mutated",
  );
  await assertBytesUnchanged(
    resultsRoot,
    context.closedPointerPath,
    context.pointerBytes,
    "v1_9_closed_pointer_digest_mismatch",
  );
  await rm(context.activePointerPath, { force: false });
  assertV1_9PreparePath(resultsRoot, context.activePointerPath, { allowMissing: true });
  assertV1_9PreparePath(resultsRoot, context.closedPointerPath, { kind: "file" });
}

async function assertBytesUnchanged(resultsRoot: string, filePath: string, expected: Buffer, errorCode: string) {
  if (!(await readCloseoutFile(resultsRoot, filePath)).equals(expected)) throw new Error(errorCode);
}

async function sha256File(resultsRoot: string, filePath: string) {
  assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  return hash.digest("hex");
}

async function createCloseoutDirectory(resultsRoot: string, directoryPath: string) {
  assertV1_9PreparePath(resultsRoot, directoryPath, { allowMissing: true });
  await mkdir(directoryPath, { recursive: true });
  assertV1_9PreparePath(resultsRoot, directoryPath, { kind: "directory" });
}

async function readCloseoutFile(resultsRoot: string, filePath: string) {
  assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  const bytes = await readFile(filePath);
  assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  return bytes;
}

function resolveRunRootFromId(rootDir: string, runIdValue: unknown) {
  const runId = requiredRunId(runIdValue);
  return resolveOwnedRunRoot(rootDir, `test-results/${runId}`);
}

function resolveOwnedRunRoot(rootDir: string, relativeRunRoot: string) {
  const testResultsRoot = path.resolve(rootDir, "test-results");
  const runRoot = path.resolve(rootDir, ...relativeRunRoot.split("/"));
  const relative = path.relative(testResultsRoot, runRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("v1_9_run_root_invalid");
  return runRoot;
}

function resolveOwnedRunFile(rootDir: string, runRoot: string, relativePath: string, fileName: string) {
  const filePath = path.resolve(rootDir, ...relativePath.split("/"));
  if (path.relative(runRoot, filePath) !== fileName) throw new Error("v1_9_active_run_path_invalid");
  return filePath;
}

function resolveRunRelativeFile(runRoot: string, relativePath: string) {
  const normalized = requiredText(relativePath, "v1_9_run_relative_path_invalid").replaceAll("\\", "/");
  const filePath = path.resolve(runRoot, ...normalized.split("/"));
  const relative = path.relative(runRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("v1_9_run_relative_path_invalid");
  return filePath;
}

function requiredRelativeRunRoot(value: unknown) {
  const normalized = requiredText(value, "v1_9_run_root_invalid").replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9][a-z0-9._-]{0,127}$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("v1_9_run_root_invalid");
  }
  return normalized;
}

function requiredRunFile(value: unknown, relativeRunRoot: string, fileName: string) {
  const normalized = requiredText(value, "v1_9_active_run_path_invalid").replaceAll("\\", "/");
  if (normalized !== `${relativeRunRoot}/${fileName}`) throw new Error("v1_9_active_run_path_invalid");
  return normalized;
}

function requiredRunId(value: unknown) {
  const runId = requiredText(value, "v1_9_run_id_invalid");
  if (!/^v1-9-[a-z0-9][a-z0-9._-]{0,127}$/i.test(runId)) throw new Error("v1_9_run_id_invalid");
  return runId;
}

function requiredDigest(value: unknown, errorCode: string) {
  const digest = requiredText(value, errorCode).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(errorCode);
  return digest;
}

function requiredText(value: unknown, errorCode: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function requiredRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function assertOnlyFields(value: Record<string, unknown>, fields: string[], errorCode: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) throw new Error(errorCode);
}

function parseJson(bytes: Buffer, errorCode: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(errorCode);
  }
}

function serializeJson(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileExists(resultsRoot: string, filePath: string) {
  assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
  try {
    await access(filePath);
    assertV1_9PreparePath(resultsRoot, filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function formatV1_9CloseoutCliResult(
  result: Awaited<ReturnType<typeof closeV1_9RunAfterExternalAcceptance>>,
  rootDir = defaultRoot,
) {
  const runRoot = resolveRunRootFromId(rootDir, result.runId);
  const toRunRelativePath = (filePath: string) => {
    const repoRelativePath = toSafeRepoRelativePath(rootDir, filePath);
    const relativeToRun = path.relative(runRoot, path.resolve(filePath));
    if (!relativeToRun || relativeToRun === ".." || relativeToRun.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToRun)) {
      throw new Error("v1_9_closeout_cli_path_outside_run");
    }
    return repoRelativePath;
  };

  const reportPath = toRunRelativePath(result.reportPath);
  const statePath = toRunRelativePath(result.statePath);
  if (result.outcome === "repair_required") {
    const activePointerPath = toSafeRepoRelativePath(rootDir, result.activePointerPath);
    if (activePointerPath !== `test-results/${ACTIVE_POINTER_FILE_NAME}`) {
      throw new Error("v1_9_closeout_cli_active_pointer_invalid");
    }
    return {
      outcome: result.outcome,
      runId: result.runId,
      auditRound: result.auditRound,
      reportPath,
      reportSha256: result.reportSha256,
      repairHandoffPath: toRunRelativePath(result.repairHandoffPath),
      repairHandoffSha256: result.repairHandoffSha256,
      statePath,
      activePointerPath,
    };
  }

  return {
    outcome: result.outcome,
    runId: result.runId,
    auditRound: result.auditRound,
    reportPath,
    reportSha256: result.reportSha256,
    finalReportPath: toRunRelativePath(result.finalReportPath),
    statePath,
    closedPointerPath: toRunRelativePath(result.closedPointerPath),
  };
}

function toSafeRepoRelativePath(rootDir: string, filePath: string) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("v1_9_closeout_cli_path_outside_repo");
  }
  return relative.replaceAll(path.sep, "/");
}

function parseCliReportPath(argv: string[]) {
  if (argv.length !== 2 || argv[0] !== "--report-input" || !argv[1]?.trim()) {
    throw new Error("usage: npx tsx scripts/close-v1-9-run.ts --report-input <report.json>");
  }
  return path.resolve(argv[1]);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === currentFilePath.toLowerCase()) {
  const reportInputPath = parseCliReportPath(process.argv.slice(2));
  const report = parseJson(await readFile(reportInputPath), "v1_9_external_acceptance_report_input_invalid");
  const result = await closeV1_9RunAfterExternalAcceptance({ report });
  process.stdout.write(`${JSON.stringify(formatV1_9CloseoutCliResult(result), null, 2)}\n`);
}
