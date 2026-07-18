import { createHash, verify as verifySignature } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { validateScenarioSequence } from "./scenario-runner.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;

export function buildCampaignEvidence({ repositoryRoot, campaignRoot, sourceIndex, trustedCaptureKeys } = {}) {
  const root = requireCampaignRoot(campaignRoot);
  const indexReference = validateSignedIndexReference(sourceIndex);
  const indexSource = readBoundSource(root, {
    path: indexReference.path,
    sha256: indexReference.sha256,
    kind: "source-index",
  }, 0);
  const stageTrust = requireStageTrust(repositoryRoot, root, indexReference.keyId);
  const trustedKey = requireTrustedCaptureKey(
    trustedCaptureKeys,
    indexReference.keyId,
    stageTrust.publicKeySha256,
  );
  verifyIndexSignature(indexSource.bytes, indexReference.signature, trustedKey.publicKeyPem);

  const index = normalizeSourceIndex(indexSource.value, root, indexReference.keyId);
  const actualCapturePaths = listCapturePaths(root);
  if (!sameArray(index.captureFiles, actualCapturePaths)) {
    throw new Error("Signed source index does not enumerate the exact campaign capture file set.");
  }

  const ordinalState = new Map();
  const evidence = index.scenarios.map((entry, scenarioIndex) => {
    const scenarioSource = readBoundSource(root, { ...entry.scenarioFacts, kind: "scenario-facts" }, scenarioIndex + 1);
    if (scenarioSource.value?.schemaVersion !== "shanhai-provider-scenario-facts.v1") {
      throw new Error(`Scenario ${entry.id} facts use an unsupported schema.`);
    }
    const scenario = normalizeScenario(scenarioSource.value.scenario);
    if (scenario.id !== entry.id) throw new Error("Signed source index scenario identity does not match its fact source.");
    if (entry.providerCalls.length === 0) {
      throw new Error(`Scenario ${entry.id} must include Provider call sources.`);
    }
    const providerCalls = entry.providerCalls.map((reference, callIndex) => {
      const source = readProviderCallSource(root, reference, callIndex);
      const call = providerCallFromSource(source, root);
      validateProviderCall(call, scenario, ordinalState);
      return call;
    });
    if (scenarioIndex === 3 && providerCalls.some((call) => call.phase !== "post_tool")) {
      throw new Error("Main Agent continuation must bind only post-tool Provider calls from the shared turn.");
    }
    return {
      ...scenario,
      providerCalls,
      sourceFacts: [{ ...entry.scenarioFacts, kind: "scenario-facts" }],
      result: "source-verified",
    };
  });
  validateScenarioSequence(evidence);
  validateScenarioPolicy(evidence);
  return Object.freeze({
    schemaVersion: "shanhai-provider-campaign-evidence.v2",
    campaignId: index.campaignId,
    captureKeyId: index.captureKeyId,
    sourceIndex: indexReference,
    scenarios: evidence,
    result: "source-verified",
  });
}

function validateScenarioPolicy(scenarios) {
  const contracts = [
    { tools: [], artifacts: 0, epoch: "unchanged" },
    { tools: ["create_requirement_spec"], artifacts: 1, epoch: "advanced-once" },
    { tools: ["create_ppt_outline", "create_requirement_spec"], artifacts: 2, epoch: "unchanged" },
    { tools: [], artifacts: 0, epoch: "unchanged" },
  ];
  scenarios.forEach((scenario, index) => {
    const contract = contracts[index];
    const tools = scenario.toolInvocations.map((entry) => entry.name).sort();
    if (tools.some((name) => typeof name !== "string") || !sameArray(tools, contract.tools)) {
      throw new Error(`Scenario ${scenario.id} Tool contract does not match the continuity policy.`);
    }
    if (scenario.artifacts.length !== contract.artifacts || scenario.observations.length === 0 ||
        scenario.terminalState !== "completed") {
      throw new Error(`Scenario ${scenario.id} persisted outcome does not match the continuity policy.`);
    }
    const expectedEpoch = contract.epoch === "advanced-once"
      ? scenario.intentEpochBefore + 1
      : scenario.intentEpochBefore;
    if (scenario.intentEpochAfter !== expectedEpoch) {
      throw new Error(`Scenario ${scenario.id} IntentEpoch does not match the continuity policy.`);
    }
    const toolProviderCalls = scenario.providerCalls.filter((call) => call.phase === "tool").length;
    if (toolProviderCalls < contract.tools.length) {
      throw new Error(`Scenario ${scenario.id} is missing Tool Provider call evidence.`);
    }
  });
  const source = scenarios[2];
  const continuation = scenarios[3];
  if (continuation.projectId !== source.projectId || continuation.taskId !== source.taskId ||
      continuation.intentEpochBefore !== source.intentEpochAfter ||
      continuation.providerCalls.some((call) => call.phase !== "post_tool")) {
    throw new Error("Main Agent continuation is not bound to scenario C product state.");
  }
  if (scenarios[1].providerCalls.every((call) => call.phase !== "post_tool")) {
    throw new Error("Single Tool scenario is missing its post-tool Main Agent continuation.");
  }
}

function normalizeSourceIndex(value, root, keyId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schemaVersion !== "shanhai-provider-source-index.v2" ||
      value.campaignId !== path.basename(root) || value.captureKeyId !== keyId) {
    throw new Error("Signed Provider source index identity is invalid.");
  }
  if (!Array.isArray(value.captureFiles) || !Array.isArray(value.scenarios)) {
    throw new Error("Signed Provider source index is incomplete.");
  }
  const captureFiles = normalizeUniquePaths(value.captureFiles, "captureFiles");
  const scenarios = value.scenarios.map((entry, index) => normalizeIndexedScenario(entry, index));
  const referencedCapture = scenarios.flatMap((entry) => entry.providerCalls.map((source) => source.path)).sort();
  if (!sameArray(captureFiles, referencedCapture)) {
    throw new Error("Signed Provider source index captureFiles do not match its scenario references.");
  }
  return { campaignId: value.campaignId, captureKeyId: value.captureKeyId, captureFiles, scenarios };
}

function normalizeIndexedScenario(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.id !== "string" || !IDENTIFIER_PATTERN.test(value.id) ||
      !Array.isArray(value.providerCalls)) {
    throw new Error(`Signed source index scenario ${index} is invalid.`);
  }
  const scenarioFacts = validateSourceReference(value.scenarioFacts, `scenario ${index} facts`);
  const providerCalls = value.providerCalls.map((entry, callIndex) =>
    validateSourceReference(entry, `scenario ${index} Provider call ${callIndex}`));
  const paths = providerCalls.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error(`Scenario ${value.id} Provider sources are duplicated.`);
  return { id: value.id, scenarioFacts, providerCalls };
}

function normalizeScenario(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Scenario fact is required.");
  for (const field of ["id", "projectId", "taskId", "teacherMessageId", "turnJobId", "terminalState"]) {
    if (typeof value[field] !== "string" || !IDENTIFIER_PATTERN.test(value[field])) {
      throw new Error(`Scenario ${field} is invalid.`);
    }
  }
  for (const field of ["intentEpochBefore", "intentEpochAfter"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new Error(`Scenario ${field} is invalid.`);
  }
  if (typeof value.submittedTeacherMessage !== "boolean") throw new Error("Scenario submittedTeacherMessage is invalid.");
  return {
    id: value.id,
    projectId: value.projectId,
    taskId: value.taskId,
    teacherMessageId: value.teacherMessageId,
    turnJobId: value.turnJobId,
    intentEpochBefore: value.intentEpochBefore,
    intentEpochAfter: value.intentEpochAfter,
    terminalState: value.terminalState,
    submittedTeacherMessage: value.submittedTeacherMessage,
    toolInvocations: structuredArray(value.toolInvocations, "toolInvocations"),
    observations: structuredArray(value.observations, "observations"),
    artifacts: structuredArray(value.artifacts, "artifacts"),
  };
}

function readProviderCallSource(root, reference, index) {
  const source = readBoundSource(root, { ...reference, kind: "provider-call" }, index);
  if (source.value?.schemaVersion !== "shanhai-provider-call-trace.v1") {
    throw new Error(`Provider call source ${index} has an unsupported schema.`);
  }
  return source;
}

function providerCallFromSource(source, root) {
  const value = source.value;
  if (value.campaignId !== path.basename(root)) throw new Error("Provider call source campaign does not match its root.");
  return {
    sourcePath: source.reference.path,
    sourceSha256: source.reference.sha256,
    callOrdinal: value.continuity?.callOrdinal,
    phase: value.continuity?.phase,
    projectId: value.context?.projectId,
    taskId: value.context?.taskId,
    teacherMessageId: value.context?.teacherMessageId,
    turnJobId: value.context?.turnJobId,
    outcome: value.result?.outcome,
    httpStatus: value.result?.httpStatus,
    timeout: value.result?.timeout,
    mode: value.provider?.mode,
    errorCategory: value.result?.errorCategory,
    channel: value.provider?.channel,
    modelFingerprint: value.provider?.modelFingerprint,
  };
}

function validateProviderCall(call, scenario, ordinalState) {
  if (!["intake", "initial", "tool", "post_tool"].includes(call.phase)) throw new Error("Provider call phase is invalid.");
  const ordinalKey = [call.projectId, call.teacherMessageId, call.turnJobId ?? "none"].join("\0");
  const expectedOrdinal = (ordinalState.get(ordinalKey) ?? 0) + 1;
  if (call.callOrdinal !== expectedOrdinal) throw new Error("Provider call ordinals must be consecutive within the product turn.");
  ordinalState.set(ordinalKey, expectedOrdinal);
  const expectedTaskId = call.phase === "intake" ? `conversation-turn:${scenario.teacherMessageId}` : scenario.taskId;
  if (call.projectId !== scenario.projectId || call.taskId !== expectedTaskId ||
      call.teacherMessageId !== scenario.teacherMessageId || call.turnJobId !== scenario.turnJobId) {
    throw new Error("Provider call identity does not match persisted scenario identity.");
  }
  if (call.outcome !== "succeeded") throw new Error("Provider call outcome is not successful.");
  if (!Number.isInteger(call.httpStatus) || call.httpStatus < 200 || call.httpStatus >= 400) {
    throw new Error("Provider call HTTP status is unsuccessful.");
  }
  if (call.timeout !== false) throw new Error("Provider call contains a timeout.");
  if (call.mode !== "real-provider") throw new Error("Provider call mode is not real-provider.");
  if (call.errorCategory !== "none") throw new Error("Provider call contains an error category.");
  if (!["primary", "third"].includes(call.channel)) throw new Error("Provider call channel is not an approved explicit channel.");
  if (!SHA256_PATTERN.test(call.modelFingerprint ?? "")) throw new Error("Provider call model fingerprint is invalid.");
}

function validateSignedIndexReference(value) {
  const reference = validateSourceReference(value, "signed source index");
  if (typeof value.keyId !== "string" || !IDENTIFIER_PATTERN.test(value.keyId) ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)) {
    throw new Error("Signed source index signature reference is invalid.");
  }
  return { ...reference, keyId: value.keyId, signature: value.signature };
}

function requireTrustedCaptureKey(keys, keyId, expectedPublicKeySha256) {
  if (!Array.isArray(keys)) throw new Error("Trusted capture keys are required.");
  const matches = keys.filter((entry) => entry?.keyId === keyId);
  if (matches.length !== 1) throw new Error("Signed source index capture key is not trusted.");
  const key = matches[0];
  if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.includes("BEGIN PUBLIC KEY") ||
      !SHA256_PATTERN.test(key.publicKeySha256 ?? "")) {
    throw new Error("Trusted capture public key contract is invalid.");
  }
  const actual = createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex");
  if (actual !== key.publicKeySha256.toLowerCase() || actual !== expectedPublicKeySha256) {
    throw new Error("Trusted capture public key SHA-256 is invalid.");
  }
  return key;
}

function requireStageTrust(repositoryRoot, campaignRoot, keyId) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new Error("Repository root is required for capture trust verification.");
  }
  const root = realpathSync(path.resolve(repositoryRoot));
  const expectedCampaignParent = path.join(root, ".tmp", "provider-continuity", "campaigns");
  const relativeCampaign = path.relative(expectedCampaignParent, campaignRoot);
  if (!relativeCampaign || relativeCampaign.includes(path.sep) || relativeCampaign.startsWith("..") || path.isAbsolute(relativeCampaign)) {
    throw new Error("Campaign root is not bound to the repository continuity workspace.");
  }
  const stagePath = resolveOrdinarySource(root, "docs/stages/active-stage.json");
  let stage;
  try {
    stage = JSON.parse(readFileSync(stagePath, "utf8"));
  } catch {
    throw new Error("Active stage trust contract is invalid.");
  }
  const continuity = stage?.providerContinuity;
  const authorization = continuity?.liveAuthorization;
  if (stage?.stageId !== "p0-05a-provider-continuity-readiness" || stage?.status !== "active" ||
      continuity?.requiredReceiptSchema !== "shanhai-provider-continuity-receipt.v2" ||
      !Array.isArray(continuity?.trustedCaptureKeyIds) || !continuity.trustedCaptureKeyIds.includes(keyId) ||
      authorization?.trustedCaptureKeyId !== keyId ||
      !SHA256_PATTERN.test(authorization?.trustedCapturePublicKeySha256 ?? "")) {
    throw new Error("Active stage does not trust the signed capture source index.");
  }
  return { publicKeySha256: authorization.trustedCapturePublicKeySha256.toLowerCase() };
}

function verifyIndexSignature(bytes, signature, publicKeyPem) {
  let decoded;
  try {
    decoded = Buffer.from(signature, "base64");
  } catch {
    throw new Error("Signed source index signature is invalid.");
  }
  if (decoded.length === 0 || !verifySignature(null, bytes, publicKeyPem, decoded)) {
    throw new Error("Signed source index signature verification failed.");
  }
}

function readBoundSource(root, entry, index) {
  const reference = validateSourceFact(entry, index);
  const target = resolveOrdinarySource(root, reference.path);
  const bytes = readFileSync(target);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== reference.sha256) throw new Error(`Source fact ${index} SHA-256 does not match its file.`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Source fact ${index} is not valid JSON.`);
  }
  return { reference, bytes, value };
}

function validateSourceFact(entry, index) {
  try {
    if (typeof entry?.kind !== "string" || !IDENTIFIER_PATTERN.test(entry.kind)) throw new Error("kind invalid");
    return { ...validateSourceReference(entry, `source fact ${index}`), kind: entry.kind };
  } catch {
    throw new Error(`Source fact ${index} is invalid.`);
  }
}

function validateSourceReference(entry, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof entry.path !== "string" || !isSafeRelativePath(entry.path) ||
      !SHA256_PATTERN.test(entry.sha256 ?? "")) {
    throw new Error(`${label} is invalid.`);
  }
  return { path: entry.path.replaceAll("\\", "/"), sha256: entry.sha256.toLowerCase() };
}

function normalizeUniquePaths(value, label) {
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || !isSafeRelativePath(entry)) throw new Error(`${label} path ${index} is invalid.`);
    return entry.replaceAll("\\", "/");
  }).sort();
  if (new Set(result).size !== result.length) throw new Error(`${label} paths are duplicated.`);
  return result;
}

function listCapturePaths(root) {
  const capture = resolveOrdinaryDirectory(root, "capture");
  return readdirSync(capture, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Campaign capture contains a non-file entry.");
    return `capture/${entry.name}`;
  }).sort();
}

function requireCampaignRoot(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("Campaign root is required.");
  const root = realpathSync(path.resolve(value));
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Campaign root must be an ordinary directory.");
  return root;
}

function resolveOrdinaryDirectory(root, relativePath) {
  const target = resolveOrdinarySourcePath(root, relativePath);
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Campaign source directory is invalid.");
  return realpathSync(target);
}

function resolveOrdinarySource(root, relativePath) {
  const target = resolveOrdinarySourcePath(root, relativePath);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Source fact must be an ordinary file.");
  return realpathSync(target);
}

function resolveOrdinarySourcePath(root, relativePath) {
  const target = path.resolve(root, ...relativePath.replaceAll("\\", "/").split("/"));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source fact escapes the campaign root.");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Source fact must not traverse a link.");
  }
  const physical = realpathSync(target);
  const physicalRelative = path.relative(root, physical);
  if (physicalRelative.startsWith("..") || path.isAbsolute(physicalRelative)) {
    throw new Error("Source fact escapes the physical campaign root.");
  }
  return physical;
}

function structuredArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`Scenario ${label} must be an array of structured facts.`);
  }
  return value.map((entry) => ({ ...entry }));
}

function isSafeRelativePath(value) {
  const portable = value.replaceAll("\\", "/");
  return portable.length > 0 && !portable.startsWith("/") && !/^[A-Za-z]:\//.test(portable) &&
    portable.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function sameArray(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
