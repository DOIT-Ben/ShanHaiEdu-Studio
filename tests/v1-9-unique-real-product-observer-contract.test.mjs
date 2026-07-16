import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const observerUrl = new URL("e2e/v1-9-unique-real-product.spec.ts", import.meta.url);
const snapshotRouteUrl = new URL("../src/app/api/workbench/projects/[projectId]/snapshot/route.ts", import.meta.url);

test("V1-9 observer keeps the v2 manifest immutable and persists only run-state contract mutations", async () => {
  const source = await readFile(observerUrl, "utf8");

  for (const contractApi of [
    "normalizeV1_9RunManifestV2",
    "createV1_9RunManifestV2Digest",
    "normalizeV1_9RunState",
    "bindV1_9RunStateProjectIdentity",
    "bindV1_9TaskContractLock",
    "recordV1_9RunStateMutation",
    "updateV1_9RunStateCheckpoint",
    "markV1_9RunStatePendingDecision",
    "markV1_9RunStateRecoveryStop",
    "markV1_9RunStatePackageReady",
  ]) {
    assert.match(source, new RegExp(`\\b${contractApi}\\b`), `${contractApi} must be used`);
  }

  assert.match(source, /V1_9_E2E_STATE_PATH/);
  assert.match(source, /writeJsonAtomic\(statePath,/);
  assert.match(source, /assertManifestBytesUnchanged/);
  assert.match(source, /manifestFileSha256/);
  assert.doesNotMatch(source, /writeJsonAtomic\(manifestPath,/);
  assert.doesNotMatch(source, /\bV1_9RunManifest\b/);
  assert.doesNotMatch(source, /\b(?:bindV1_9ProjectIdentity|bindV1_9TaskIdentity|recordV1_9UiMutation|markV1_9Completed)\b/);
});

test("V1-9 observer binds actor and the first persisted TaskBrief contract without resubmitting the goal", async () => {
  const source = await readFile(observerUrl, "utf8");

  assert.match(source, /page\.request\.get\("\/api\/auth\/me"\)/);
  assert.match(source, /taskBrief\.digest/);
  assert.match(source, /intentGrantDigest/);
  assert.match(source, /budgetDigest/);
  assert.match(source, /intensity:\s*"standard"/);
  assert.match(source, /initialPlanRevision:\s*0/);
  assert.match(source, /planRevision/);
  assert.match(source, /if \(state\.identity\.actorUserId === null\)/);
  assert.match(source, /else \{\s*expect\(state\.identity\.actorUserId\)\.toBe\(actorUserId\);\s*await selectProject/);
  assert.match(source, /taskSubmissionCount\s*===\s*0/);
  assert.match(source, /expect\(state\.ledger\.taskSubmissionCount\)\.toBe\(1\)/);
  assert.doesNotMatch(source, /\.request\.(?:post|put|patch|delete)\s*\(/);
});

test("V1-9 observer stops on typed decisions or recovery and leaves a real ZIP for external acceptance", async () => {
  const source = await readFile(observerUrl, "utf8");

  assert.match(source, /markV1_9RunStatePendingDecision/);
  assert.match(source, /markV1_9RunStateRecoveryStop/);
  assert.match(source, /sha256File/);
  assert.match(source, /package_ready_for_external_acceptance/);
  assert.match(source, /manifestContractDigest/);
  assert.match(source, /toolExposureTrace/);
  assert.match(source, /observations/);
  assert.match(source, /selectLatestV1_9FinalPackage/);
  assert.match(source, /assertV1_9FinalPackageDownloadPath/);
  assert.match(source, /final_package_not_eligible/);
  assert.doesNotMatch(source, /snapshot\.artifacts\.find\(\(artifact\)\s*=>\s*\n?\s*artifact\.nodeKey === "final_delivery"/);
  assert.doesNotMatch(source, /markV1_9RunStateCompletedAfterAcceptance/);
});

test("V1-9 snapshot exposes the persisted Artifact task binding required by the observer selector", async () => {
  const source = await readFile(snapshotRouteUrl, "utf8");

  for (const field of ["taskId", "taskBriefDigest", "intentEpoch", "planRevision", "origin"]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), `${field} must cross the snapshot JSON boundary`);
  }
});

test("V1-9 observer applies the shared recursive evidence sanitizer at the atomic write boundary", async () => {
  const source = await readFile(observerUrl, "utf8");

  assert.match(source, /scripts\/lib\/evidence-sanitizer\.mjs/);
  assert.match(source, /sanitizeEvidenceRecord\(value,/);
  assert.match(source, /sanitizeEvidenceValue\(evidence,/);
  assert.match(source, /writeJsonAtomic\(path\.join\(evidenceRoot, "v1-9-observer-latest\.json"\), sanitizedEvidence\)/);
});
