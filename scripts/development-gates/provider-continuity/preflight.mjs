import { isDeepStrictEqual } from "node:util";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;

export function validateLivePreflight(input = {}) {
  if (input.liveCallsAuthorized !== true) {
    throw new Error("Real Provider calls are not authorized for this active stage.");
  }
  const approved = normalizeApprovedAuthorization(input.approvedAuthorization);
  const requested = normalizeRequestedAuthorization(input.requestedAuthorization);
  if (!isDeepStrictEqual(requested, pickRequestedAuthorization(approved))) {
    throw new Error("Requested Provider authorization does not match the active stage contract.");
  }
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  if (!Number.isFinite(now.getTime()) || now.getTime() >= Date.parse(approved.expiresAt)) {
    throw new Error("Provider authorization has expired.");
  }
  if (!Array.isArray(input.trustedCaptureKeyIds) ||
      !input.trustedCaptureKeyIds.includes(approved.trustedCaptureKeyId)) {
    throw new Error("Provider authorization capture key is not trusted by the active stage.");
  }
  if (!Array.isArray(input.trustedLedgerAuthorityKeyIds) ||
      !input.trustedLedgerAuthorityKeyIds.includes(approved.ledgerAuthorityKeyId)) {
    throw new Error("Provider authorization ledger authority key is not trusted by the active stage.");
  }
  if (input.verifyProtectedEnvironment?.(approved.protectedEnvironment) !== true) {
    throw new Error("Provider protected environment verification is required.");
  }
  if (input.verifyLedgerBinding?.({
    channel: approved.channel,
    manifestSha256: approved.providerLedgerManifestSha256,
  }) !== true) {
    throw new Error("Provider ledger binding verification is required.");
  }
  const result = Object.freeze({ ...approved });
  input.onAuthorized?.(result);
  return result;
}

function normalizeApprovedAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Active stage Provider authorization is missing.");
  }
  const requested = normalizeRequestedAuthorization(value);
  const expiresAt = requireTimestamp(value.expiresAt, "authorization expiry");
  const protectedEnvironment = requireIdentifier(value.protectedEnvironment, "protected environment");
  const trustedCaptureKeyId = requireIdentifier(value.trustedCaptureKeyId, "trusted capture key ID");
  const ledgerAuthorityKeyId = requireIdentifier(value.ledgerAuthorityKeyId, "ledger authority key ID");
  const trustedCapturePublicKeySha256 = requireDigest(value.trustedCapturePublicKeySha256, "trusted capture public key");
  const ledgerAuthorityPublicKeySha256 = requireDigest(value.ledgerAuthorityPublicKeySha256, "ledger authority public key");
  if (ledgerAuthorityKeyId === trustedCaptureKeyId ||
      ledgerAuthorityPublicKeySha256 === trustedCapturePublicKeySha256) {
    throw new Error("Capture signing and ledger authority keys must be distinct.");
  }
  return {
    ...requested,
    expiresAt,
    protectedEnvironment,
    providerLedgerManifestSha256: requireDigest(value.providerLedgerManifestSha256, "Provider ledger manifest"),
    trustedCaptureKeyId,
    trustedCapturePublicKeySha256,
    ledgerAuthorityKeyId,
    ledgerAuthorityPublicKeySha256,
  };
}

function normalizeRequestedAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Requested Provider authorization is missing.");
  }
  if (!["primary", "third"].includes(value.channel)) {
    throw new Error("An explicit non-fallback Provider channel is required.");
  }
  return {
    channel: value.channel,
    modelFingerprint: requireDigest(value.modelFingerprint, "model fingerprint"),
    budgetAuthorizationSha256: requireDigest(value.budgetAuthorizationSha256, "budget authorization"),
    maxProviderCalls: requirePositiveInteger(value.maxProviderCalls, "max Provider calls"),
    maxCostMinorUnits: requirePositiveInteger(value.maxCostMinorUnits, "max cost minor units"),
  };
}

function pickRequestedAuthorization(value) {
  return {
    channel: value.channel,
    modelFingerprint: value.modelFingerprint,
    budgetAuthorizationSha256: value.budgetAuthorizationSha256,
    maxProviderCalls: value.maxProviderCalls,
    maxCostMinorUnits: value.maxCostMinorUnits,
  };
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value.toLowerCase();
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
