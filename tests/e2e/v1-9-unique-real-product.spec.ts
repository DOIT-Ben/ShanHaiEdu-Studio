import { expect, test, type Page, type Request } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  assertV1_9RunStateOrchestrationAuthority,
  createV1_9RunManifestV2Digest,
  deriveV1_9RecoveryStop,
  markV1_9RunStatePackageReady,
  markV1_9RunStatePendingDecision,
  markV1_9RunStateRecoveryStop,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  projectV1_9OrchestrationAuthoritySummary,
  recordV1_9RunStateMutation,
  updateV1_9RunStateCheckpoint,
  type V1_9RunManifestV2,
  type V1_9RunState,
} from "../../scripts/lib/v1-9-e2e-contract.mjs";
import {
  sanitizeEvidenceRecord,
  sanitizeEvidenceValue,
} from "../../scripts/lib/evidence-sanitizer.mjs";
import {
  assertV1_9FinalPackageDownloadPath,
  selectLatestV1_9FinalPackage,
} from "../../scripts/lib/v1-9-final-package-selection.mjs";
import { writeV1_9RunStateCooperativeCas } from "../../scripts/lib/v1-9-run-preparation-transaction";
import { loginThroughUi, teacherCredentials } from "./support/feedback";

const activeJobStatuses = new Set(["queued", "running"]);
const manifestPath = resolveOwnedRunContractPath(
  process.env.V1_9_E2E_MANIFEST_PATH,
  "V1_9_E2E_MANIFEST_PATH",
  "run-manifest.json",
);
const statePath = resolveOwnedRunContractPath(
  process.env.V1_9_E2E_STATE_PATH,
  "V1_9_E2E_STATE_PATH",
  "run-state.json",
);
if (path.dirname(manifestPath) !== path.dirname(statePath)) throw new Error("v1_9_run_contract_root_mismatch");
const frozenPrompt = requiredText(process.env.V1_9_E2E_FROZEN_PROMPT, "V1_9_E2E_FROZEN_PROMPT");
const evidenceRoot = path.resolve(requiredText(process.env.M67_E2E_EVIDENCE_DIR, "M67_E2E_EVIDENCE_DIR"));

test.describe("V1-9 unique real product observer", () => {
  test("submits one frozen goal through the UI and only observes the product Main Agent", async ({ page }, testInfo) => {
    test.setTimeout(21_000_000);
    expect(testInfo.project.name).toBe("chromium-desktop");
    expect(process.env.M67_E2E_DETERMINISTIC).toBe("0");

    const manifestBytesAtStart = fs.readFileSync(manifestPath);
    const manifestFileSha256 = sha256Bytes(manifestBytesAtStart);
    const manifest = normalizeV1_9RunManifestV2(JSON.parse(manifestBytesAtStart.toString("utf8")));
    const manifestContractDigest = createV1_9RunManifestV2Digest(manifest);
    expect(manifest.promptDigest).toBe(sha256Text(frozenPrompt));

    let stateBytes = fs.readFileSync(statePath); let state = normalizeV1_9RunState(JSON.parse(stateBytes.toString("utf8")));
    assertStateMatchesManifest(state, manifest, manifestContractDigest);
    const resultsRoot = path.dirname(path.dirname(statePath));
    let stateWriteQueue = Promise.resolve();
    const persist = (next: V1_9RunState | ((current: V1_9RunState) => V1_9RunState)) => {
      const operation = stateWriteQueue.then(async () => {
        const normalized = normalizeV1_9RunState(typeof next === "function" ? next(state) : next);
        assertStateMatchesManifest(normalized, manifest, manifestContractDigest);
        stateBytes = await writeV1_9RunStateCooperativeCas({
          testResultsRoot: resultsRoot, statePath, expectedBytes: stateBytes,
          nextState: normalized, randomBytes,
        });
        state = normalized;
      });
      return (stateWriteQueue = operation);
    };
    installUiLedger(page, () => state, persist);

    try {
      if (state.status === "paused_pending_decision") {
        throw new Error(`v1_9_pending_decision:${state.pendingDecision?.reasonCode ?? "pending_decision"}`);
      }

      await loginThroughUi(page, teacherCredentials);
      const actorUserId = await readAuthenticatedActorId(page);

      if (state.identity.actorUserId === null) {
        const projectResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === "POST"
            && url.pathname === "/api/workbench/projects"
            && response.status() === 201;
        });
        await page.getByRole("button", { name: "新建项目", exact: true }).click();
        const body = await (await projectResponse).json() as { project?: { id?: unknown } };
        await persist((latest) => bindV1_9RunStateProjectIdentity(latest, {
          actorUserId,
          projectId: requiredText(body.project?.id, "project.id"),
          boundAt: stateTransitionTime(latest),
        }));
      } else {
        expect(state.identity.actorUserId).toBe(actorUserId);
        await selectProject(page, requiredText(state.identity.projectId, "state.projectId"));
      }

      const projectId = requiredText(state.identity.projectId, "state.projectId");
      if (state.status === "package_ready_for_external_acceptance" || state.status === "completed") {
        const snapshot = await readSnapshot(page, projectId);
        if (state.status === "completed") {
          assertV1_9RunStateOrchestrationAuthority(state, snapshot.orchestrationAuthoritySummary, true);
        } else {
          await persist((latest) => projectV1_9OrchestrationAuthoritySummary(latest, {
            summary: snapshot.orchestrationAuthoritySummary,
            projectedAt: stateTransitionTime(latest),
            requireReady: true,
          }));
        }
        writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
        return;
      }
      if (state.ledger.taskSubmissionCount === 0) {
        const accepted = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return response.request().method() === "POST"
            && url.pathname === `/api/workbench/projects/${projectId}/messages`
            && response.status() === 202;
        });
        const composer = page.getByLabel(/输入备课要求|正在生成中，也可以继续输入下一步要求/);
        await composer.fill(frozenPrompt);
        await page.getByRole("button", { name: /发送|加入队列/ }).click();
        await accepted;
      }
      await stateWriteQueue;
      expect(state.ledger.taskSubmissionCount).toBe(1);

      const deadline = Date.now() + 20_700_000;
      let terminalFailureSince: number | null = null;
      while (Date.now() < deadline) {
        await stateWriteQueue; const snapshot = await readSnapshot(page, projectId);
        const taskContract = taskContractFromSnapshot(snapshot, actorUserId, projectId);
        if (taskContract) {
          await persist((latest) => bindV1_9TaskContractLock(latest, {
            ...taskContract,
            initialPlanRevision: 0,
            boundAt: stateTransitionTime(latest),
          }));
        }

        const checkpoint = latestCheckpoint(snapshot);
        if (state.taskContractLock && checkpoint.checkpointId && checkpoint.planRevision !== null) {
          const currentRevision = state.ledger.currentPlanRevision ?? state.taskContractLock.initialPlanRevision;
          const checkpointChanged = state.checkpoint?.checkpointId !== checkpoint.checkpointId
            || state.checkpoint.planRevision !== checkpoint.planRevision
            || JSON.stringify(state.checkpoint.observationRefs) !== JSON.stringify(checkpoint.observationRefs);
          if (checkpoint.planRevision >= currentRevision && checkpointChanged) {
            await persist((latest) => updateV1_9RunStateCheckpoint(latest, {
              checkpointId: checkpoint.checkpointId!,
              planRevision: checkpoint.planRevision!,
              observationRefs: checkpoint.observationRefs,
              recordedAt: stateTransitionTime(latest),
            }));
          }
        }
        if (state.taskContractLock) {
          await persist((latest) => projectV1_9OrchestrationAuthoritySummary(latest, {
            summary: snapshot.orchestrationAuthoritySummary,
            projectedAt: stateTransitionTime(latest),
            requireReady: false,
          }));
        }
        writeObserverEvidence({
          manifest,
          manifestContractDigest,
          manifestFileSha256,
          state,
          snapshot,
        });

        const pendingDecision = latestPendingDecision(snapshot, state);
        if (pendingDecision && state.taskContractLock) {
          await persist((latest) => markV1_9RunStatePendingDecision(latest, {
            ...pendingDecision,
            stoppedAt: stateTransitionTime(latest),
          }));
          writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
          throw new Error(`v1_9_pending_decision:${pendingDecision.reasonCode}`);
        }

        const activeJobs = [...snapshot.turnJobs, ...snapshot.generationJobs]
          .filter((job) => activeJobStatuses.has(job.status));
        const finalDeliveryArtifacts = snapshot.artifacts.filter((artifact) =>
          artifact.nodeKey === "final_delivery" || artifact.kind === "final_delivery");
        const finalPackage = state.taskContractLock && state.identity.taskId !== null && state.identity.intentEpoch !== null
          ? selectLatestV1_9FinalPackage(snapshot.artifacts, {
              projectId,
              taskId: state.identity.taskId,
              taskBriefDigest: state.taskContractLock.taskBriefDigest,
              intentEpoch: state.identity.intentEpoch,
              currentPlanRevision: state.ledger.currentPlanRevision ?? state.taskContractLock.initialPlanRevision,
              previousPackageArtifactVersion: state.packageAcceptance?.packageArtifactVersion ?? null,
              previousPackageVersion: state.packageAcceptance?.packageVersion ?? null,
            })
          : null;
        if (finalPackage && activeJobs.length === 0 && state.taskContractLock) {
          let downloadedPackage: Awaited<ReturnType<typeof downloadFinalPackage>>;
          try {
            downloadedPackage = await downloadFinalPackage(page, projectId, finalPackage.id);
          } catch (error) {
            await persist((latest) => markV1_9RunStateRecoveryStop(latest, {
              reasonCode: "final_package_download_failed",
              checkpointId: checkpoint.checkpointId,
              observationRefs: checkpoint.observationRefs,
              stoppedAt: stateTransitionTime(latest),
            }));
            writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
            throw new Error("v1_9_recovery_stop:final_package_download_failed", { cause: error });
          }
          try {
            await expect.poll(() => state.ledger.finalDownloadCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
            const finalSnapshot = await readSnapshot(page, projectId);
            await persist((latest) => projectV1_9OrchestrationAuthoritySummary(latest, {
              summary: finalSnapshot.orchestrationAuthoritySummary,
              projectedAt: stateTransitionTime(latest),
              requireReady: true,
            }));
            await persist((latest) => markV1_9RunStatePackageReady(latest, {
              packageArtifactId: finalPackage.id,
              packageArtifactVersion: requiredPositiveInteger(finalPackage.version, "finalPackage.version"),
              packageVersion: requiredText(finalPackage.structuredContent.courseVersionId, "finalPackage.courseVersionId"),
              packageSha256: downloadedPackage.packageSha256,
              turnJobId: requiredText(latest.taskContractLock?.turnJobId, "taskContract.turnJobId"),
              teacherMessageId: requiredText(latest.taskContractLock?.teacherMessageId, "taskContract.teacherMessageId"),
              downloadedAt: downloadedPackage.downloadedAt,
            }));
          } catch (error) {
            await persist((latest) => markV1_9RunStateRecoveryStop(latest, {
              reasonCode: "final_package_state_commit_failed",
              checkpointId: checkpoint.checkpointId,
              observationRefs: checkpoint.observationRefs,
              stoppedAt: stateTransitionTime(latest),
            }));
            writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
            throw new Error("v1_9_recovery_stop:final_package_state_commit_failed", { cause: error });
          }
          const finalSnapshot = await readSnapshot(page, projectId);
          writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot: finalSnapshot });
          expect(state.status).toBe("package_ready_for_external_acceptance");
          return;
        }
        if (!finalPackage && finalDeliveryArtifacts.length > 0 && activeJobs.length === 0 && state.taskContractLock) {
          await persist((latest) => markV1_9RunStateRecoveryStop(latest, {
            reasonCode: "final_package_not_eligible",
            checkpointId: checkpoint.checkpointId,
            observationRefs: checkpoint.observationRefs,
            stoppedAt: stateTransitionTime(latest),
          }));
          writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
          throw new Error("v1_9_recovery_stop:final_package_not_eligible");
        }

        const stopped = deriveV1_9RecoveryStop(snapshot, checkpoint);
        if (stopped && activeJobs.length === 0) {
          terminalFailureSince ??= Date.now();
          if (Date.now() - terminalFailureSince >= 30_000) {
            if (!state.taskContractLock) throw new Error("v1_9_task_contract_missing_before_recovery_stop");
            await persist((latest) => markV1_9RunStateRecoveryStop(latest, {
              ...stopped,
              stoppedAt: stateTransitionTime(latest),
            }));
            writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
            throw new Error(`v1_9_recovery_stop:${stopped.reasonCode}`);
          }
        } else {
          terminalFailureSince = null;
        }

        await page.waitForTimeout(2_000);
      }

      const snapshot = await readSnapshot(page, projectId);
      const checkpoint = latestCheckpoint(snapshot);
      if (!state.taskContractLock) throw new Error("v1_9_task_contract_missing_before_timeout");
      await persist((latest) => markV1_9RunStateRecoveryStop(latest, {
        reasonCode: "observer_timeout",
        checkpointId: checkpoint.checkpointId,
        observationRefs: checkpoint.observationRefs,
        stoppedAt: stateTransitionTime(latest),
      }));
      writeObserverEvidence({ manifest, manifestContractDigest, manifestFileSha256, state, snapshot });
      throw new Error("v1_9_observer_timeout");
    } finally {
      await stateWriteQueue; assertManifestBytesUnchanged(manifestBytesAtStart, manifestFileSha256);
    }
  });
});

function installUiLedger(
  page: Page,
  current: () => V1_9RunState,
  persist: (update: (current: V1_9RunState) => V1_9RunState) => Promise<void>,
) {
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const isApiWrite = url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method);
    const isFinalDownload = method === "GET"
      && /^\/api\/workbench\/projects\/[^/]+\/artifacts\/[^/]+\/package$/.test(url.pathname);
    if (!isApiWrite && !isFinalDownload) return;
    void persist((latest) => recordV1_9RunStateMutation(latest, {
      method,
      pathname: url.pathname,
      source: "ui",
      recordedAt: stateTransitionTime(latest),
    })).catch(() => undefined);
  });
}

async function readAuthenticatedActorId(page: Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const body = await response.json() as { authenticated?: unknown; user?: { id?: unknown } | null };
  expect(body.authenticated).toBe(true);
  return requiredText(body.user?.id, "auth.user.id");
}

async function selectProject(page: Page, projectId: string) {
  const project = page.locator(`[data-project-id="${projectId}"]`);
  await expect(project).toBeVisible();
  await project.getByRole("button").first().click();
  await expect(page.getByLabel(/输入备课要求|正在生成中，也可以继续输入下一步要求/)).toBeVisible();
}

async function readSnapshot(page: Page, projectId: string): Promise<ObserverSnapshot> {
  const response = await page.request.get(`/api/workbench/projects/${projectId}/snapshot`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<ObserverSnapshot>;
}

function taskContractFromSnapshot(snapshot: ObserverSnapshot, actorUserId: string, projectId: string) {
  for (const message of [...snapshot.messages].reverse()) {
    if (message.role !== "teacher") continue;
    const taskBrief = recordValue(message.metadata.taskBrief);
    const intentGrant = recordValue(message.metadata.intentGrant);
    if (!taskBrief || !intentGrant) continue;
    if (taskBrief.schemaVersion !== "task-brief.v1" || intentGrant.schemaVersion !== "intent-grant.v1") continue;

    const taskId = requiredText(taskBrief.taskId, "taskBrief.taskId");
    const intentEpoch = requiredNonNegativeInteger(taskBrief.intentEpoch, "taskBrief.intentEpoch");
    if (requiredText(taskBrief.projectId, "taskBrief.projectId") !== projectId) continue;
    if (requiredText(taskBrief.sourceMessageId, "taskBrief.sourceMessageId") !== message.id) continue;
    if (requiredText(intentGrant.projectId, "intentGrant.projectId") !== projectId) continue;
    if (requiredText(intentGrant.taskId, "intentGrant.taskId") !== taskId) continue;
    if (requiredNonNegativeInteger(intentGrant.intentEpoch, "intentGrant.intentEpoch") !== intentEpoch) continue;
    if (taskBrief.generationIntensity !== "standard" || intentGrant.intensity !== "standard") {
      throw new Error("v1_9_task_contract_intensity_drift");
    }
    if (intentGrant.standardWorkAuthorized !== true) throw new Error("v1_9_standard_work_authorization_missing");

    const budgetProfile = {
      budgetPolicyVersion: requiredText(intentGrant.budgetPolicyVersion, "intentGrant.budgetPolicyVersion"),
      maxCostCredits: requiredNullableNonNegativeNumber(intentGrant.maxCostCredits, "intentGrant.maxCostCredits"),
      maxExternalProviderCalls: requiredNonNegativeInteger(
        intentGrant.maxExternalProviderCalls,
        "intentGrant.maxExternalProviderCalls",
      ),
      requiredCheckpoints: requiredTextArray(intentGrant.requiredCheckpoints, "intentGrant.requiredCheckpoints"),
      expiresAt: requiredNullableTimestamp(intentGrant.expiresAt, "intentGrant.expiresAt"),
    };
    const intentGrantDigest = sha256Json(intentGrant);
    const budgetDigest = sha256Json(budgetProfile);
    const turnJob = snapshot.turnJobs.find((job) => job.teacherMessageId === message.id);
    if (!turnJob) throw new Error("v1_9_task_turn_job_missing");
    return {
      actorUserId,
      projectId,
      taskId,
      actorAuthMode: requiredAuthMode(turnJob.actorAuthMode),
      teacherMessageId: message.id,
      turnJobId: requiredText(turnJob.id, "turnJob.id"),
      taskBriefDigest: requiredDigest(taskBrief.digest, "taskBrief.digest"),
      intentEpoch,
      intensity: "standard" as const,
      intentGrantDigest,
      budgetDigest,
    };
  }
  return null;
}

function latestPendingDecision(snapshot: ObserverSnapshot, state: V1_9RunState) {
  for (const message of [...snapshot.messages].reverse()) {
    const decision = recordValue(message.metadata.pendingDecision);
    if (!decision || decision.status !== "pending") continue;
    if (state.identity.projectId && decision.projectId !== state.identity.projectId) continue;
    if (state.identity.taskId && decision.taskId !== state.identity.taskId) continue;
    if (state.identity.intentEpoch !== null && decision.intentEpoch !== state.identity.intentEpoch) continue;
    return {
      kind: requiredText(decision.kind, "pendingDecision.kind"),
      actionId: requiredText(decision.actionId, "pendingDecision.actionId"),
      reasonCode: requiredText(decision.reasonCode, "pendingDecision.reasonCode"),
    };
  }
  return null;
}

function latestCheckpoint(snapshot: ObserverSnapshot): ObserverCheckpoint {
  const checkpoints = snapshot.messages.flatMap((message) => {
    const checkpoint = recordValue(message.metadata.agentRunCheckpoint);
    if (!checkpoint || typeof checkpoint.checkpointId !== "string" || !checkpoint.checkpointId.trim()) return [];
    const task = recordValue(checkpoint.task);
    const planRevision = optionalNonNegativeInteger(
      checkpoint.planRevision ?? checkpoint.planVersion ?? task?.planRevision,
    );
    return [{
      status: typeof checkpoint.status === "string" ? checkpoint.status : null,
      reasonCode: typeof checkpoint.reason === "string" ? checkpoint.reason : null,
      checkpointId: checkpoint.checkpointId.trim(),
      planRevision,
      observationRefs: requiredTextArray(checkpoint.observationRefs ?? [], "checkpoint.observationRefs"),
      createdAt: optionalTimestamp(checkpoint.createdAt ?? message.createdAt),
    }];
  });
  checkpoints.sort((left, right) =>
    (right.planRevision ?? -1) - (left.planRevision ?? -1)
      || Date.parse(right.createdAt ?? "1970-01-01T00:00:00.000Z")
        - Date.parse(left.createdAt ?? "1970-01-01T00:00:00.000Z"));
  return checkpoints[0] ?? {
    status: null,
    reasonCode: null,
    checkpointId: null,
    planRevision: null,
    observationRefs: [],
    createdAt: null,
  };
}

async function downloadFinalPackage(page: Page, projectId: string, artifactId: string) {
  await page.reload();
  await selectProject(page, projectId);
  const deliveryGroup = page.getByRole("button", { name: /^交付，/ }).first();
  await expect(deliveryGroup).toBeVisible();
  await deliveryGroup.click();

  let downloadButton = page.getByRole("button", { name: "下载材料包", exact: true });
  if (!await downloadButton.isVisible().catch(() => false)) {
    const finalArtifact = page.getByRole("button", { name: /最终交付/ }).last();
    await expect(finalArtifact).toBeVisible();
    await finalArtifact.click();
    downloadButton = page.getByRole("button", { name: "下载材料包", exact: true });
  }
  await expect(downloadButton).toBeVisible();
  const packageRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && /^\/api\/workbench\/projects\/[^/]+\/artifacts\/[^/]+\/package$/.test(url.pathname);
  });
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const [download, packageRequest] = await Promise.all([downloadPromise, packageRequestPromise]);
  assertV1_9FinalPackageDownloadPath(new URL(packageRequest.url()).pathname, { projectId, artifactId });
  expect(download.suggestedFilename()).toMatch(/\.zip$/i);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const packagePath = path.join(evidenceRoot, `v1-9-final-package-${artifactId}.zip`);
  await download.saveAs(packagePath);
  expect(fs.statSync(packagePath).size).toBeGreaterThan(0);
  return {
    packageSha256: await sha256File(packagePath),
    downloadedAt: new Date().toISOString(),
  };
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function writeObserverEvidence(input: {
  manifest: V1_9RunManifestV2;
  manifestContractDigest: string;
  manifestFileSha256: string;
  state: V1_9RunState;
  snapshot: ObserverSnapshot;
}) {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const evidence = {
    evidenceKind: "v1-9-unique-product-observer",
    capturedAt: new Date().toISOString(),
    manifest: {
      schemaVersion: input.manifest.schemaVersion,
      runId: input.manifest.runId,
      promptDigest: input.manifest.promptDigest,
      manifestContractDigest: input.manifestContractDigest,
      manifestFileSha256: input.manifestFileSha256,
      baselineLock: input.manifest.baselineLock,
      skillLock: input.manifest.skillLock,
      providerRuntimeLocks: input.manifest.providerRuntimeLocks,
    },
    runState: {
      schemaVersion: input.state.schemaVersion,
      status: input.state.status,
      identity: input.state.identity,
      taskContractLock: input.state.taskContractLock,
      checkpoint: input.state.checkpoint,
      pendingDecision: input.state.pendingDecision,
      recovery: input.state.recovery,
      packageAcceptance: input.state.packageAcceptance,
      orchestrationAuthoritySummary: input.state.orchestrationAuthoritySummary,
      ledger: {
        currentPlanRevision: input.state.ledger.currentPlanRevision,
        planRevisionHistory: input.state.ledger.planRevisionHistory,
        taskSubmissionCount: input.state.ledger.taskSubmissionCount,
        finalDownloadCount: input.state.ledger.finalDownloadCount,
        externalCodexOrchestrationCount: input.state.ledger.externalCodexOrchestrationCount,
        mutationCount: input.state.ledger.mutations.length,
        violationReasonCodes: input.state.ledger.violations.map((item) => item.reasonCode),
      },
    },
    toolExposureTrace: input.snapshot.messages.flatMap((message) => {
      const trace = message.metadata.mainAgentToolExposureTrace;
      return Array.isArray(trace) ? trace.map(sanitizeRecord).filter(isSanitizedRecord) : [];
    }),
    observations: input.snapshot.messages.flatMap((message) => {
      const observations = message.metadata.agentObservations;
      return Array.isArray(observations) ? observations.map(sanitizeRecord).filter(isSanitizedRecord) : [];
    }),
    turnJobs: input.snapshot.turnJobs.map((job) => ({
      id: job.id,
      teacherMessageId: job.teacherMessageId,
      status: job.status,
      errorCode: job.errorCode ?? null,
    })),
    generationJobs: input.snapshot.generationJobs.map((job) => ({
      status: job.status,
      errorCode: job.errorCode ?? null,
    })),
    artifacts: input.snapshot.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      nodeKey: artifact.nodeKey,
      status: artifact.status,
      version: artifact.version,
      taskId: artifact.taskId,
      taskBriefDigest: artifact.taskBriefDigest,
      intentEpoch: artifact.intentEpoch,
      planRevision: artifact.planRevision,
      origin: artifact.origin,
    })),
  };
  const sanitizedEvidence = sanitizeEvidenceValue(evidence, { maxDepth: 32 });
  writeJsonAtomic(path.join(evidenceRoot, "v1-9-observer-latest.json"), sanitizedEvidence);
}

function sanitizeRecord(value: unknown): Record<string, unknown> | null {
  return sanitizeEvidenceRecord(value, {
    maxDepth: 12,
    maxArrayItems: 32,
    maxObjectEntries: 128,
    maxStringLength: 600,
  });
}

function isSanitizedRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function assertStateMatchesManifest(state: V1_9RunState, manifest: V1_9RunManifestV2, manifestDigest: string) {
  if (state.runId !== manifest.runId) throw new Error("v1_9_state_manifest_run_id_mismatch");
  if (state.manifestSha256 !== manifestDigest) throw new Error("v1_9_state_manifest_digest_mismatch");
}

function assertManifestBytesUnchanged(expectedBytes: Buffer, expectedSha256: string) {
  const actualBytes = fs.readFileSync(manifestPath);
  if (!actualBytes.equals(expectedBytes) || sha256Bytes(actualBytes) !== expectedSha256) {
    throw new Error("v1_9_manifest_bytes_changed_during_observation");
  }
}

function resolveOwnedRunContractPath(value: unknown, field: string, expectedName: string) {
  const resolved = path.resolve(requiredText(value, field));
  const testResultsRoot = path.resolve(process.cwd(), "test-results");
  const relative = path.relative(testResultsRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== expectedName) {
    throw new Error(`v1_9_${field}_outside_test_results`);
  }
  return resolved;
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function stateTransitionTime(state: V1_9RunState) {
  return new Date(Math.max(Date.now(), Date.parse(state.updatedAt))).toISOString();
}

function requiredText(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`v1_9_${field}_required`);
  return normalized;
}

function requiredDigest(value: unknown, field: string) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`v1_9_${field}_invalid`);
  return normalized;
}

function requiredNonNegativeInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`v1_9_${field}_invalid`);
  return Number(value);
}

function requiredPositiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`v1_9_${field}_invalid`);
  return Number(value);
}

function requiredAuthMode(value: unknown): "local" | "password" | "oauth" | "sso" {
  if (value !== "local" && value !== "password" && value !== "oauth" && value !== "sso") {
    throw new Error("v1_9_turnJob.actorAuthMode_invalid");
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function requiredNullableNonNegativeNumber(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`v1_9_${field}_invalid`);
  return value;
}

function requiredTextArray(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`v1_9_${field}_invalid`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function requiredNullableTimestamp(value: unknown, field: string) {
  if (value === null) return null;
  return requiredTimestamp(value, field);
}

function requiredTimestamp(value: unknown, field: string) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`v1_9_${field}_invalid`);
  return new Date(normalized).toISOString();
}

function optionalTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown) {
  return sha256Text(JSON.stringify(canonicalJson(value)));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  const record = recordValue(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalJson(record[key])]));
}

type ObserverCheckpoint = {
  status: string | null;
  reasonCode: string | null;
  checkpointId: string | null;
  planRevision: number | null;
  observationRefs: string[];
  createdAt: string | null;
};

type ObserverSnapshot = {
  project: { id: string; intentEpoch: number };
  orchestrationAuthoritySummary: unknown;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt?: string;
    metadata: Record<string, unknown>;
  }>;
  artifacts: Array<{
    id: string;
    projectId: string;
    taskId: string | null;
    taskBriefDigest: string | null;
    intentEpoch: number | null;
    planRevision: number | null;
    origin: string | null;
    kind: string;
    nodeKey: string;
    status: string;
    version: number;
    isApproved: boolean;
    updatedAt: string;
    structuredContent: Record<string, unknown>;
  }>;
  turnJobs: Array<{
    id: string;
    teacherMessageId: string;
    actorAuthMode: string | null;
    status: string;
    errorCode?: string | null;
  }>;
  generationJobs: Array<{ status: string; errorCode?: string | null }>;
};
