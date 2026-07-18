import { verify as verifySignature } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { resolveTrustedLedgerAuthorityKey } from "./trust-store.mjs";

export const PROVIDER_LEDGER_AUTHORITY_DOMAIN = "shanhai.provider-ledger-authority.v1\0";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;
const ATTESTATION_KEYS = ["payload", "signature"];
const PAYLOAD_KEYS = [
  "attemptCount",
  "attempts",
  "campaignId",
  "factsFiles",
  "issuedAt",
  "nonce",
  "protectedEnvironment",
  "providerLedgerManifestSha256",
  "runSequence",
  "schemaVersion",
  "serverInstanceId",
  "totalCostMinorUnits",
];
const ATTEMPT_KEYS = ["costMinorUnits", "eventId", "path", "sha256"];
const FILE_KEYS = ["path", "sha256"];
const SIGNATURE_KEYS = ["algorithm", "domain", "keyId", "signature"];

export function verifyLedgerAuthorityAttestation({
  attestation,
  stage,
  trustedCaptureKeys,
  expected,
  now = new Date(),
} = {}) {
  requireExactKeys(attestation, ATTESTATION_KEYS, "ledger authority attestation");
  const payload = normalizePayload(attestation.payload);
  const signature = normalizeSignature(attestation.signature);
  const current = normalizeNow(now);
  const trustedKey = resolveTrustedLedgerAuthorityKey({
    stage,
    trustedCaptureKeys,
    keyId: signature.keyId,
    now: current,
  });
  if (!verifySignature(null, domainSeparated(jsonBytes(payload)), trustedKey.publicKey, decodeSignature(signature.signature))) {
    throw new Error("Provider ledger authority attestation signature verification failed.");
  }
  validateExpectedBindings(payload, expected, trustedKey.authorization, current);
  return Object.freeze({
    attestation: Object.freeze({ payload, signature }),
    ledger: Object.freeze({
      schemaVersion: "shanhai-provider-ledger-attestation.v1",
      campaignId: payload.campaignId,
      serverInstanceId: payload.serverInstanceId,
      providerLedgerManifestSha256: payload.providerLedgerManifestSha256,
      attemptCount: payload.attemptCount,
      attempts: payload.attempts.map(({ eventId, costMinorUnits }) => ({ eventId, costMinorUnits })),
      totalCostMinorUnits: payload.totalCostMinorUnits,
    }),
  });
}

export function ledgerAuthorityPayloadBytes(payload) {
  return jsonBytes(normalizePayload(payload));
}

function normalizePayload(value) {
  requireExactKeys(value, PAYLOAD_KEYS, "ledger authority payload");
  if (value.schemaVersion !== "shanhai-provider-ledger-authority-attestation.v1" ||
      !IDENTIFIER_PATTERN.test(value.campaignId ?? "") || !IDENTIFIER_PATTERN.test(value.serverInstanceId ?? "") ||
      !IDENTIFIER_PATTERN.test(value.nonce ?? "") || !IDENTIFIER_PATTERN.test(value.protectedEnvironment ?? "") ||
      !SHA256_PATTERN.test(value.providerLedgerManifestSha256 ?? "") ||
      !Number.isSafeInteger(value.runSequence) || value.runSequence <= 0 ||
      !Number.isSafeInteger(value.attemptCount) || value.attemptCount <= 0 ||
      !Number.isSafeInteger(value.totalCostMinorUnits) || value.totalCostMinorUnits < 0) {
    throw new Error("Provider ledger authority payload is invalid.");
  }
  const issuedAt = requireTimestamp(value.issuedAt, "ledger authority issuedAt");
  const attempts = normalizeReferences(value.attempts, ATTEMPT_KEYS, true, "ledger authority attempts");
  const factsFiles = normalizeReferences(value.factsFiles, FILE_KEYS, false, "ledger authority facts");
  if (attempts.length !== value.attemptCount ||
      attempts.reduce((sum, entry) => sum + entry.costMinorUnits, 0) !== value.totalCostMinorUnits) {
    throw new Error("Provider ledger authority attempt count or cost is inconsistent.");
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    campaignId: value.campaignId,
    runSequence: value.runSequence,
    serverInstanceId: value.serverInstanceId,
    nonce: value.nonce,
    issuedAt,
    protectedEnvironment: value.protectedEnvironment,
    providerLedgerManifestSha256: value.providerLedgerManifestSha256,
    attemptCount: value.attemptCount,
    attempts,
    totalCostMinorUnits: value.totalCostMinorUnits,
    factsFiles,
  });
}

function normalizeReferences(value, fields, withAttempt, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array.`);
  const normalized = value.map((entry) => {
    requireExactKeys(entry, fields, label);
    if (!safeEvidencePath(entry.path) || !SHA256_PATTERN.test(entry.sha256 ?? "") ||
        (withAttempt && (!IDENTIFIER_PATTERN.test(entry.eventId ?? "") ||
          !Number.isSafeInteger(entry.costMinorUnits) || entry.costMinorUnits < 0))) {
      throw new Error(`${label} contains an invalid reference.`);
    }
    return withAttempt
      ? { path: entry.path, sha256: entry.sha256, eventId: entry.eventId, costMinorUnits: entry.costMinorUnits }
      : { path: entry.path, sha256: entry.sha256 };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map((entry) => entry.path.toLowerCase())).size !== normalized.length ||
      (withAttempt && new Set(normalized.map((entry) => entry.eventId)).size !== normalized.length)) {
    throw new Error(`${label} contains duplicate paths or event IDs.`);
  }
  return Object.freeze(normalized.map((entry) => Object.freeze(entry)));
}

function validateExpectedBindings(payload, expected, authorization, now) {
  const expectedAttempts = [...(expected?.attempts ?? [])]
    .map((entry) => ({ path: entry.path, sha256: entry.sha256, eventId: entry.eventId }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const actualAttempts = payload.attempts.map(({ path, sha256, eventId }) => ({ path, sha256, eventId }));
  const expectedFacts = [...(expected?.factsFiles ?? [])]
    .map((entry) => ({ path: entry.path, sha256: entry.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (payload.campaignId !== expected?.campaignId || payload.runSequence !== expected?.runSequence ||
      payload.protectedEnvironment !== authorization.protectedEnvironment ||
      payload.providerLedgerManifestSha256 !== authorization.providerLedgerManifestSha256 ||
      !isDeepStrictEqual(actualAttempts, expectedAttempts) || !isDeepStrictEqual(payload.factsFiles, expectedFacts)) {
    throw new Error("Provider ledger authority attestation does not bind the exact campaign facts and captures.");
  }
  const issuedAtMs = Date.parse(payload.issuedAt);
  const completedAtMs = Date.parse(expected?.completedAt);
  if (!Number.isFinite(completedAtMs) || issuedAtMs < completedAtMs || issuedAtMs > now.getTime() + 5 * 60 * 1000 ||
      issuedAtMs > Date.parse(authorization.expiresAt)) {
    throw new Error("Provider ledger authority attestation is dated after its authority window.");
  }
  if (payload.attemptCount > authorization.maxProviderCalls ||
      payload.totalCostMinorUnits > authorization.maxCostMinorUnits) {
    throw new Error("Provider ledger authority attestation exceeds the authorized budget.");
  }
}

function normalizeSignature(value) {
  requireExactKeys(value, SIGNATURE_KEYS, "ledger authority signature");
  if (value.algorithm !== "Ed25519" || value.domain !== PROVIDER_LEDGER_AUTHORITY_DOMAIN ||
      !IDENTIFIER_PATTERN.test(value.keyId ?? "") ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature)) {
    throw new Error("Provider ledger authority signature contract is invalid.");
  }
  return Object.freeze({ ...value });
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    throw new Error(`${label} fields do not match the exact contract.`);
  }
}

function safeEvidencePath(value) {
  return typeof value === "string" && !value.includes("\\") &&
    (value.startsWith("capture/") || value.startsWith("facts/")) &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeNow(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Ledger authority current time is invalid.");
  return date;
}

function domainSeparated(bytes) {
  return Buffer.concat([Buffer.from(PROVIDER_LEDGER_AUTHORITY_DOMAIN, "utf8"), bytes]);
}

function decodeSignature(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new Error("Provider ledger authority signature is invalid.");
  return bytes;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
