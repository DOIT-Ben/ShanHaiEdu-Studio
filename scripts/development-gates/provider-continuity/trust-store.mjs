import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;

export function resolveTrustedCaptureKey({ stage, trustedCaptureKeys, keyId, now = new Date() } = {}) {
  const contract = resolveStageTrustContract(stage, now);
  if (!contract.continuity.trustedCaptureKeyIds.includes(keyId) ||
      contract.authorization.trustedCaptureKeyId !== keyId) {
    throw new Error("Active stage does not authorize the capture signing key.");
  }
  return resolveTrustedPublicKey({
    trustedCaptureKeys,
    keyId,
    expectedSha256: contract.authorization.trustedCapturePublicKeySha256,
    authorization: contract.authorization,
    label: "Capture signing",
  });
}

export function resolveTrustedLedgerAuthorityKey({ stage, trustedCaptureKeys, keyId, now = new Date() } = {}) {
  const contract = resolveStageTrustContract(stage, now);
  if (!contract.continuity.trustedLedgerAuthorityKeyIds.includes(keyId) ||
      contract.authorization.ledgerAuthorityKeyId !== keyId) {
    throw new Error("Active stage does not authorize the Provider ledger authority key.");
  }
  return resolveTrustedPublicKey({
    trustedCaptureKeys,
    keyId,
    expectedSha256: contract.authorization.ledgerAuthorityPublicKeySha256,
    authorization: contract.authorization,
    label: "Provider ledger authority",
  });
}

function resolveStageTrustContract(stage, now) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage) ||
      stage.schemaVersion !== "shanhai-active-stage.v1" ||
      stage.stageId !== "p0-05a-provider-continuity-readiness" || stage.status !== "active") {
    throw new Error("Active P0-05A stage trust contract is invalid.");
  }
  const continuity = stage.providerContinuity;
  const authorization = continuity?.liveAuthorization;
  const current = normalizeNow(now);
  if (continuity?.liveCallsAuthorized !== true ||
      continuity?.requiredReceiptSchema !== "shanhai-provider-continuity-receipt.v2" ||
      !Array.isArray(continuity?.trustedCaptureKeyIds) ||
      !Array.isArray(continuity?.trustedLedgerAuthorityKeyIds)) {
    throw new Error("Active stage trust key declarations are invalid.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(continuity.expiresOn ?? "") ||
      Date.parse(`${continuity.expiresOn}T23:59:59.999Z`) < current.getTime()) {
    throw new Error("Active P0-05A stage trust contract has expired.");
  }
  const normalizedAuthorization = normalizeAuthorization(authorization, current);
  if (normalizedAuthorization.ledgerAuthorityKeyId === normalizedAuthorization.trustedCaptureKeyId ||
      normalizedAuthorization.ledgerAuthorityPublicKeySha256 === normalizedAuthorization.trustedCapturePublicKeySha256) {
    throw new Error("Capture signing and ledger authority keys must be distinct.");
  }
  return { continuity, authorization: normalizedAuthorization };
}

function resolveTrustedPublicKey({ trustedCaptureKeys, keyId, expectedSha256, authorization, label }) {
  if (typeof keyId !== "string" || !IDENTIFIER_PATTERN.test(keyId)) {
    throw new Error(`${label} key ID is invalid.`);
  }
  if (!Array.isArray(trustedCaptureKeys)) throw new Error("Trusted capture keys are required.");
  const matches = trustedCaptureKeys.filter((entry) => entry?.keyId === keyId);
  if (matches.length !== 1) throw new Error(`${label} key is unknown or duplicated.`);
  const key = matches[0];
  const keyFields = key && typeof key === "object" && !Array.isArray(key) ? Object.keys(key).sort() : [];
  if (JSON.stringify(keyFields) !== JSON.stringify(["algorithm", "keyId", "publicKeyPem", "publicKeySha256"]) ||
      key.algorithm !== "Ed25519") throw new Error(`${label} keys must use the exact Ed25519 public contract.`);
  if (typeof key.publicKeyPem !== "string" || key.publicKeyPem.includes("PRIVATE KEY") ||
      !SHA256_PATTERN.test(key.publicKeySha256 ?? "")) {
    throw new Error(`${label} public key contract is invalid.`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
  } catch {
    throw new Error(`${label} public key is invalid.`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} public key must be Ed25519.`);
  }
  const publicKeySha256 = createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex");
  if (publicKeySha256 !== key.publicKeySha256 ||
      publicKeySha256 !== expectedSha256) {
    throw new Error(`${label} public key SHA-256 does not match the active stage.`);
  }
  return Object.freeze({
    keyId,
    algorithm: "Ed25519",
    publicKey,
    publicKeySha256,
    authorization,
  });
}

export function loadTrustedCaptureKeys({ repositoryRoot, relativePath } = {}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new Error("Capture trust repository root is required.");
  }
  if (typeof relativePath !== "string" || !relativePath.startsWith("config/") || relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) ||
      relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Capture trust store path is unsafe.");
  }
  const root = realpathSync(path.resolve(repositoryRoot));
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Capture trust store must not traverse a link.");
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Capture trust store must be an ordinary file.");
  const physical = realpathSync(current);
  const relative = path.relative(root, physical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Capture trust store escapes the repository.");
  let value;
  try {
    value = JSON.parse(readFileSync(physical, "utf8"));
  } catch {
    throw new Error("Capture trust store is not valid JSON.");
  }
  const topLevelFields = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (JSON.stringify(topLevelFields) !== JSON.stringify(["keys", "schemaVersion"]) ||
      value?.schemaVersion !== "shanhai-provider-capture-trust.v1" || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new Error("Capture trust store contract is invalid.");
  }
  return value.keys.map((entry) => {
    const keys = entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify(["algorithm", "keyId", "publicKeyPem", "publicKeySha256"]) ||
        typeof entry.publicKeyPem !== "string" || entry.publicKeyPem.includes("PRIVATE KEY")) {
      throw new Error("Capture trust store key entry is invalid.");
    }
    return Object.freeze({ ...entry });
  });
}

function normalizeAuthorization(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["primary", "third"].includes(value.channel) ||
      !SHA256_PATTERN.test(value.modelFingerprint ?? "") ||
      !SHA256_PATTERN.test(value.budgetAuthorizationSha256 ?? "") ||
      !SHA256_PATTERN.test(value.providerLedgerManifestSha256 ?? "") ||
      !SHA256_PATTERN.test(value.trustedCapturePublicKeySha256 ?? "") ||
      !SHA256_PATTERN.test(value.ledgerAuthorityPublicKeySha256 ?? "") ||
      typeof value.protectedEnvironment !== "string" || !IDENTIFIER_PATTERN.test(value.protectedEnvironment) ||
      typeof value.trustedCaptureKeyId !== "string" || !IDENTIFIER_PATTERN.test(value.trustedCaptureKeyId) ||
      typeof value.ledgerAuthorityKeyId !== "string" || !IDENTIFIER_PATTERN.test(value.ledgerAuthorityKeyId) ||
      !Number.isSafeInteger(value.maxProviderCalls) || value.maxProviderCalls <= 0 ||
      !Number.isSafeInteger(value.maxCostMinorUnits) || value.maxCostMinorUnits <= 0) {
    throw new Error("Active Provider authorization contract is invalid.");
  }
  const expiresAt = new Date(value.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== value.expiresAt || expiresAt <= now) {
    throw new Error("Active Provider authorization has expired.");
  }
  return Object.freeze({
    channel: value.channel,
    modelFingerprint: value.modelFingerprint,
    budgetAuthorizationSha256: value.budgetAuthorizationSha256,
    maxProviderCalls: value.maxProviderCalls,
    maxCostMinorUnits: value.maxCostMinorUnits,
    expiresAt: value.expiresAt,
    protectedEnvironment: value.protectedEnvironment,
    providerLedgerManifestSha256: value.providerLedgerManifestSha256,
    trustedCaptureKeyId: value.trustedCaptureKeyId,
    trustedCapturePublicKeySha256: value.trustedCapturePublicKeySha256,
    ledgerAuthorityKeyId: value.ledgerAuthorityKeyId,
    ledgerAuthorityPublicKeySha256: value.ledgerAuthorityPublicKeySha256,
  });
}

function normalizeNow(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Capture trust current time is invalid.");
  return date;
}
