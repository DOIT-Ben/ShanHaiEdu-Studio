import { createHash, verify as verifySignature } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { resolveTrustedCaptureKey } from "./trust-store.mjs";
import { verifyLedgerAuthorityAttestation } from "./ledger-authority-attestation.mjs";

export const PROVIDER_CAPTURE_SIGNATURE_DOMAIN = "shanhai.provider-source-index.v2\0";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;
const SCENARIO_IDS = [
  "ambiguous-discussion",
  "single-requirement-spec",
  "requirement-spec-and-ppt-outline",
  "main-agent-continuation",
];
const SIGN_INPUT_KEYS = [
  "campaignRoot",
  "ledgerAuthorityAttestation",
  "now",
  "repositoryRoot",
  "runSequence",
  "signBytes",
  "trustedCaptureKeys",
];

export function createSignedCaptureIndex(input = {}) {
  requireExactInputKeys(input, SIGN_INPUT_KEYS, "capture signer");
  if (typeof input.signBytes !== "function") throw new Error("Capture signer signBytes callback is required.");
  const built = buildCaptureIndex(input);
  const payload = domainSeparated(built.indexBytes);
  const signatureBytes = Buffer.from(input.signBytes(Buffer.from(payload)) ?? []);
  if (signatureBytes.length === 0 ||
      !verifySignature(null, payload, built.trustedKey.publicKey, signatureBytes)) {
    throw new Error("Capture source index signature verification failed.");
  }
  const signature = Object.freeze({
    algorithm: "Ed25519",
    domain: PROVIDER_CAPTURE_SIGNATURE_DOMAIN,
    keyId: built.trustedKey.keyId,
    signature: signatureBytes.toString("base64"),
  });
  const sourceIndex = Object.freeze({
    path: "source-index.json",
    sha256: sha256(built.indexBytes),
    ...signature,
  });
  return Object.freeze({ index: built.index, indexBytes: built.indexBytes, signature, sourceIndex });
}

export function verifySignedCaptureIndex(input = {}) {
  requireExactInputKeys(input, [
    "campaignRoot",
    "now",
    "repositoryRoot",
    "sourceIndex",
    "trustedCaptureKeys",
  ], "capture verifier");
  const reference = normalizeSourceIndexReference(input.sourceIndex);
  const repositoryRoot = requireOrdinaryDirectory(input.repositoryRoot, "repository root");
  const campaignRoot = requireCampaignRoot(repositoryRoot, input.campaignRoot);
  const indexPath = resolveOrdinaryFile(campaignRoot, reference.path, "source index");
  const indexBytes = readFileSync(indexPath);
  if (sha256(indexBytes) !== reference.sha256) throw new Error("Signed source index SHA-256 mismatch.");
  const stage = readJsonFile(repositoryRoot, "docs/stages/active-stage.json", "active stage").value;
  const trustedKey = resolveTrustedCaptureKey({
    stage,
    trustedCaptureKeys: input.trustedCaptureKeys,
    keyId: reference.keyId,
    now: input.now,
  });
  const signatureBytes = decodeSignature(reference.signature);
  if (!verifySignature(null, domainSeparated(indexBytes), trustedKey.publicKey, signatureBytes)) {
    throw new Error("Capture source index signature verification failed.");
  }
  const index = parseJson(indexBytes, "signed source index");
  const rebuilt = buildCaptureIndex({
    repositoryRoot,
    campaignRoot,
    runSequence: index?.runSequence,
    ledgerAuthorityAttestation: index?.ledgerAuthority,
    now: input.now,
    trustedCaptureKeys: input.trustedCaptureKeys,
  });
  if (!indexBytes.equals(rebuilt.indexBytes)) {
    throw new Error("Signed source index does not match the current campaign file set and bindings.");
  }
  return Object.freeze({ index, indexBytes, sourceIndex: reference });
}

function buildCaptureIndex({ repositoryRoot, campaignRoot, runSequence, ledgerAuthorityAttestation, trustedCaptureKeys, now = new Date() }) {
  const root = requireOrdinaryDirectory(repositoryRoot, "repository root");
  const campaign = requireCampaignRoot(root, campaignRoot);
  if (!Number.isSafeInteger(runSequence) || runSequence <= 0) {
    throw new Error("Capture runSequence must be a positive integer.");
  }
  const stageFile = readJsonFile(root, "docs/stages/active-stage.json", "active stage");
  const policyFile = readJsonFile(root, "config/development-gates.json", "development policy");
  const verificationFile = readJsonFile(
    root,
    ".tmp/verification/development-verification.json",
    "verification manifest",
  );
  const ledgerFile = readJsonFile(root, "API台账系统/manifest.json", "Provider ledger manifest");
  const stage = stageFile.value;
  const keyId = stage?.providerContinuity?.liveAuthorization?.trustedCaptureKeyId;
  const trustedKey = resolveTrustedCaptureKey({ stage, trustedCaptureKeys, keyId, now });
  const authorization = trustedKey.authorization;
  const subject = normalizeVerificationManifest(verificationFile.value, {
    policySha256: sha256(policyFile.bytes),
    stageSha256: sha256(stageFile.bytes),
    requiredCheckIds: policyFile.value?.verification?.requiredChecks?.map((entry) => entry?.id),
    maxAgeHours: policyFile.value?.verification?.maxAgeHours,
    now,
  });
  if (sha256(ledgerFile.bytes) !== authorization.providerLedgerManifestSha256) {
    throw new Error("Provider ledger manifest SHA-256 does not match the active authorization.");
  }

  const facts = readScenarioFacts(campaign);
  const captures = readCaptureFiles(campaign, facts, authorization);
  const authority = verifyLedgerAuthorityAttestation({
    attestation: ledgerAuthorityAttestation,
    stage,
    trustedCaptureKeys,
    now,
    expected: {
      campaignId: path.basename(campaign),
      runSequence,
      attempts: captures.map((entry) => ({ eventId: entry.eventId, ...entry.reference })),
      factsFiles: [...facts.values()].map((entry) => entry.reference),
      completedAt: captures.map((entry) => entry.completedAt).sort().at(-1),
    },
  });
  const ledger = authority.ledger;

  const binding = Object.freeze({
    verificationManifestSha256: sha256(verificationFile.bytes),
    policySha256: subject.policySha256,
    stageSha256: subject.stageSha256,
    providerLedgerManifestSha256: authorization.providerLedgerManifestSha256,
    channel: authorization.channel,
    modelFingerprint: authorization.modelFingerprint,
    budgetAuthorizationSha256: authorization.budgetAuthorizationSha256,
    maxProviderCalls: authorization.maxProviderCalls,
    maxCostMinorUnits: authorization.maxCostMinorUnits,
    protectedEnvironment: authorization.protectedEnvironment,
    authorizationExpiresAt: authorization.expiresAt,
    trustedCaptureKeyId: trustedKey.keyId,
    trustedCapturePublicKeySha256: trustedKey.publicKeySha256,
    ledgerAuthorityKeyId: authorization.ledgerAuthorityKeyId,
    ledgerAuthorityPublicKeySha256: authorization.ledgerAuthorityPublicKeySha256,
  });
  const scenarios = SCENARIO_IDS.map((id) => {
    const fact = facts.get(id);
    const providerCalls = captures
      .filter((entry) => entry.scenarioId === id)
      .sort((left, right) => left.callOrdinal - right.callOrdinal)
      .map((entry) => entry.reference);
    if (providerCalls.length === 0) throw new Error(`Scenario ${id} has no Provider capture attempts.`);
    return { id, scenarioFacts: fact.reference, providerCalls };
  });
  const startedAt = captures.map((entry) => entry.startedAt).sort()[0];
  const completedAt = captures.map((entry) => entry.completedAt).sort().at(-1);
  const index = Object.freeze({
    schemaVersion: "shanhai-provider-source-index.v2",
    campaignId: path.basename(campaign),
    runSequence,
    serverInstanceId: ledger.serverInstanceId,
    startedAt,
    completedAt,
    captureKeyId: trustedKey.keyId,
    signatureDomain: PROVIDER_CAPTURE_SIGNATURE_DOMAIN,
    subject,
    binding,
    ledger,
    ledgerAuthority: authority.attestation,
    captureFiles: captures.map((entry) => entry.reference.path).sort(),
    factsFiles: [...facts.values()].map((entry) => entry.reference.path).sort(),
    scenarios,
  });
  return { index, indexBytes: jsonBytes(index), trustedKey };
}

function readScenarioFacts(campaignRoot) {
  const files = listOrdinaryFiles(campaignRoot, "facts", "campaign facts");
  if (files.length !== SCENARIO_IDS.length) throw new Error("Campaign facts must contain exactly four ordinary files.");
  const facts = new Map();
  for (const relativePath of files) {
    const source = readJsonFile(campaignRoot, relativePath, "scenario facts");
    const scenario = source.value?.scenario;
    if (source.value?.schemaVersion !== "shanhai-provider-scenario-facts.v1" ||
        !scenario || typeof scenario !== "object" || !SCENARIO_IDS.includes(scenario.id) || facts.has(scenario.id)) {
      throw new Error("Campaign scenario facts are invalid, duplicated, or undeclared.");
    }
    for (const field of ["projectId", "taskId", "teacherMessageId", "turnJobId"]) {
      if (typeof scenario[field] !== "string" || !IDENTIFIER_PATTERN.test(scenario[field])) {
        throw new Error(`Scenario ${scenario.id} ${field} is invalid.`);
      }
    }
    facts.set(scenario.id, {
      scenario,
      reference: { path: relativePath, sha256: sha256(source.bytes) },
    });
  }
  if (SCENARIO_IDS.some((id) => !facts.has(id))) throw new Error("Campaign scenario facts are incomplete.");
  return facts;
}

function readCaptureFiles(campaignRoot, facts, authorization) {
  const files = listOrdinaryFiles(campaignRoot, "capture", "campaign capture");
  if (files.length === 0) throw new Error("Campaign capture is empty.");
  const seenEventIds = new Set();
  return files.map((relativePath) => {
    const source = readJsonFile(campaignRoot, relativePath, "Provider capture");
    const trace = source.value;
    if (trace?.schemaVersion !== "shanhai-provider-call-trace.v1" ||
        trace.campaignId !== path.basename(campaignRoot)) {
      throw new Error("Provider capture identity or schema is invalid.");
    }
    if (typeof trace.eventId !== "string" || !IDENTIFIER_PATTERN.test(trace.eventId) || seenEventIds.has(trace.eventId)) {
      throw new Error("Provider capture eventId values must be present and unique.");
    }
    seenEventIds.add(trace.eventId);
    if (trace.provider?.channel !== authorization.channel) {
      throw new Error("Provider capture channel does not match the active authorization.");
    }
    if (trace.provider?.modelFingerprint !== authorization.modelFingerprint) {
      throw new Error("Provider capture model fingerprint does not match the active authorization.");
    }
    if (trace.provider?.mode !== "real-provider" || trace.result?.outcome !== "succeeded" ||
        !Number.isInteger(trace.result?.httpStatus) || trace.result.httpStatus < 200 || trace.result.httpStatus >= 400 ||
        trace.result?.timeout !== false || trace.result?.errorCategory !== "none") {
      throw new Error("Provider capture contains an unsuccessful or non-real attempt.");
    }
    if (trace.result?.retryCount !== 0) throw new Error("Provider capture retryCount must remain zero.");
    const usage = normalizeUsage(trace.result?.usage);
    const startedAt = requireTimestamp(trace.timing?.startedAt, "Provider capture startedAt");
    const completedAt = requireTimestamp(trace.timing?.completedAt, "Provider capture completedAt");
    if (Date.parse(completedAt) < Date.parse(startedAt)) throw new Error("Provider capture timing is invalid.");
    const scenarioId = matchScenario(trace, facts);
    const callOrdinal = trace.continuity?.callOrdinal;
    if (!Number.isSafeInteger(callOrdinal) || callOrdinal <= 0) throw new Error("Provider call ordinal is invalid.");
    return {
      eventId: trace.eventId,
      scenarioId,
      callOrdinal,
      startedAt,
      completedAt,
      usage,
      reference: { path: relativePath, sha256: sha256(source.bytes) },
    };
  });
}

function matchScenario(trace, facts) {
  const matches = [...facts.entries()].filter(([, entry]) => {
    const scenario = entry.scenario;
    const context = trace.context;
    const expectedTaskId = trace.continuity?.phase === "intake"
      ? `conversation-turn:${scenario.teacherMessageId}`
      : scenario.taskId;
    return context?.projectId === scenario.projectId && context?.taskId === expectedTaskId &&
      context?.teacherMessageId === scenario.teacherMessageId && context?.turnJobId === scenario.turnJobId;
  });
  if (matches.length === 1) return matches[0][0];
  if (matches.length === 2) {
    const id = trace.continuity?.phase === "post_tool"
      ? "main-agent-continuation"
      : "requirement-spec-and-ppt-outline";
    if (matches.some(([candidate]) => candidate === id)) return id;
  }
  throw new Error("Provider capture cannot be mapped uniquely to a scenario fact.");
}

function normalizeVerificationManifest(value, expected) {
  const subject = value?.subject;
  const current = expected.now instanceof Date ? expected.now : new Date(expected.now);
  const createdAt = new Date(value?.createdAt);
  const expectedCheckIds = expected.requiredCheckIds;
  if (value?.schemaVersion !== "shanhai-development-verification.v1" ||
      !subject || typeof subject !== "object" || subject.dirty !== false ||
      !SHA1_PATTERN.test(subject.headSha ?? "") || !SHA1_PATTERN.test(subject.treeSha ?? "") ||
      !SHA256_PATTERN.test(subject.workingTreeDigest ?? "") ||
      subject.policySha256 !== expected.policySha256 || subject.stageSha256 !== expected.stageSha256 ||
      !Array.isArray(expectedCheckIds) || expectedCheckIds.length === 0 ||
      !isDeepStrictEqual(value.requiredCheckIds, expectedCheckIds) ||
      !Array.isArray(value.checks) || value.checks.length !== expectedCheckIds.length ||
      value.checks.some((check, index) => check?.id !== expectedCheckIds[index] || check.exitCode !== 0 ||
        !Number.isSafeInteger(check.durationMs) || check.durationMs < 0 ||
        !SHA256_PATTERN.test(check.outputSha256 ?? "")) ||
      !Number.isSafeInteger(expected.maxAgeHours) || expected.maxAgeHours <= 0 ||
      Number.isNaN(current.getTime()) || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt ||
      createdAt.getTime() > current.getTime() + 5 * 60 * 1000 ||
      current.getTime() - createdAt.getTime() > expected.maxAgeHours * 60 * 60 * 1000) {
    throw new Error("Clean verification manifest subject or checks are invalid.");
  }
  return Object.freeze({
    headSha: subject.headSha,
    treeSha: subject.treeSha,
    workingTreeDigest: subject.workingTreeDigest,
    dirty: false,
    policySha256: subject.policySha256,
    stageSha256: subject.stageSha256,
  });
}

function normalizeUsage(value) {
  const fields = ["inputTokens", "outputTokens", "totalTokens", "cachedTokens", "cacheWriteTokens"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0) ||
      value.totalTokens !== value.inputTokens + value.outputTokens) {
    throw new Error("Provider capture usage is invalid.");
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, value[field]])));
}

function normalizeSourceIndexReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.path !== "source-index.json" ||
      !SHA256_PATTERN.test(value.sha256 ?? "") || value.algorithm !== "Ed25519" ||
      value.domain !== PROVIDER_CAPTURE_SIGNATURE_DOMAIN ||
      typeof value.keyId !== "string" || !IDENTIFIER_PATTERN.test(value.keyId) ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature)) {
    throw new Error("Signed source index reference is invalid.");
  }
  return Object.freeze({
    path: value.path,
    sha256: value.sha256,
    algorithm: value.algorithm,
    domain: value.domain,
    keyId: value.keyId,
    signature: value.signature,
  });
}

function listOrdinaryFiles(root, directoryName, label) {
  const directory = resolveOrdinaryDirectory(root, directoryName, label);
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} contains a non-file entry.`);
    return `${directoryName}/${entry.name}`;
  }).sort();
}

function readJsonFile(root, relativePath, label) {
  const target = resolveOrdinaryFile(root, relativePath, label);
  const bytes = readFileSync(target);
  return { bytes, value: parseJson(bytes, label) };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function resolveOrdinaryDirectory(root, relativePath, label) {
  const target = resolveOrdinaryPath(root, relativePath, label);
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory.`);
  return realpathSync(target);
}

function resolveOrdinaryFile(root, relativePath, label) {
  const target = resolveOrdinaryPath(root, relativePath, label);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary file.`);
  return realpathSync(target);
}

function resolveOrdinaryPath(root, relativePath, label) {
  const portable = requireSafeRelativePath(relativePath, label);
  let current = root;
  for (const segment of portable.split("/")) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse a link.`);
  }
  const physical = realpathSync(current);
  const relative = path.relative(root, physical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes its root.`);
  return physical;
}

function requireCampaignRoot(repositoryRoot, value) {
  const expectedParent = path.join(repositoryRoot, ".tmp", "provider-continuity", "campaigns");
  const candidate = path.resolve(String(value ?? ""));
  const relative = path.relative(expectedParent, candidate);
  if (!relative || relative.includes(path.sep) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Campaign root is not a direct repository campaign directory.");
  }
  return resolveOrdinaryDirectory(repositoryRoot, `.tmp/provider-continuity/campaigns/${relative}`, "campaign root");
}

function requireOrdinaryDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required.`);
  const lexical = path.resolve(value);
  const stat = lstatSync(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory.`);
  return realpathSync(lexical);
}

function requireSafeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
      value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} path is unsafe.`);
  }
  return value;
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} is invalid.`);
  return value;
}

function requireExactInputKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} input is invalid.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} received unexpected input; caller-provided index is forbidden.`);
}

function decodeSignature(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) throw new Error("Capture signature is invalid base64.");
  return bytes;
}

function domainSeparated(indexBytes) {
  return Buffer.concat([Buffer.from(PROVIDER_CAPTURE_SIGNATURE_DOMAIN, "utf8"), indexBytes]);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
