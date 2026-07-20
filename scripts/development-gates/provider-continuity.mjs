import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { verifyProviderContinuityReceiptV2 } from "./provider-continuity/receipt-v2.mjs";
import { loadTrustedCaptureKeys } from "./provider-continuity/trust-store.mjs";
import { collectGitVerificationSubject } from "./verification-subject.mjs";

const DEFAULT_CONFIG_PATH = "config/development-gates.json";
const ACTIVE_STAGE_PATH = "docs/stages/active-stage.json";
const BOOTSTRAP_STAGE_ID = "project-development-gates";
const BOOTSTRAP_BASELINE = "63b9bd3866195b8062756f2b7016faf44e22208f";
const BOOTSTRAP_PLAN = "docs/stages/project-development-gates-plan.md";
const BOOTSTRAP_TEST_PLAN = "docs/stages/project-development-gates-test-plan.md";
const BOOTSTRAP_ALLOWED_PATHS = [
  ".gitattributes",
  "AGENTS.md",
  "README.md",
  "config/development-gates.json",
  "config/provider-capture-trust.json",
  "fixtures/ppt-sample-manifest.json",
  "scripts/run-tests.mjs",
  "scripts/development-gates/**",
  "tests/development-gates/**",
  "tests/capability-availability.test.ts",
  "tests/health-route.test.ts",
  "tests/health-readiness.test.ts",
  "tests/package-tool-adapter.test.ts",
  "tests/ppt-key-sample-renderer.test.ts",
  "tests/fixtures/provider-ledger/manifest.json",
  "tests/video-narration-provider.test.ts",
  "src/server/video-quality/video-timeline-assembler.ts",
  "src/server/ppt-quality/ppt-key-sample-renderer.ts",
  "docs/**",
  "package.json",
  ".github/**",
];
const CAPTURE_BOOTSTRAP_PRODUCTION_PATHS = [
  "src/server/conversation/conversation-turn-service.ts",
  "src/server/conversation/main-conversation-agent.ts",
  "src/server/conversation/model-main-conversation-agent.ts",
  "src/server/gpt-protocol/openai-responses-adapter.ts",
  "src/server/gpt-protocol/types.ts",
  "src/server/provider-ledger/provider-call-trace.ts",
];
const CAPTURE_BOOTSTRAP_TEST_PATHS = [
  "tests/conversation-turn-service.test.ts",
  "tests/gpt-protocol-adapter.test.ts",
  "tests/model-main-conversation-agent.test.ts",
  "tests/provider-call-trace.test.ts",
];
const CAPTURE_BOOTSTRAP_ALLOWED_PATHS = [
  ...BOOTSTRAP_ALLOWED_PATHS,
  ...CAPTURE_BOOTSTRAP_PRODUCTION_PATHS,
  ...CAPTURE_BOOTSTRAP_TEST_PATHS,
];
const OFFLINE_REFACTOR_STAGE_ID = "product-first-deep-refactor";
const OFFLINE_REFACTOR_BASELINE = "20c6e2530b991db77108c7b7a61090e9060b7fca";
const OFFLINE_REFACTOR_PLAN = "docs/stages/product-first-deep-refactor-plan.md";
const OFFLINE_REFACTOR_TEST_PLAN = "docs/stages/product-first-deep-refactor-test-plan.md";
const OFFLINE_REFACTOR_EXPIRES_ON = "2026-08-16";
const OFFLINE_REFACTOR_ALLOWED_IMPLEMENTATION_PATHS = [
  "config/development-gates.json",
  "docs/stages/active-stage.json",
  "scripts/development-gates/provider-continuity.mjs",
  "scripts/development-gates/run-development-gates.mjs",
  "scripts/run-v1-9-e2e.mjs",
  "src/server/conversation/**",
  "src/server/agent-runtime/**",
  "src/server/tools/**",
  "src/server/workbench/*.ts",
  "src/server/provider-ledger/provider-ledger-adapter.ts",
  "src/server/provider-ledger/provider-ledger-contract.mjs",
  "src/app/api/**/route.ts",
  "src/lib/conversation-message-contract.ts",
  "src/lib/conversation-message-*.ts",
  "src/lib/teacher-agent-event*.ts",
  "prisma/schema.prisma",
];
const OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS = [
  {
    path: "src/server/provider-ledger/provider-ledger-adapter.ts",
    sha256: "19b51b48a91da8964d34505e99ff739ab857f79554d879d1004d52e6857e8a4e",
  },
  {
    path: "src/server/provider-ledger/provider-ledger-contract.mjs",
    sha256: "e7ad5590c28ac4eb21e8a9d5ec9979dbbd953988d32965b3a076e04a0494907d",
  },
];
const PRODUCTION_PROVIDER_PATHS = [
  "src/server/conversation/**",
  "src/server/agent-runtime/**",
  "src/server/gpt-protocol/**",
  "src/server/tools/**",
  "src/server/workbench/*.ts",
  "src/server/provider-ledger/**",
  "src/app/api/**/route.ts",
  "src/lib/conversation-message-contract.ts",
  "src/lib/conversation-message-*.ts",
  "src/lib/teacher-agent-event*.ts",
  "prisma/schema.prisma",
  "scripts/production-preflight.mjs",
  "scripts/close-v1-9-run.ts",
  "scripts/run-v1-9-e2e.mjs",
  "scripts/lib/v1-9-e2e-contract*",
  "scripts/lib/v1-9-orchestration-authority*",
];
const SHA1_PATTERN = /^[a-f0-9]{40}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

class ProviderContinuityError extends Error {
  constructor(message, code = "PROVIDER_CONTINUITY_INVALID") {
    super(message);
    this.name = "ProviderContinuityError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProviderContinuityError(message, code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    fail(`${label} must be a non-empty repository-relative path.`);
  }
  const portable = value.trim().replaceAll("\\", "/");
  if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(value)) {
    fail(`Unsafe ${label}: absolute paths are forbidden (${value}).`);
  }
  const normalized = path.posix.normalize(portable);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    fail(`Unsafe ${label}: path traversal is forbidden (${value}).`);
  }
  return normalized.replace(/^\.\//, "");
}

function resolveWithin(root, relativePath, label) {
  const normalized = normalizeRelativePath(relativePath, label);
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, ...normalized.split("/"));
  const comparisonRoot = `${absoluteRoot.toLowerCase()}${path.sep}`;
  if (!`${absolutePath.toLowerCase()}${path.sep}`.startsWith(comparisonRoot)) {
    fail(`Unsafe ${label}: resolved path escapes its root (${relativePath}).`);
  }
  return { absolutePath, normalized };
}

function assertNoSymlink(root, absolutePath, label) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absolutePath);
  const relative = path.relative(absoluteRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`Unsafe ${label}: resolved path escapes its root.`);
  }
  let current = absoluteRoot;
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
    fail(`${label} root must not be a symbolic link.`);
  }
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      fail(`${label} must not traverse a symbolic link (${relative}).`);
    }
  }
}

function readJsonFile(root, relativePath, label) {
  const { absolutePath } = resolveWithin(root, relativePath, `${label} path`);
  if (!existsSync(absolutePath)) fail(`${label} is missing: ${relativePath}.`);
  assertNoSymlink(root, absolutePath, label);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) fail(`${label} must be a regular file: ${relativePath}.`);
  const bytes = readFileSync(absolutePath);
  try {
    return { absolutePath, bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail(`${label} is not valid JSON: ${relativePath}.`);
  }
}

function globToRegExp(pattern) {
  const source = pattern.replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*" && source[index + 1] === "*") {
      if (source[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "i");
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function loadPolicy(root, configPath = DEFAULT_CONFIG_PATH) {
  const config = readJsonFile(root, configPath, "Development gate config").value;
  const policy = config?.providerContinuity ?? config?.policy?.providerContinuity;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("Development gate config is missing providerContinuity policy.");
  }
  const positiveIntegerFields = [
    "developmentConsecutiveRuns",
    "releaseConsecutiveRuns",
    "maxAgeHours",
  ];
  for (const field of positiveIntegerFields) {
    if (!Number.isInteger(policy[field]) || policy[field] <= 0) {
      fail(`providerContinuity.${field} must be a positive integer.`);
    }
  }
  if (
    !Array.isArray(policy.sensitivePaths) ||
    policy.sensitivePaths.length === 0 ||
    !Array.isArray(policy.forbiddenModes) ||
    policy.forbiddenModes.length === 0 ||
    !Array.isArray(policy.requiredScenarios) ||
    policy.requiredScenarios.length !== 4
  ) {
    fail("Provider continuity policy must define sensitive paths, forbidden modes, and exactly four scenarios.");
  }
  for (const field of ["manifestPath", "receiptPath", "evidenceRoot", "trustStorePath"]) {
    normalizeRelativePath(policy[field], `providerContinuity.${field}`);
  }
  const scenarioIds = policy.requiredScenarios.map((scenario) => scenario?.id);
  if (scenarioIds.some((id) => typeof id !== "string" || id === "")) {
    fail("Each required Provider scenario must have an id.");
  }
  if (new Set(scenarioIds.map((id) => id.toLowerCase())).size !== scenarioIds.length) {
    fail("Provider scenario ids must be unique.");
  }
  return policy;
}

function runGit(root, args, description) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail(`Unable to ${description}; Provider evidence cannot be bound to the candidate.`);
  }
}

function collectChangedPaths(root) {
  const explicitBase = process.env.DEVELOPMENT_GATE_BASE_SHA?.trim();
  if (explicitBase && !SHA1_PATTERN.test(explicitBase)) {
    fail("DEVELOPMENT_GATE_BASE_SHA must be a Git SHA.");
  }
  let activeStageBase = null;
  try {
    const stage = readJsonFile(root, ACTIVE_STAGE_PATH, "Active stage declaration").value;
    if (SHA1_PATTERN.test(stage?.baselineSha ?? "")) activeStageBase = stage.baselineSha;
  } catch {
    activeStageBase = null;
  }
  const comparisonBase = explicitBase || activeStageBase;
  const commands = comparisonBase
    ? [
        ["diff", "--name-only", comparisonBase, "--"],
        ["ls-files", "--others", "--exclude-standard"],
      ]
    : [
        ["diff", "--name-only", "--cached"],
        ["diff", "--name-only"],
        ["ls-files", "--others", "--exclude-standard"],
      ];
  const paths = new Set();
  for (const args of commands) {
    const output = runGit(root, args, "collect changed paths");
    for (const line of output.split(/\r?\n/u).filter(Boolean)) {
      paths.add(normalizeRelativePath(line, "changed path"));
    }
  }
  return [...paths].sort();
}

function parseExpiry(value) {
  if (typeof value !== "string") return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(value);
  const parsed = new Date(dateOnly ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inspectBootstrap(root, changedPaths, productionMatched, now) {
  if (changedPaths.length === 0) {
    return { eligible: false };
  }
  let stage;
  try {
    stage = readJsonFile(root, ACTIVE_STAGE_PATH, "Active stage declaration").value;
  } catch {
    return { eligible: false };
  }
  const expiresAt = parseExpiry(stage?.providerContinuity?.expiresOn);
  const exactStage =
    stage?.schemaVersion === "shanhai-active-stage.v1" &&
    stage?.stageId === BOOTSTRAP_STAGE_ID &&
    stage?.status === "active" &&
    stage?.baselineSha === BOOTSTRAP_BASELINE &&
    stage?.plan === BOOTSTRAP_PLAN &&
    stage?.testPlan === BOOTSTRAP_TEST_PLAN;
  const exactPolicyBootstrap =
    exactStage &&
    productionMatched.length === 0 &&
    changedPaths.every((entry) => matchesAny(entry, BOOTSTRAP_ALLOWED_PATHS)) &&
    stage?.providerContinuity?.requirement === "bootstrap-policy-only" &&
    typeof stage?.providerContinuity?.reason === "string" &&
    stage.providerContinuity.reason.trim().length > 0 &&
    expiresAt !== null &&
    now.getTime() <= expiresAt.getTime();
  const exactCaptureBootstrap =
    exactStage &&
    changedPaths.every((entry) => matchesAny(entry, CAPTURE_BOOTSTRAP_ALLOWED_PATHS)) &&
    productionMatched.every((entry) => CAPTURE_BOOTSTRAP_PRODUCTION_PATHS.includes(entry)) &&
    stage?.providerContinuity?.requirement === "provider-evidence-capture-bootstrap" &&
    stage?.providerContinuity?.mode === "development-only" &&
    typeof stage?.providerContinuity?.reason === "string" &&
    stage.providerContinuity.reason.trim().length > 0 &&
    isDeepStrictEqual(
      stage?.providerContinuity?.allowedProductionPaths,
      CAPTURE_BOOTSTRAP_PRODUCTION_PATHS,
    ) &&
    stage?.providerContinuity?.expiresOn === "2026-07-18" &&
    expiresAt !== null &&
    now.getTime() <= expiresAt.getTime();
  return {
    eligible: exactPolicyBootstrap,
    captureEligible: exactCaptureBootstrap,
    expiresAt: expiresAt?.toISOString(),
  };
}

function inspectOfflineRefactor(root, matchedPaths, productionMatched, now) {
  if (matchedPaths.length === 0) return { eligible: false };
  let stage;
  try {
    stage = readJsonFile(root, ACTIVE_STAGE_PATH, "Active stage declaration").value;
  } catch {
    return { eligible: false };
  }
  const continuity = stage?.providerContinuity;
  const expiresAt = parseExpiry(continuity?.expiresOn);
  const pinnedImplementations = continuity?.pinnedImplementationSha256;
  const exactPinnedImplementations = Array.isArray(pinnedImplementations) &&
    pinnedImplementations.length === OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS.length &&
    pinnedImplementations.every((entry, index) => {
      const expected = OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS[index];
      return entry?.path === expected.path && entry?.sha256 === expected.sha256;
    });
  const pinnedImplementationsMatch = exactPinnedImplementations && OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS.every((entry) => {
    const absolute = path.join(root, ...entry.path.split("/"));
    return existsSync(absolute) && !lstatSync(absolute).isSymbolicLink() && lstatSync(absolute).isFile() &&
      sha256(readFileSync(absolute)) === entry.sha256;
  });
  const exactStage = stage?.schemaVersion === "shanhai-active-stage.v1" &&
    stage?.stageId === OFFLINE_REFACTOR_STAGE_ID && stage?.status === "active" &&
    stage?.baselineSha === OFFLINE_REFACTOR_BASELINE && stage?.plan === OFFLINE_REFACTOR_PLAN &&
    stage?.testPlan === OFFLINE_REFACTOR_TEST_PLAN;
  const exactContract = continuity?.requirement === "offline-product-refactor" &&
    continuity?.mode === "development-only" && continuity?.liveCallsAuthorized === false &&
    continuity?.liveCampaign === "blocked-outside-current-stage" &&
    continuity?.liveAuthorization === null &&
    continuity?.requiredReceiptSchema === "shanhai-provider-continuity-receipt.v2" &&
    Array.isArray(continuity?.trustedCaptureKeyIds) && continuity.trustedCaptureKeyIds.length === 0 &&
    Array.isArray(continuity?.trustedLedgerAuthorityKeyIds) && continuity.trustedLedgerAuthorityKeyIds.length === 0 &&
    continuity?.expiresOn === OFFLINE_REFACTOR_EXPIRES_ON &&
    isDeepStrictEqual(continuity?.allowedImplementationPaths, OFFLINE_REFACTOR_ALLOWED_IMPLEMENTATION_PATHS) &&
    pinnedImplementationsMatch;
  const allowedSensitivePaths = matchedPaths.every((entry) =>
    matchesAny(entry, OFFLINE_REFACTOR_ALLOWED_IMPLEMENTATION_PATHS));
  const allowedProductionPaths = productionMatched.every((entry) =>
    matchesAny(entry, OFFLINE_REFACTOR_ALLOWED_IMPLEMENTATION_PATHS));
  return {
    eligible: exactStage && exactContract && allowedSensitivePaths && allowedProductionPaths &&
      expiresAt !== null && now.getTime() <= expiresAt.getTime(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export function detectProviderImpact(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) fail("Provider impact check received an invalid current time.");
  const policy = loadPolicy(root, options.configPath);
  const changedPaths = (options.changedPaths ?? collectChangedPaths(root)).map((entry) =>
    normalizeRelativePath(entry, "changed path"),
  );
  const uniquePaths = [...new Set(changedPaths.map((entry) => entry.toLowerCase()))];
  if (uniquePaths.length !== changedPaths.length) {
    fail("Changed path list contains case-insensitive duplicates.");
  }
  const matchedPaths = changedPaths
    .filter((entry) => matchesAny(entry, policy.sensitivePaths))
    .sort();
  // The bootstrap exception cannot be widened by editing the policy it is bootstrapping.
  const productionMatched = changedPaths
    .filter((entry) => matchesAny(entry, PRODUCTION_PROVIDER_PATHS))
    .sort();
  const bootstrap = inspectBootstrap(root, changedPaths, productionMatched, now);
  const offlineRefactor = inspectOfflineRefactor(root, matchedPaths, productionMatched, now);
  return {
    impacted: matchedPaths.length > 0,
    changedPaths: [...changedPaths].sort(),
    matchedPaths,
    productionProviderPaths: productionMatched,
    bootstrapPolicyOnly: bootstrap.eligible,
    captureBootstrapOnly: bootstrap.captureEligible,
    captureProductionPaths: bootstrap.captureEligible ? productionMatched : [],
    bootstrapExpiresAt: bootstrap.expiresAt ?? null,
    offlineRefactorOnly: offlineRefactor.eligible,
    offlineRefactorExpiresAt: offlineRefactor.expiresAt,
  };
}

function assertSchema(value, schemaVersion, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  if (value.schemaVersion !== schemaVersion) {
    fail(`${label} must use schemaVersion ${schemaVersion}.`);
  }
}

function assertNoManifestSelfReference(value) {
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (key.toLowerCase() === "manifestsha256") {
        fail("Provider manifest contains a forbidden self-reference.");
      }
      visit(child);
    }
  };
  visit(value);
}

function validateSubject(subject, label) {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    fail(`${label} subject must be an object.`);
  }
  if (!SHA1_PATTERN.test(subject.commit ?? "")) fail(`${label} subject commit is invalid.`);
  if (!SHA1_PATTERN.test(subject.tree ?? "")) fail(`${label} subject tree is invalid.`);
  if (!SHA256_PATTERN.test(subject.bundleSha256 ?? "")) {
    fail(`${label} subject bundleSha256 is invalid.`);
  }
}

function listCandidateFiles(root) {
  const output = runGit(
    root,
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    "enumerate candidate files",
  );
  return [...new Set(output.split(/\r?\n/u).filter(Boolean).map((entry) =>
    normalizeRelativePath(entry, "candidate path"),
  ))].sort();
}

function computeBundleSha256(root, policy) {
  const files = listCandidateFiles(root).filter((entry) => matchesAny(entry, policy.sensitivePaths));
  if (files.length === 0) fail("Provider-sensitive candidate bundle is empty.");
  const digest = createHash("sha256");
  for (const relativePath of files) {
    const { absolutePath } = resolveWithin(root, relativePath, "candidate path");
    if (!existsSync(absolutePath)) fail(`Candidate file is missing: ${relativePath}.`);
    assertNoSymlink(root, absolutePath, "Candidate file");
    if (!lstatSync(absolutePath).isFile()) fail(`Candidate path is not a file: ${relativePath}.`);
    digest.update(relativePath);
    digest.update("\0");
    digest.update(sha256(readFileSync(absolutePath)));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function verifyCandidateSubject(root, policy, subject) {
  const actual = {
    commit: runGit(root, ["rev-parse", "HEAD"], "read candidate commit"),
    tree: runGit(root, ["rev-parse", "HEAD^{tree}"], "read candidate tree"),
    bundleSha256: computeBundleSha256(root, policy),
  };
  if (!isDeepStrictEqual(subject, actual)) {
    fail("Provider evidence subject does not match the current candidate commit, tree, and bundle.");
  }
  return actual;
}

function parseTimestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function hasTruthyValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "0";
  return Boolean(value);
}

function assertNoRetryMasking(value, trail = "receipt") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/retr(?:y|ies)/iu.test(key) && hasTruthyValue(child)) {
      fail(`Provider evidence contains retry metadata that can mask a failure (${trail}.${key}).`);
    }
    assertNoRetryMasking(child, `${trail}.${key}`);
  }
}

function assertNoForbiddenMode(value, forbiddenModes, trail = "receipt") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    for (const mode of forbiddenModes) {
      const token = String(mode).toLowerCase();
      if (keyLower.includes(token) && hasTruthyValue(child)) {
        fail(`Provider evidence declares forbidden provider mode ${mode} (${trail}.${key}).`);
      }
      if (
        typeof child === "string" &&
        child.toLowerCase().split(/[^a-z0-9]+/u).includes(token)
      ) {
        fail(`Provider evidence contains forbidden provider mode ${mode} (${trail}.${key}).`);
      }
    }
    assertNoForbiddenMode(child, forbiddenModes, `${trail}.${key}`);
  }
}

function listEvidenceFiles(evidenceRoot) {
  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        fail(`Evidence directory contains a symbolic link: ${relativePath}.`);
      }
      if (stat.isDirectory()) visit(absolutePath, relativePath);
      else if (stat.isFile()) files.push(relativePath.replaceAll("\\", "/"));
      else fail(`Evidence directory contains a non-regular entry: ${relativePath}.`);
    }
  };
  visit(evidenceRoot);
  return files.sort();
}

function validateEvidenceFiles(root, policy, manifest, receipt) {
  if (!Array.isArray(manifest.evidenceFiles) || !Array.isArray(receipt.evidenceFiles)) {
    fail("Manifest and receipt must both declare evidenceFiles.");
  }
  const receiptEntries = receipt.evidenceFiles.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`Receipt evidenceFiles[${index}] must be an object.`);
    }
    const relativePath = normalizeRelativePath(entry.path, "evidence path");
    if (!SHA256_PATTERN.test(entry.sha256 ?? "")) {
      fail(`Evidence file ${relativePath} has an invalid sha256.`);
    }
    if (typeof entry.runId !== "string" || entry.runId.trim() === "") {
      fail(`Evidence file ${relativePath} must declare runId.`);
    }
    return { ...entry, path: relativePath };
  });
  const receiptKeys = receiptEntries.map((entry) => entry.path.toLowerCase());
  if (new Set(receiptKeys).size !== receiptKeys.length) fail("Duplicate evidence path in receipt.");

  const manifestPaths = manifest.evidenceFiles.map((entry) =>
    normalizeRelativePath(entry, "manifest evidence path"),
  );
  const manifestKeys = manifestPaths.map((entry) => entry.toLowerCase());
  if (new Set(manifestKeys).size !== manifestKeys.length) fail("Duplicate evidence path in manifest.");
  if (!isDeepStrictEqual([...manifestKeys].sort(), [...receiptKeys].sort())) {
    fail("Manifest and receipt evidence file lists differ.");
  }

  const { absolutePath: evidenceRoot } = resolveWithin(root, policy.evidenceRoot, "evidence root");
  if (!existsSync(evidenceRoot)) fail(`Provider evidence root is missing: ${policy.evidenceRoot}.`);
  assertNoSymlink(root, evidenceRoot, "Provider evidence root");
  if (!lstatSync(evidenceRoot).isDirectory()) fail("Provider evidence root must be a directory.");

  const actualPaths = listEvidenceFiles(evidenceRoot);
  const actualKeys = actualPaths.map((entry) => entry.toLowerCase());
  const extras = actualPaths.filter((_, index) => !receiptKeys.includes(actualKeys[index]));
  if (extras.length > 0) fail(`Unlisted evidence file found: ${extras[0]}.`);
  const missing = receiptEntries.filter((entry) => !actualKeys.includes(entry.path.toLowerCase()));
  if (missing.length > 0) fail(`Declared evidence file is missing: ${missing[0].path}.`);

  const documents = new Map();
  for (const entry of receiptEntries) {
    const { absolutePath } = resolveWithin(evidenceRoot, entry.path, "evidence path");
    assertNoSymlink(evidenceRoot, absolutePath, "Evidence file");
    const bytes = readFileSync(absolutePath);
    if (sha256(bytes) !== entry.sha256.toLowerCase()) {
      fail(`Evidence SHA256 mismatch: ${entry.path}.`);
    }
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`Evidence file is not valid JSON: ${entry.path}.`);
    }
    assertSchema(document, "shanhai-provider-run-evidence.v1", `Evidence file ${entry.path}`);
    documents.set(entry.path.toLowerCase(), { entry, document });
  }
  return documents;
}

function validateScenario(scenario, definition, runId) {
  const label = `Run ${runId} scenario ${definition.id}`;
  if (!Array.isArray(scenario.httpStatuses) || scenario.httpStatuses.length === 0) {
    fail(`${label} must retain all raw HTTP statuses.`);
  }
  for (const status of scenario.httpStatuses) {
    if (!Number.isInteger(status) || status < 200 || status >= 400) {
      fail(`${label} contains unsuccessful HTTP status ${status}.`);
    }
  }
  if (!Array.isArray(scenario.timeOuts) || scenario.timeOuts.length === 0) {
    fail(`${label} must retain raw timeout outcomes.`);
  }
  if (scenario.timeOuts.some((entry) => entry !== false && entry !== 0)) {
    fail(`${label} contains a timeout that cannot be masked by a later result.`);
  }
  if (
    !Array.isArray(scenario.modes) ||
    scenario.modes.length === 0 ||
    scenario.modes.some((entry) => entry !== "real-provider")
  ) {
    fail(`${label} must prove real-provider mode for every Provider interaction.`);
  }
  if (scenario.result !== "passed") fail(`${label} result is not passed.`);
  if (!Array.isArray(scenario.observations) || scenario.observations.length === 0) {
    fail(`${label} must include real observations.`);
  }

  const toolNames = Array.isArray(scenario.toolInvocations)
    ? scenario.toolInvocations.map((entry) => entry?.name)
    : [];
  if (toolNames.some((name) => typeof name !== "string" || name === "")) {
    fail(`${label} has an invalid Tool invocation.`);
  }
  if (
    new Set(toolNames).size !== toolNames.length ||
    !isDeepStrictEqual([...toolNames].sort(), [...definition.allowedTools].sort())
  ) {
    fail(`${label} violates the Tool contract.`);
  }

  if (!Array.isArray(scenario.artifacts) || scenario.artifacts.length !== definition.requiredArtifacts) {
    fail(`${label} violates the Artifact contract.`);
  }
  const artifactIds = scenario.artifacts.map((entry) => entry?.artifactId);
  if (
    artifactIds.some((id) => typeof id !== "string" || id === "") ||
    new Set(artifactIds).size !== artifactIds.length
  ) {
    fail(`${label} Artifact identities must be present and unique.`);
  }

  const before = scenario.intentEpochBefore;
  const after = scenario.intentEpochAfter;
  const epochMatches =
    definition.intentEpoch === "advanced-once"
      ? Number.isInteger(before) && Number.isInteger(after) && after === before + 1
      : Number.isInteger(before) && Number.isInteger(after) && after === before;
  if (!epochMatches) fail(`${label} violates the IntentEpoch contract.`);
}

function validateRuns(
  receipt,
  manifest,
  documents,
  policy,
  requiredRuns,
  manifestTime,
  oldestAllowed,
) {
  if (!Array.isArray(receipt.runs) || receipt.runs.length < requiredRuns) {
    fail(`Provider receipt requires at least ${requiredRuns} consecutive runs.`);
  }
  const ids = new Set();
  const usedEvidence = new Set();
  let previousSequence = null;
  let previousCompleted = null;
  for (const run of receipt.runs) {
    if (!run || typeof run !== "object" || typeof run.id !== "string" || run.id === "") {
      fail("Each Provider continuity run must have an id.");
    }
    if (ids.has(run.id.toLowerCase())) fail(`Duplicate Provider run id: ${run.id}.`);
    ids.add(run.id.toLowerCase());
    if (!Number.isInteger(run.sequence) || run.sequence <= 0) {
      fail(`Run ${run.id} must have a positive sequence number.`);
    }
    if (previousSequence !== null && run.sequence !== previousSequence + 1) {
      fail(`Provider runs are not consecutive at ${run.id}.`);
    }
    previousSequence = run.sequence;
    const startedAt = parseTimestamp(run.startedAt, `Run ${run.id} startedAt`);
    const completedAt = parseTimestamp(run.completedAt, `Run ${run.id} completedAt`);
    if (completedAt < startedAt) fail(`Run ${run.id} completed before it started.`);
    if (previousCompleted && startedAt < previousCompleted) {
      fail(`Provider runs overlap or are out of order at ${run.id}.`);
    }
    if (completedAt > manifestTime) fail(`Run ${run.id} completed after the manifest was generated.`);
    if (completedAt < oldestAllowed) {
      fail(`Run ${run.id} has expired and cannot be repackaged in a newer receipt.`);
    }
    previousCompleted = completedAt;

    const evidenceFile = normalizeRelativePath(run.evidenceFile, "run evidence path");
    const evidence = documents.get(evidenceFile.toLowerCase());
    if (!evidence || evidence.entry.runId !== run.id) {
      fail(`Run ${run.id} is not bound to exactly one declared evidence file.`);
    }
    if (usedEvidence.has(evidenceFile.toLowerCase())) {
      fail(`Evidence file is reused by multiple runs: ${evidenceFile}.`);
    }
    usedEvidence.add(evidenceFile.toLowerCase());
    if (
      evidence.document.runId !== run.id ||
      evidence.document.capturedAt !== run.completedAt ||
      !isDeepStrictEqual(evidence.document.subject, receipt.subject) ||
      !isDeepStrictEqual(evidence.document.scenarios, run.scenarios)
    ) {
      fail(`Run ${run.id} does not match its SHA-bound evidence document.`);
    }

    if (!Array.isArray(run.scenarios) || run.scenarios.length !== policy.requiredScenarios.length) {
      fail(`Run ${run.id} does not contain all required scenarios.`);
    }
    const scenarioMap = new Map();
    for (const scenario of run.scenarios) {
      if (!scenario || typeof scenario.id !== "string" || scenarioMap.has(scenario.id)) {
        fail(`Run ${run.id} contains duplicate or invalid scenario ids.`);
      }
      scenarioMap.set(scenario.id, scenario);
    }
    for (const definition of policy.requiredScenarios) {
      const scenario = scenarioMap.get(definition.id);
      if (!scenario) fail(`Run ${run.id} does not contain all required scenarios.`);
      validateScenario(scenario, definition, run.id);
    }
    if (scenarioMap.size !== policy.requiredScenarios.length) {
      fail(`Run ${run.id} contains an undeclared scenario.`);
    }
  }
  if (usedEvidence.size !== documents.size) {
    fail("Receipt contains evidence files that are not bound to a continuity run.");
  }
  return receipt.runs.length;
}

export function verifyProviderContinuityEvidence(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const mode = options.mode ?? "development";
  if (!["development", "release"].includes(mode)) {
    fail(`Unsupported Provider gate mode: ${mode}.`);
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) fail("Provider verification received an invalid current time.");
  const policy = loadPolicy(root, options.configPath);
  const impact = detectProviderImpact({
    root,
    configPath: options.configPath,
    changedPaths: options.changedPaths,
    now,
  });

  const receiptLocation = resolveWithin(root, policy.receiptPath, "receipt path").absolutePath;
  if (!existsSync(receiptLocation)) {
    if (mode === "development" && impact.offlineRefactorOnly) {
      return {
        ok: false,
        passed: false,
        status: "deferred_provider_validation_during_offline_refactor",
        reason: "Provider validation remains open while the exact offline product refactor is completed without live calls.",
        matchedPaths: impact.matchedPaths,
        expiresAt: impact.offlineRefactorExpiresAt,
      };
    }
    if (mode === "development" && impact.captureBootstrapOnly) {
      return {
        ok: false,
        passed: false,
        status: "deferred_capture_bootstrap",
        reason: "Provider continuity remains open while the exact, expiring runtime evidence capture boundary is implemented.",
        matchedPaths: impact.matchedPaths,
        captureProductionPaths: impact.captureProductionPaths,
        expiresAt: impact.bootstrapExpiresAt,
      };
    }
    if (mode === "development" && impact.bootstrapPolicyOnly) {
      return {
        ok: false,
        passed: false,
        status: "deferred_bootstrap",
        reason: "Provider continuity evidence is deferred only for the exact unexpired policy bootstrap stage.",
        matchedPaths: impact.matchedPaths,
        expiresAt: impact.bootstrapExpiresAt,
      };
    }
    fail(`Provider continuity receipt is missing: ${policy.receiptPath}.`, "PROVIDER_RECEIPT_MISSING");
  }

  const manifestFile = readJsonFile(root, policy.manifestPath, "Provider continuity manifest");
  const receiptFile = readJsonFile(root, policy.receiptPath, "Provider continuity receipt");
  const manifest = manifestFile.value;
  const receipt = receiptFile.value;
  const activeReceiptContract = enforceActiveReceiptContract(root, manifest, receipt);
  if (activeReceiptContract) {
    if (mode !== "development") {
      fail("P0-05A v2 Provider receipts are development-only.", "PROVIDER_RECEIPT_MODE_UNSUPPORTED");
    }
    try {
      const trustedCaptureKeys = options.trustedCaptureKeys ?? loadTrustedCaptureKeys({
        repositoryRoot: root,
        relativePath: policy.trustStorePath,
      });
      const requiredRuns = policy.developmentConsecutiveRuns;
      const verified = verifyProviderContinuityReceiptV2({
        repositoryRoot: root,
        manifestBytes: manifestFile.bytes,
        receiptBytes: receiptFile.bytes,
        requiredRuns,
        trustedCaptureKeys,
        now,
        maxAgeHours: policy.maxAgeHours,
      });
      const currentSubject = collectGitVerificationSubject(root);
      if (!isDeepStrictEqual(verified.subject, currentSubject)) {
        fail("Provider v2 receipt subject does not match the current verification candidate.",
          "PROVIDER_RECEIPT_SUBJECT_MISMATCH");
      }
      return {
        ...verified,
        mode,
        verifiedAt: receipt.verifiedAt,
        manifestSha256: receipt.manifestSha256,
      };
    } catch (error) {
      if (error instanceof ProviderContinuityError) throw error;
      fail(`Provider continuity v2 verification failed: ${error instanceof Error ? error.message : "invalid evidence"}.`,
        "PROVIDER_RECEIPT_V2_INVALID");
    }
  }
  assertSchema(manifest, "shanhai-provider-continuity-manifest.v1", "Provider manifest");
  assertSchema(receipt, "shanhai-provider-continuity-receipt.v1", "Provider receipt");
  assertNoManifestSelfReference(manifest);
  if (!SHA256_PATTERN.test(receipt.manifestSha256 ?? "")) {
    fail("Provider receipt manifestSha256 is invalid.");
  }
  if (sha256(manifestFile.bytes) !== receipt.manifestSha256.toLowerCase()) {
    fail("Provider manifest SHA256 mismatch.");
  }
  if (manifest.mode !== mode || receipt.mode !== mode) {
    fail(`Provider evidence mode does not match requested ${mode} verification.`);
  }
  validateSubject(manifest.subject, "Manifest");
  validateSubject(receipt.subject, "Receipt");
  if (!isDeepStrictEqual(manifest.subject, receipt.subject)) {
    fail("Provider manifest and receipt subject mismatch.");
  }
  const subject = verifyCandidateSubject(root, policy, receipt.subject);

  const verifiedAt = parseTimestamp(receipt.verifiedAt, "Receipt verifiedAt");
  const ageMilliseconds = now.getTime() - verifiedAt.getTime();
  if (ageMilliseconds > policy.maxAgeHours * 60 * 60 * 1000) {
    fail(`Provider receipt has expired (maximum age ${policy.maxAgeHours} hours).`);
  }
  if (ageMilliseconds < -5 * 60 * 1000) fail("Provider receipt is dated in the future.");
  const manifestTime = parseTimestamp(manifest.generatedAt, "Manifest generatedAt");
  if (manifestTime > verifiedAt) fail("Provider manifest was generated after receipt verification.");
  const oldestAllowed = new Date(now.getTime() - policy.maxAgeHours * 60 * 60 * 1000);
  if (manifestTime < oldestAllowed) fail("Provider manifest has expired.");

  assertNoForbiddenMode(receipt, policy.forbiddenModes);
  assertNoRetryMasking(receipt);
  const documents = validateEvidenceFiles(root, policy, manifest, receipt);
  for (const { document } of documents.values()) {
    assertNoForbiddenMode(document, policy.forbiddenModes, "evidence");
    assertNoRetryMasking(document, "evidence");
  }
  const requiredRuns =
    mode === "release" ? policy.releaseConsecutiveRuns : policy.developmentConsecutiveRuns;
  const consecutiveRuns = validateRuns(
    receipt,
    manifest,
    documents,
    policy,
    requiredRuns,
    manifestTime,
    oldestAllowed,
  );
  return {
    ok: true,
    passed: true,
    status: "passed",
    mode,
    subject,
    consecutiveRuns,
    scenarioCount: policy.requiredScenarios.length,
    verifiedAt: receipt.verifiedAt,
    manifestSha256: receipt.manifestSha256,
  };
}

function enforceActiveReceiptContract(root, manifest, receipt) {
  let stage;
  try {
    stage = readJsonFile(root, ACTIVE_STAGE_PATH, "Active stage declaration").value;
  } catch {
    return;
  }
  if (stage?.status !== "active") return;
  const continuity = stage.providerContinuity;
  if (typeof continuity?.requiredReceiptSchema !== "string" || continuity.requiredReceiptSchema.length === 0) {
    fail("The active stage does not declare a signed Provider receipt schema.",
      "PROVIDER_RECEIPT_SCHEMA_UNDECLARED");
  }
  if (manifest?.schemaVersion !== "shanhai-provider-continuity-manifest.v2" ||
      receipt?.schemaVersion !== continuity?.requiredReceiptSchema) {
    fail("The active stage rejects legacy Provider receipts because they do not prove signed runtime provenance.",
      "PROVIDER_RECEIPT_SCHEMA_UNSUPPORTED");
  }
  if (!Array.isArray(continuity?.trustedCaptureKeyIds) || continuity.trustedCaptureKeyIds.length === 0 ||
      !Array.isArray(continuity?.trustedLedgerAuthorityKeyIds) || continuity.trustedLedgerAuthorityKeyIds.length === 0) {
    fail("The active stage has no trusted capture or ledger authority key configured; a Provider receipt cannot be promoted.",
      "PROVIDER_CAPTURE_TRUST_ROOT_MISSING");
  }
  if (continuity.liveCallsAuthorized !== true || !continuity.liveAuthorization) {
    fail("The active stage has no live authorization; a Provider receipt cannot be promoted.",
      "PROVIDER_LIVE_AUTHORIZATION_MISSING");
  }
  return continuity;
}

function parseCliArguments(argv) {
  const options = { changedPaths: [] };
  let command = "verify";
  let index = 0;
  if (argv[0] === "impact" || argv[0] === "verify") {
    command = argv[0];
    index = 1;
  }
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === "--mode") options.mode = argv[++index];
    else if (argument === "--root") options.root = argv[++index];
    else if (argument === "--config") options.configPath = argv[++index];
    else if (argument === "--changed") options.changedPaths.push(argv[++index]);
    else fail(`Unknown Provider continuity argument: ${argument}.`);
    index += 1;
  }
  if (options.changedPaths.length === 0) delete options.changedPaths;
  return { command, options };
}

function runCli() {
  try {
    const { command, options } = parseCliArguments(process.argv.slice(2));
    const result =
      command === "impact"
        ? detectProviderImpact(options)
        : verifyProviderContinuityEvidence(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const output = {
      ok: false,
      passed: false,
      status: "failed",
      code: error?.code ?? "PROVIDER_CONTINUITY_ERROR",
      message: error instanceof Error ? error.message : "Provider continuity verification failed.",
    };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) runCli();

export { ProviderContinuityError };
