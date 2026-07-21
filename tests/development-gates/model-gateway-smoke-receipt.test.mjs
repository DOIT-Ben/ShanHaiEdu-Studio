import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { collectGitVerificationSubject } from "../../scripts/development-gates/verification-subject.mjs";
import { MODEL_GATEWAY_MODELS, MODEL_GATEWAY_SMOKE_RECEIPT_PATH, verifyModelGatewaySmokeReceipt } from "../../scripts/development-gates/model-gateway-smoke-receipt.mjs";

test("model gateway smoke receipt binds shared and PPT image capabilities to the current candidate", () => {
  const root = createRepository();
  try {
    const generatedAt = new Date().toISOString();
    writeReceipt(root, generatedAt);
    assert.deepEqual(verifyModelGatewaySmokeReceipt({ root, now: generatedAt }), {
      ok: true,
      passed: true,
      status: "passed",
      matchedPaths: [],
      verifiedAt: generatedAt,
      receiptPath: MODEL_GATEWAY_SMOKE_RECEIPT_PATH,
    });

    writeFileSync(path.join(root, "candidate.txt"), "changed\n", "utf8");
    assert.throws(() => verifyModelGatewaySmokeReceipt({ root, now: generatedAt }), /SUBJECT_MISMATCH/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model gateway smoke receipt rejects a missing media proof", () => {
  const root = createRepository();
  try {
    const generatedAt = new Date().toISOString();
    const receipt = createReceipt(root, generatedAt);
    receipt.checks.video.bytes = 0;
    writeReceiptValue(root, receipt);
    assert.throws(() => verifyModelGatewaySmokeReceipt({ root, now: generatedAt }), /ARTIFACT_CHECK_FAILED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-gateway-receipt-"));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "docs", "stages"), { recursive: true });
  writeFileSync(path.join(root, "config", "development-gates.json"), "{}\n", "utf8");
  writeFileSync(path.join(root, "docs", "stages", "active-stage.json"), "{}\n", "utf8");
  writeFileSync(path.join(root, ".gitignore"), ".tmp/\n", "utf8");
  writeFileSync(path.join(root, "candidate.txt"), "initial\n", "utf8");
  git(root, "init");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

function writeReceipt(root, generatedAt) {
  writeReceiptValue(root, createReceipt(root, generatedAt));
}

function writeReceiptValue(root, receipt) {
  const receiptPath = path.join(root, ...MODEL_GATEWAY_SMOKE_RECEIPT_PATH.split("/"));
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function createReceipt(root, generatedAt) {
  const media = { ok: true, status: 200, bytes: 4096, sha256: "a".repeat(64), requestIdPresent: true };
  return {
    schemaVersion: "shanhai-model-gateway-smoke-receipt.v1",
    generatedAt,
    subject: collectGitVerificationSubject(root),
    models: MODEL_GATEWAY_MODELS,
    configDigest: "b".repeat(64),
    checks: {
      models: { ok: true, status: 200, requiredModelsPresent: true },
      agent: { ok: true, status: 200, model: MODEL_GATEWAY_MODELS.agent, requestIdPresent: true },
      text: { ok: true, status: 200, model: MODEL_GATEWAY_MODELS.text, requestIdPresent: true },
      image: { ...media, model: MODEL_GATEWAY_MODELS.image },
      pptImage: { ...media, model: MODEL_GATEWAY_MODELS.pptImage },
      tts: { ...media, model: MODEL_GATEWAY_MODELS.tts },
      video: { ...media, status: "completed", model: MODEL_GATEWAY_MODELS.video },
    },
  };
}

function git(root, ...args) {
  execFileSync("git", args, { cwd: root, stdio: "ignore", windowsHide: true });
}
