import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const policySchemaVersion = "shanhai-development-gates.v1";
const captureBootstrapProductionPaths = [
  "src/server/conversation/conversation-turn-service.ts",
  "src/server/conversation/main-conversation-agent.ts",
  "src/server/conversation/model-main-conversation-agent.ts",
  "src/server/gpt-protocol/openai-responses-adapter.ts",
  "src/server/gpt-protocol/types.ts",
  "src/server/provider-ledger/provider-call-trace.ts",
];

export function assertPolicyRatchet(previous, current) {
  requirePolicySections(previous);
  requirePolicySections(current);

  assertNotGreater(previous.complexity.maxFileLines, current.complexity.maxFileLines, "maxFileLines");
  assertNotGreater(previous.complexity.maxFunctionLines, current.complexity.maxFunctionLines, "maxFunctionLines");
  assertNoAddedValues(previous.complexity.excludedPaths, current.complexity.excludedPaths, "complexity exclusions");
  assertNoAddedValues(previous.sourceStringContracts.excludedPaths, current.sourceStringContracts.excludedPaths, "source string exclusions");
  assertDebtRatchet(previous.complexity.baseline, current.complexity.baseline, "complexity debt", [
    "lines",
    "violatingFunctions",
    "maxFunctionLines",
    "totalFunctionLines",
  ]);
  assertDebtRatchet(previous.sourceStringContracts.baseline, current.sourceStringContracts.baseline, "source string debt", ["occurrences"]);
  assertNotGreater(previous.lint.maxWarnings, current.lint.maxWarnings, "lint maxWarnings");

  const beforeProvider = previous.providerContinuity;
  const afterProvider = current.providerContinuity;
  assertNotLess(beforeProvider.developmentConsecutiveRuns, afterProvider.developmentConsecutiveRuns, "development consecutive runs");
  assertNotLess(beforeProvider.releaseConsecutiveRuns, afterProvider.releaseConsecutiveRuns, "release consecutive runs");
  assertNotGreater(beforeProvider.maxAgeHours, afterProvider.maxAgeHours, "Provider maxAgeHours");
  assertNoRemovedValues(beforeProvider.sensitivePaths, afterProvider.sensitivePaths, "Provider sensitive paths");
  assertNoRemovedValues(beforeProvider.forbiddenModes, afterProvider.forbiddenModes, "Provider forbidden modes");
  assertNoRemovedValues(
    beforeProvider.requiredScenarios.map((entry) => entry.id),
    afterProvider.requiredScenarios.map((entry) => entry.id),
    "Provider required scenarios",
  );
  return { ok: true };
}

export function verifyBoundContracts(root, boundContracts) {
  const resolvedRoot = realpathSync(path.resolve(root));
  if (!Array.isArray(boundContracts) || boundContracts.length === 0) {
    throw new Error("At least one bound contract is required.");
  }
  const seen = new Set();
  for (const entry of boundContracts) {
    if (!entry || !isSafeRelativePath(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      throw new Error("Bound contract contains an unsafe path or hash.");
    }
    const normalized = normalizePath(entry.path);
    if (seen.has(normalized)) throw new Error("Bound contract paths must be unique.");
    seen.add(normalized);
    const absolute = containedPath(resolvedRoot, normalized);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      throw new Error("Bound contract file is missing.");
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Bound contract must be an ordinary file.");
    const actual = sha256(readFileSync(absolute));
    if (actual !== entry.sha256) throw new Error(`Bound contract hash mismatch: ${normalized}`);
  }
  return { ok: true, contractCount: seen.size };
}

export function verifyCurrentPolicy({ root = process.cwd(), policy, activeStage, previousPolicy } = {}) {
  if (!policy || policy.schemaVersion !== policySchemaVersion) throw new Error("Unsupported development gate policy schema.");
  requirePolicySections(policy);
  verifyBoundContracts(root, policy.boundContracts);
  if (previousPolicy) {
    assertPolicyRatchet(previousPolicy, policy);
    return { ok: true, mode: "ratchet" };
  }
  assertBootstrapStage(activeStage);
  return { ok: true, mode: "bootstrap" };
}

export function loadPreviousPolicyFromGit({ root = process.cwd(), baselineSha, policyPath = "config/development-gates.json" } = {}) {
  if (!/^[a-f0-9]{40}$/i.test(baselineSha ?? "") || !isSafeRelativePath(policyPath)) {
    throw new Error("A safe baseline SHA and policy path are required.");
  }
  const result = spawnSync("git", ["show", `${baselineSha}:${normalizePath(policyPath)}`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Previous development gate policy is invalid JSON.");
  }
}

function assertBootstrapStage(stage) {
  const continuity = stage?.providerContinuity;
  const exactStage = stage?.schemaVersion === "shanhai-active-stage.v1" &&
    stage.stageId === "project-development-gates" && stage.status === "active" &&
    stage.baselineSha === "63b9bd3866195b8062756f2b7016faf44e22208f" &&
    stage.plan === "docs/stages/project-development-gates-plan.md" &&
    stage.testPlan === "docs/stages/project-development-gates-test-plan.md";
  const policyOnly = continuity?.requirement === "bootstrap-policy-only";
  const captureOnly = continuity?.requirement === "provider-evidence-capture-bootstrap" &&
    continuity.mode === "development-only" && continuity.expiresOn === "2026-07-18" &&
    JSON.stringify(continuity.allowedProductionPaths) === JSON.stringify(captureBootstrapProductionPaths);
  if (!exactStage || (!policyOnly && !captureOnly)) {
    throw new Error("Missing exact development gate bootstrap stage.");
  }
  const expires = Date.parse(`${continuity.expiresOn}T23:59:59Z`);
  if (!Number.isFinite(expires) || Date.now() > expires) throw new Error("Development gate bootstrap stage has expired.");
}

function requirePolicySections(policy) {
  const valid = policy && policy.complexity && policy.sourceStringContracts && policy.lint && policy.providerContinuity &&
    Array.isArray(policy.complexity.baseline) && Array.isArray(policy.sourceStringContracts.baseline) &&
    Array.isArray(policy.complexity.excludedPaths) && Array.isArray(policy.sourceStringContracts.excludedPaths) &&
    Array.isArray(policy.providerContinuity.sensitivePaths) && Array.isArray(policy.providerContinuity.forbiddenModes) &&
    Array.isArray(policy.providerContinuity.requiredScenarios);
  if (!valid) throw new Error("Development gate policy is incomplete.");
}

function assertDebtRatchet(previousEntries, currentEntries, label, numericFields) {
  const previous = uniqueEntries(previousEntries, label);
  const current = uniqueEntries(currentEntries, label);
  for (const [debtPath, currentEntry] of current) {
    const previousEntry = previous.get(debtPath);
    if (!previousEntry) throw new Error(`${label} cannot add ${debtPath}.`);
    for (const field of numericFields) {
      if (!Number.isSafeInteger(currentEntry[field]) || currentEntry[field] < 0 ||
          !Number.isSafeInteger(previousEntry[field]) || previousEntry[field] < 0) {
        throw new Error(`${label} contains an invalid ${field}.`);
      }
      if (currentEntry[field] > previousEntry[field]) throw new Error(`${label} cannot increase ${debtPath}.`);
    }
  }
}

function uniqueEntries(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    if (!entry || !isSafeRelativePath(entry.path)) throw new Error(`${label} contains an unsafe path.`);
    const normalized = normalizePath(entry.path);
    if (result.has(normalized)) throw new Error(`${label} contains duplicate paths.`);
    result.set(normalized, entry);
  }
  return result;
}

function assertNotGreater(previous, current, label) {
  requireNonNegativeInteger(previous, label);
  requireNonNegativeInteger(current, label);
  if (current > previous) throw new Error(`${label} cannot increase.`);
}

function assertNotLess(previous, current, label) {
  requireNonNegativeInteger(previous, label);
  requireNonNegativeInteger(current, label);
  if (current < previous) throw new Error(`${label} cannot decrease.`);
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

function assertNoAddedValues(previous, current, label) {
  const before = new Set(previous);
  for (const value of current) if (!before.has(value)) throw new Error(`${label} cannot add ${value}.`);
}

function assertNoRemovedValues(previous, current, label) {
  const after = new Set(current);
  for (const value of previous) if (!after.has(value)) throw new Error(`${label} cannot remove ${value}.`);
}

function containedPath(root, relative) {
  const candidate = path.resolve(root, ...normalizePath(relative).split("/"));
  const remainder = path.relative(root, candidate);
  if (remainder.startsWith("..") || path.isAbsolute(remainder)) throw new Error("Bound contract contains an unsafe path.");
  return candidate;
}

function isSafeRelativePath(value) {
  return typeof value === "string" && Boolean(value) && !path.isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function runCli() {
  const root = process.cwd();
  const policy = JSON.parse(readFileSync(path.join(root, "config", "development-gates.json"), "utf8"));
  const activeStage = JSON.parse(readFileSync(path.join(root, "docs", "stages", "active-stage.json"), "utf8"));
  const previousPolicy = loadPreviousPolicyFromGit({ root, baselineSha: activeStage.baselineSha });
  const result = verifyCurrentPolicy({ root, policy, activeStage, previousPolicy });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "Development gate policy verification failed." }));
    process.exit(2);
  });
}
