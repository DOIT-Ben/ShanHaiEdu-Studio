import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { verifySignedCaptureIndex } from "./capture-signature.mjs";
import { buildCampaignEvidence } from "./evidence-builder.mjs";

const MANIFEST_KEYS = ["binding", "generatedAt", "mode", "runs", "schemaVersion", "subject"];
const RECEIPT_KEYS = ["manifestSha256", "mode", "runs", "schemaVersion", "subject", "verifiedAt"];
const RUN_KEYS = ["campaignId", "sequence", "sourceIndex"];
const SOURCE_INDEX_KEYS = ["algorithm", "domain", "keyId", "path", "sha256", "signature"];
const SUBJECT_KEYS = ["dirty", "headSha", "policySha256", "stageSha256", "treeSha", "workingTreeDigest"];
const BINDING_KEYS = [
  "budgetAuthorizationSha256",
  "channel",
  "maxCostMinorUnits",
  "maxProviderCalls",
  "modelFingerprint",
  "policySha256",
  "protectedEnvironment",
  "providerLedgerManifestSha256",
  "stageSha256",
  "verificationManifestSha256",
  "authorizationExpiresAt",
  "ledgerAuthorityKeyId",
  "ledgerAuthorityPublicKeySha256",
  "trustedCaptureKeyId",
  "trustedCapturePublicKeySha256",
];
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;

export function verifyProviderContinuityReceiptV2({
  repositoryRoot,
  manifestBytes,
  receiptBytes,
  requiredRuns,
  trustedCaptureKeys,
  now = new Date(),
  maxAgeHours,
} = {}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new Error("Provider receipt repository root is required.");
  }
  if (!Number.isSafeInteger(requiredRuns) || requiredRuns <= 0) {
    throw new Error("Provider receipt requiredRuns must be a positive integer.");
  }
  if (!Number.isSafeInteger(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("Provider receipt maxAgeHours must be a positive integer.");
  }
  const current = normalizeNow(now);
  const exactManifestBytes = copyBytes(manifestBytes, "Provider manifest bytes");
  const exactReceiptBytes = copyBytes(receiptBytes, "Provider receipt bytes");
  const evidenceRootDigest = createHash("sha256")
    .update("shanhai-provider-continuity-evidence-root.v1\0", "utf8")
    .update(exactManifestBytes)
    .update("\0receipt\0", "utf8")
    .update(exactReceiptBytes);
  const manifest = parseJson(exactManifestBytes, "Provider manifest");
  const receipt = parseJson(exactReceiptBytes, "Provider receipt");
  requireExactKeys(manifest, MANIFEST_KEYS, "Provider manifest");
  requireExactKeys(receipt, RECEIPT_KEYS, "Provider receipt");
  if (manifest.schemaVersion !== "shanhai-provider-continuity-manifest.v2" ||
      receipt.schemaVersion !== "shanhai-provider-continuity-receipt.v2") {
    throw new Error("Provider continuity v2 manifest and receipt schemas are required.");
  }
  if (manifest.mode !== "development" || receipt.mode !== manifest.mode) {
    throw new Error("Provider continuity receipt mode is invalid or inconsistent.");
  }
  if (!SHA256_PATTERN.test(receipt.manifestSha256 ?? "") ||
      receipt.manifestSha256 !== sha256(exactManifestBytes)) {
    throw new Error("Provider receipt manifest SHA-256 mismatch.");
  }
  const subject = normalizeSubject(receipt.subject);
  if (!isDeepStrictEqual(subject, normalizeSubject(manifest.subject))) {
    throw new Error("Provider manifest and receipt subjects do not match.");
  }
  const binding = normalizeBinding(manifest.binding);
  const manifestTime = requireTimestamp(manifest.generatedAt, "Provider manifest generatedAt");
  const receiptTime = requireTimestamp(receipt.verifiedAt, "Provider receipt verifiedAt");
  if (Date.parse(receiptTime) < Date.parse(manifestTime)) {
    throw new Error("Provider receipt predates its manifest.");
  }
  if (Date.parse(receiptTime) > current.getTime() + 5 * 60 * 1000 ||
      current.getTime() - Date.parse(receiptTime) > maxAgeHours * 60 * 60 * 1000) {
    throw new Error("Provider continuity receipt has expired or is dated in the future.");
  }
  const manifestRuns = normalizeRuns(manifest.runs, requiredRuns, "Provider manifest");
  const receiptRuns = normalizeRuns(receipt.runs, requiredRuns, "Provider receipt");
  if (!isDeepStrictEqual(manifestRuns, receiptRuns)) {
    throw new Error("Provider manifest and receipt run references do not match.");
  }

  let serverInstanceId = null;
  let previousCompletedAt = null;
  const authorityNonces = new Set();
  const oldestAllowedCampaignTime = current.getTime() - maxAgeHours * 60 * 60 * 1000;
  for (let index = 0; index < receiptRuns.length; index += 1) {
    const run = receiptRuns[index];
    if (run.sequence !== index + 1) {
      throw new Error(`Provider run sequence must start at 1 and remain consecutive (run ${index + 1}).`);
    }
    const campaignRoot = path.join(
      path.resolve(repositoryRoot),
      ".tmp",
      "provider-continuity",
      "campaigns",
      run.campaignId,
    );
    const verified = verifySignedCaptureIndex({
      repositoryRoot,
      campaignRoot,
      sourceIndex: run.sourceIndex,
      trustedCaptureKeys,
      now: current,
    });
    evidenceRootDigest.update(`\0source-index-${run.sequence}\0`, "utf8").update(verified.indexBytes);
    if (verified.index.campaignId !== run.campaignId || verified.index.runSequence !== run.sequence) {
      throw new Error("Signed source index campaign identity or sequence does not match its receipt run.");
    }
    if (!isDeepStrictEqual(normalizeSubject(verified.index.subject), subject)) {
      throw new Error("Signed source index subject does not match the receipt subject.");
    }
    if (!isDeepStrictEqual(normalizeBinding(verified.index.binding), binding)) {
      throw new Error("Signed source index authorization binding does not match the manifest.");
    }
    const authorityNonce = verified.index.ledgerAuthority?.payload?.nonce;
    if (typeof authorityNonce !== "string" || authorityNonces.has(authorityNonce)) {
      throw new Error("Provider ledger authority nonce must be present and unique across runs.");
    }
    authorityNonces.add(authorityNonce);
    const evidence = buildCampaignEvidence({
      repositoryRoot,
      campaignRoot,
      sourceIndex: run.sourceIndex,
      trustedCaptureKeys,
    });
    if (evidence.result !== "source-verified") {
      throw new Error("Provider campaign evidence did not reach source-verified.");
    }
    const startedAt = requireTimestamp(verified.index.startedAt, "Provider campaign startedAt");
    const completedAt = requireTimestamp(verified.index.completedAt, "Provider campaign completedAt");
    if (Date.parse(completedAt) < oldestAllowedCampaignTime) {
      throw new Error("Provider signed campaign has expired and cannot be repackaged in a newer receipt.");
    }
    if (Date.parse(completedAt) > Date.parse(manifestTime) ||
        (previousCompletedAt !== null && Date.parse(startedAt) < Date.parse(previousCompletedAt))) {
      throw new Error("Provider continuity campaign time sequence is invalid.");
    }
    previousCompletedAt = completedAt;
    if (serverInstanceId === null) serverInstanceId = verified.index.serverInstanceId;
    else if (verified.index.serverInstanceId !== serverInstanceId) {
      throw new Error("Provider continuity runs must use the same server instance.");
    }
  }

  return Object.freeze({
    ok: true,
    passed: true,
    status: "passed",
    consecutiveRuns: receiptRuns.length,
    serverInstanceId,
    binding: Object.freeze({ ...binding }),
    manifestSha256: sha256(exactManifestBytes),
    receiptSha256: sha256(exactReceiptBytes),
    evidenceRootDigest: evidenceRootDigest.digest("hex"),
    subject: Object.freeze({ ...subject }),
  });
}

function normalizeRuns(value, requiredRuns, label) {
  if (!Array.isArray(value) || value.length !== requiredRuns) {
    throw new Error(`${label} must contain exactly ${requiredRuns} runs.`);
  }
  const campaigns = new Set();
  return value.map((run, index) => {
    requireExactKeys(run, RUN_KEYS, `${label} run ${index + 1}`);
    if (!Number.isSafeInteger(run.sequence) || run.sequence <= 0 ||
        typeof run.campaignId !== "string" || !IDENTIFIER_PATTERN.test(run.campaignId)) {
      throw new Error(`${label} run ${index + 1} identity is invalid.`);
    }
    if (campaigns.has(run.campaignId)) throw new Error(`${label} campaign IDs must be unique.`);
    campaigns.add(run.campaignId);
    if (!run.sourceIndex || typeof run.sourceIndex !== "object" || Array.isArray(run.sourceIndex)) {
      throw new Error(`${label} run ${index + 1} signed source index reference is invalid.`);
    }
    requireExactKeys(run.sourceIndex, SOURCE_INDEX_KEYS, `${label} run ${index + 1} signed source index reference`);
    return {
      sequence: run.sequence,
      campaignId: run.campaignId,
      sourceIndex: { ...run.sourceIndex },
    };
  });
}

function normalizeSubject(value) {
  requireExactKeys(value, SUBJECT_KEYS, "Provider continuity subject");
  if (!SHA1_PATTERN.test(value.headSha ?? "") || !SHA1_PATTERN.test(value.treeSha ?? "") ||
      !SHA256_PATTERN.test(value.workingTreeDigest ?? "") ||
      !SHA256_PATTERN.test(value.policySha256 ?? "") || !SHA256_PATTERN.test(value.stageSha256 ?? "") ||
      value.dirty !== false) {
    throw new Error("Provider continuity subject must bind a clean verification candidate.");
  }
  return Object.fromEntries(SUBJECT_KEYS.map((key) => [key, value[key]]));
}

function normalizeBinding(value) {
  requireExactKeys(value, BINDING_KEYS, "Provider continuity binding");
  for (const field of [
    "verificationManifestSha256",
    "policySha256",
    "stageSha256",
    "providerLedgerManifestSha256",
    "modelFingerprint",
    "budgetAuthorizationSha256",
    "trustedCapturePublicKeySha256",
    "ledgerAuthorityPublicKeySha256",
  ]) {
    if (!SHA256_PATTERN.test(value[field] ?? "")) throw new Error(`Provider continuity ${field} is invalid.`);
  }
  requireTimestamp(value.authorizationExpiresAt, "Provider authorization expiresAt");
  if (!["primary", "third"].includes(value.channel) ||
      typeof value.protectedEnvironment !== "string" || !IDENTIFIER_PATTERN.test(value.protectedEnvironment) ||
      typeof value.trustedCaptureKeyId !== "string" || !IDENTIFIER_PATTERN.test(value.trustedCaptureKeyId) ||
      typeof value.ledgerAuthorityKeyId !== "string" || !IDENTIFIER_PATTERN.test(value.ledgerAuthorityKeyId) ||
      !Number.isSafeInteger(value.maxProviderCalls) || value.maxProviderCalls <= 0 ||
      !Number.isSafeInteger(value.maxCostMinorUnits) || value.maxCostMinorUnits <= 0) {
    throw new Error("Provider continuity authorization binding is invalid.");
  }
  return Object.fromEntries(BINDING_KEYS.map((key) => [key, value[key]]));
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label} fields do not match the v2 contract.`);
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeNow(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Provider receipt current time is invalid.");
  return date;
}

function copyBytes(value, label) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error(`${label} are required.`);
  return Buffer.from(value);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
