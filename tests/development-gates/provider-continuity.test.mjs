import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  detectProviderImpact,
  verifyProviderContinuityEvidence,
} from "../../scripts/development-gates/provider-continuity.mjs";
import { createVitestShardPlans, removeTestDatabaseFamily } from "../../scripts/run-tests.mjs";

const NOW = new Date("2026-07-17T08:00:00.000Z");
const BOOTSTRAP_BASELINE = "63b9bd3866195b8062756f2b7016faf44e22208f";
const CAPTURE_PRODUCTION_PATHS = [
  "src/server/conversation/conversation-turn-service.ts",
  "src/server/conversation/main-conversation-agent.ts",
  "src/server/conversation/model-main-conversation-agent.ts",
  "src/server/gpt-protocol/openai-responses-adapter.ts",
  "src/server/gpt-protocol/types.ts",
  "src/server/provider-ledger/provider-call-trace.ts",
];
const READINESS_IMPLEMENTATION_PATHS = [
  "config/development-gates.json",
  "docs/mainlines/current-mainline-status.md",
  "docs/stages/active-stage.json",
  "docs/stages/p0-05a-provider-continuity-readiness-plan.md",
  "docs/stages/p0-05a-provider-continuity-readiness-test-plan.md",
  "docs/stages/p0-05a-v1-9-readiness-matrix.md",
  "scripts/run-v1-9-e2e.mjs",
  "scripts/run-m67-e2e.mjs",
  "scripts/development-gates/provider-continuity.mjs",
  "scripts/lib/v1-9-e2e-contract.d.mts",
  "scripts/lib/v1-9-e2e-contract.mjs",
  "src/instrumentation.ts",
  "src/server/conversation/conversation-turn-checkpoint-recovery.ts",
  "src/server/conversation/conversation-turn-queue.ts",
  "src/server/conversation/conversation-turn-recovery.ts",
  "src/server/conversation/external-audit-startup-recovery.ts",
  "src/server/conversation/provider-health-startup-recovery.ts",
  "src/server/conversation/v1-9-contract-repair-evidence.ts",
  "src/server/conversation/v1-9-startup-recovery-authority.ts",
  "src/server/workbench/repository.ts",
  "src/server/workbench/service.ts",
  "src/server/workbench/types.ts",
  "src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts",
  "tests/conversation-checkpoint-recovery.test.ts",
  "tests/conversation-contract-repair-recovery.test.ts",
  "tests/conversation-provider-health-recovery.test.ts",
  "tests/development-gates/provider-continuity.test.mjs",
  "tests/development-gates/wiring.test.mjs",
  "tests/external-audit-startup-recovery-authority.test.ts",
  "tests/m67-e2e-runner.test.mjs",
  "tests/v1-9-contract-repair-evidence.test.ts",
  "tests/v1-9-e2e-runner.test.mjs",
  "tests/v1-9-run-state-v2.test.mjs",
  "tests/v1-9-startup-recovery-authority.test.ts",
];
const OFFLINE_REFACTOR_IMPLEMENTATION_PATHS = [
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
const OFFLINE_REFACTOR_PINNED_IMPLEMENTATION_PATHS = OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS.map(
  (entry) => entry.path,
);

test("test database initialization removes stale WAL and shared-memory sidecars", () => {
  const removed = [];
  removeTestDatabaseFamily("C:\\repo\\.tmp\\vitest.db", {
    fileSystem: {
      rmSync: (candidate, options) => removed.push([candidate, options]),
    },
  });
  assert.deepEqual(removed, [
    ["C:\\repo\\.tmp\\vitest.db-wal", { force: true }],
    ["C:\\repo\\.tmp\\vitest.db-shm", { force: true }],
    ["C:\\repo\\.tmp\\vitest.db", { force: true }],
  ]);
  const plans = createVitestShardPlans({
    root: "C:\\repo",
    base: {},
    providerLedgerRoot: null,
    shardCount: 2,
    runToken: "1234-run",
  });
  assert.deepEqual(plans.map((plan) => path.basename(plan.databasePath)), [
    "test-workbench-1234-run-vitest-shard-1.db",
    "test-workbench-1234-run-vitest-shard-2.db",
  ]);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("pinned Provider implementations keep LF bytes across Windows CI checkouts", () => {
  const attributes = readFileSync(path.join(process.cwd(), ".gitattributes"), "utf8");
  for (const implementationPath of OFFLINE_REFACTOR_PINNED_IMPLEMENTATION_PATHS) {
    assert.match(
      attributes,
      new RegExp(`^${implementationPath.replaceAll(".", "\\.")} text eol=lf$`, "m"),
    );
  }
});

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeConfig() {
  return {
    schemaVersion: "shanhai-development-gates.v1",
    providerContinuity: {
      sensitivePaths: [
        "src/server/conversation/**",
        "src/server/gpt-protocol/**",
        "src/server/provider-ledger/**",
        "src/server/workbench/*.ts",
        "src/lib/conversation-message-contract.ts",
        "src/lib/conversation-message-*.ts",
        "src/lib/teacher-agent-event*.ts",
        "scripts/lib/v1-9-e2e-contract*",
        "scripts/development-gates/provider-continuity.mjs",
        "config/development-gates.json",
        "config/provider-capture-trust.json",
        "docs/stages/active-stage.json",
      ],
      manifestPath: ".tmp/provider-continuity/provider-continuity.manifest.json",
      receiptPath: ".tmp/provider-continuity/provider-continuity.receipt.json",
      evidenceRoot: ".tmp/provider-continuity/evidence",
      trustStorePath: "config/provider-capture-trust.json",
      maxAgeHours: 168,
      developmentConsecutiveRuns: 3,
      releaseConsecutiveRuns: 5,
      forbiddenModes: ["mock", "fallback", "degraded", "placeholder"],
      requiredScenarios: [
        {
          id: "ambiguous-discussion",
          allowedTools: [],
          requiredArtifacts: 0,
          intentEpoch: "unchanged",
        },
        {
          id: "single-requirement-spec",
          allowedTools: ["create_requirement_spec"],
          requiredArtifacts: 1,
          intentEpoch: "advanced-once",
        },
        {
          id: "requirement-spec-and-ppt-outline",
          allowedTools: ["create_requirement_spec", "create_ppt_outline"],
          requiredArtifacts: 2,
          intentEpoch: "unchanged-within-task",
        },
        {
          id: "main-agent-continuation",
          allowedTools: [],
          requiredArtifacts: 0,
          intentEpoch: "unchanged",
        },
      ],
    },
  };
}

function writeCaptureBootstrapStage(root, overrides = {}) {
  writeJson(path.join(root, "docs/stages/active-stage.json"), {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "project-development-gates",
    status: "active",
    baselineSha: BOOTSTRAP_BASELINE,
    plan: "docs/stages/project-development-gates-plan.md",
    testPlan: "docs/stages/project-development-gates-test-plan.md",
    providerContinuity: {
      requirement: "provider-evidence-capture-bootstrap",
      reason: "Add sanitized runtime call tracing without claiming continuity passed.",
      expiresOn: "2026-07-18",
      mode: "development-only",
      allowedProductionPaths: CAPTURE_PRODUCTION_PATHS,
      ...overrides,
    },
  });
}

function writeReadinessStage(root, overrides = {}) {
  writeJson(path.join(root, "docs/stages/active-stage.json"), {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "p0-05a-provider-continuity-readiness",
    status: "active",
    baselineSha: "781af1fbb2a0451514807e8c587566496bfc502a",
    plan: "docs/stages/p0-05a-provider-continuity-readiness-plan.md",
    testPlan: "docs/stages/p0-05a-provider-continuity-readiness-test-plan.md",
    providerContinuity: {
      requirement: "provider-continuity-readiness-implementation",
      mode: "development-only",
      expiresOn: "2026-07-24",
      liveCallsAuthorized: false,
      liveCampaign: "blocked-awaiting-explicit-authorization",
      liveAuthorization: null,
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: [],
      trustedLedgerAuthorityKeyIds: [],
      allowedImplementationPaths: READINESS_IMPLEMENTATION_PATHS,
      ...overrides,
    },
  });
}

function writeOfflineRefactorStage(root, continuityOverrides = {}, stageOverrides = {}) {
  writeJson(path.join(root, "docs/stages/active-stage.json"), {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "product-first-deep-refactor",
    status: "active",
    baselineSha: "20c6e2530b991db77108c7b7a61090e9060b7fca",
    plan: "docs/stages/product-first-deep-refactor-plan.md",
    testPlan: "docs/stages/product-first-deep-refactor-test-plan.md",
    ...stageOverrides,
    providerContinuity: {
      requirement: "offline-product-refactor",
      mode: "development-only",
      expiresOn: "2026-08-16",
      liveCallsAuthorized: false,
      liveCampaign: "blocked-outside-current-stage",
      liveAuthorization: null,
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: [],
      trustedLedgerAuthorityKeyIds: [],
      allowedImplementationPaths: OFFLINE_REFACTOR_IMPLEMENTATION_PATHS,
      pinnedImplementationSha256: OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS,
      ...continuityOverrides,
    },
  });
}

function setupRepository(t) {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-provider-gate-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));

  writeJson(path.join(root, "config/development-gates.json"), makeConfig());
  mkdirSync(path.join(root, "src/server/conversation"), { recursive: true });
  writeFileSync(
    path.join(root, "src/server/conversation/provider.ts"),
    "export const provider = 'real';\n",
    { encoding: "utf8", flag: "w" },
  );
  for (const { path: relativePath } of OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, readFileSync(path.join(process.cwd(), ...relativePath.split("/"))), "utf8");
  }
  writeJson(path.join(root, "docs/stages/active-stage.json"), {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "project-development-gates",
    status: "active",
    baselineSha: BOOTSTRAP_BASELINE,
    plan: "docs/stages/project-development-gates-plan.md",
    testPlan: "docs/stages/project-development-gates-test-plan.md",
    allowedPaths: [
      "AGENTS.md",
      "config/development-gates.json",
      "docs/**",
      "package.json",
      "scripts/development-gates/**",
      "tests/development-gates/**",
      ".github/**",
    ],
    protectedPathExceptions: [],
    budgets: {
      maxChangedFiles: 32,
      maxAddedLines: 4200,
      maxDeletedLines: 500,
      maxBinaryFiles: 0,
    },
    providerContinuity: {
      requirement: "bootstrap-policy-only",
      reason: "Create the first fail-closed verifier without changing production Provider execution.",
      expiresOn: "2026-07-18",
    },
  });

  git(root, "init", "--quiet");
  git(root, "config", "user.email", "provider-gate@example.invalid");
  git(root, "config", "user.name", "Provider Gate Test");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

function computeBundle(root) {
  const files = [
    "config/development-gates.json",
    "docs/stages/active-stage.json",
    "src/server/conversation/provider.ts",
    ...OFFLINE_REFACTOR_PINNED_IMPLEMENTATION_PATHS,
  ];
  const digest = createHash("sha256");
  for (const relativePath of files) {
    const fileDigest = sha256(readFileSync(path.join(root, relativePath)));
    digest.update(relativePath);
    digest.update("\0");
    digest.update(fileDigest);
    digest.update("\n");
  }
  return digest.digest("hex");
}

function subjectFor(root) {
  return {
    commit: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
    bundleSha256: computeBundle(root),
  };
}

function scenarioEvidence(definition, runIndex) {
  const epochBefore = 10 + runIndex;
  const epochAfter =
    definition.intentEpoch === "advanced-once" ? epochBefore + 1 : epochBefore;
  return {
    id: definition.id,
    httpStatuses: [200],
    toolInvocations: definition.allowedTools.map((name) => ({ name })),
    observations: [{ type: "provider-ledger", present: true }],
    artifacts: Array.from({ length: definition.requiredArtifacts }, (_, index) => ({
      artifactId: `${definition.id}-${runIndex}-${index + 1}`,
      kind: "candidate",
    })),
    intentEpochBefore: epochBefore,
    intentEpochAfter: epochAfter,
    modes: ["real-provider"],
    timeOuts: [false],
    result: "passed",
  };
}

function writeValidEvidence(root, options = {}) {
  const config = makeConfig();
  const policy = config.providerContinuity;
  if (options.preserveActiveStage !== true) {
    const stagePath = path.join(root, "docs/stages/active-stage.json");
    const stage = JSON.parse(readFileSync(stagePath, "utf8"));
    writeJson(stagePath, { ...stage, status: "fixture" });
  }
  const mode = options.mode ?? "development";
  const runCount =
    options.runCount ??
    (mode === "release"
      ? policy.releaseConsecutiveRuns
      : policy.developmentConsecutiveRuns);
  const subject = subjectFor(root);
  const evidenceRoot = path.join(root, policy.evidenceRoot);
  mkdirSync(evidenceRoot, { recursive: true });

  const runs = [];
  const evidenceFiles = [];
  for (let index = 0; index < runCount; index += 1) {
    const runId = `run-${index + 1}`;
    const evidenceFile = `${runId}.json`;
    const completedAt = new Date(NOW.getTime() - (runCount - index) * 60_000);
    const run = {
      id: runId,
      sequence: index + 1,
      startedAt: new Date(completedAt.getTime() - 30_000).toISOString(),
      completedAt: completedAt.toISOString(),
      evidenceFile,
      scenarios: policy.requiredScenarios.map((definition) =>
        scenarioEvidence(definition, index),
      ),
    };
    options.mutateRun?.(run, index);
    runs.push(run);

    const evidenceDocument = {
      schemaVersion: "shanhai-provider-run-evidence.v1",
      capturedAt: run.completedAt,
      subject,
      runId,
      scenarios: run.scenarios,
    };
    options.mutateEvidence?.(evidenceDocument, index);
    const evidencePath = path.join(evidenceRoot, evidenceFile);
    writeJson(evidencePath, evidenceDocument);
    evidenceFiles.push({
      path: evidenceFile,
      runId,
      sha256: sha256(readFileSync(evidencePath)),
    });
  }

  options.mutateEvidenceFiles?.(evidenceFiles);
  const manifest = {
    schemaVersion: "shanhai-provider-continuity-manifest.v1",
    generatedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    mode,
    subject,
    evidenceFiles: evidenceFiles.map((entry) => entry.path),
  };
  options.mutateManifest?.(manifest);
  const manifestPath = path.join(root, policy.manifestPath);
  writeJson(manifestPath, manifest);

  const receipt = {
    schemaVersion: "shanhai-provider-continuity-receipt.v1",
    verifiedAt: NOW.toISOString(),
    mode,
    manifestSha256: sha256(readFileSync(manifestPath)),
    subject,
    runs,
    evidenceFiles,
  };
  options.mutateReceipt?.(receipt);
  writeJson(path.join(root, policy.receiptPath), receipt);
  return { manifest, receipt };
}

function verify(root, overrides = {}) {
  return verifyProviderContinuityEvidence({
    root,
    mode: "development",
    now: NOW,
    changedPaths: ["src/server/conversation/provider.ts"],
    ...overrides,
  });
}

test("detectProviderImpact identifies sensitive files and rejects unsafe paths", (t) => {
  const root = setupRepository(t);
  const impact = detectProviderImpact({
    root,
    changedPaths: ["README.md", "src\\server\\conversation\\provider.ts"],
    now: NOW,
  });

  assert.equal(impact.impacted, true);
  assert.deepEqual(impact.matchedPaths, ["src/server/conversation/provider.ts"]);
  const trustImpact = detectProviderImpact({
    root,
    changedPaths: ["config/provider-capture-trust.json", "docs/stages/active-stage.json"],
    now: NOW,
  });
  assert.equal(trustImpact.impacted, true);
  assert.deepEqual(trustImpact.matchedPaths, ["config/provider-capture-trust.json", "docs/stages/active-stage.json"]);
  const authorityContractImpact = detectProviderImpact({
    root,
    changedPaths: ["scripts/lib/v1-9-e2e-contract.mjs"],
    now: NOW,
  });
  assert.equal(authorityContractImpact.impacted, true);
  assert.deepEqual(authorityContractImpact.matchedPaths, ["scripts/lib/v1-9-e2e-contract.mjs"]);
  assert.deepEqual(authorityContractImpact.productionProviderPaths, ["scripts/lib/v1-9-e2e-contract.mjs"]);
  assert.throws(
    () => detectProviderImpact({ root, changedPaths: ["../outside.ts"], now: NOW }),
    /unsafe changed path/i,
  );
});

test("detectProviderImpact includes committed sensitive changes from the active stage baseline", (t) => {
  const root = setupRepository(t);
  const baselineSha = git(root, "rev-parse", "HEAD");
  const stagePath = path.join(root, "docs/stages/active-stage.json");
  const stage = JSON.parse(readFileSync(stagePath, "utf8"));
  stage.baselineSha = baselineSha;
  writeJson(stagePath, stage);
  writeFileSync(
    path.join(root, "src/server/conversation/provider.ts"),
    "export const provider = 'changed-real';\n",
    "utf8",
  );
  git(root, "add", "docs/stages/active-stage.json", "src/server/conversation/provider.ts");
  git(root, "commit", "--quiet", "-m", "committed sensitive change");

  const impact = detectProviderImpact({ root, now: NOW });

  assert.equal(impact.impacted, true);
  assert.deepEqual(impact.matchedPaths, ["docs/stages/active-stage.json", "src/server/conversation/provider.ts"]);
  assert.ok(impact.changedPaths.includes("docs/stages/active-stage.json"));
});

test("accepts a SHA-bound development receipt with three consecutive real runs", (t) => {
  const root = setupRepository(t);
  writeValidEvidence(root);

  const result = verify(root);
  assert.equal(result.ok, true);
  assert.equal(result.status, "passed");
  assert.equal(result.consecutiveRuns, 3);
  assert.equal(result.scenarioCount, 4);
});

test("missing evidence fails closed except for the exact unexpired bootstrap stage", (t) => {
  const root = setupRepository(t);

  assert.throws(() => verify(root), /receipt.*missing/i);
  const deferred = verify(root, {
    changedPaths: [
      "config/development-gates.json",
      "scripts/development-gates/provider-continuity.mjs",
      "tests/development-gates/provider-continuity.test.mjs",
      "docs/stages/active-stage.json",
    ],
  });
  assert.equal(deferred.ok, false);
  assert.equal(deferred.status, "deferred_bootstrap");
  assert.equal(deferred.passed, false);

  assert.throws(
    () =>
      verify(root, {
        now: new Date("2026-07-19T00:00:00.000Z"),
        changedPaths: ["config/development-gates.json"],
      }),
    /receipt.*missing/i,
  );
  assert.throws(
    () =>
      verify(root, {
        changedPaths: [
          "config/development-gates.json",
          "src/server/conversation/provider.ts",
        ],
      }),
    /receipt.*missing/i,
  );
});

test("offline product refactor is exact, expiring, development-only, and never passes Provider validation", (t) => {
  const root = setupRepository(t);
  writeOfflineRefactorStage(root);
  const changedPaths = [
    "scripts/development-gates/provider-continuity.mjs",
    "scripts/development-gates/run-development-gates.mjs",
    "src/server/conversation/conversation-turn-service.ts",
    "src/server/workbench/workbench-generation-service.ts",
    "src/lib/conversation-message-parts.ts",
    "src/lib/teacher-agent-event-timeline.ts",
    "tests/development-gates/provider-continuity.test.mjs",
  ];
  const result = verify(root, { changedPaths });
  assert.equal(result.ok, false);
  assert.equal(result.passed, false);
  assert.equal(result.status, "deferred_provider_validation_during_offline_refactor");
  assert.throws(() => verifyProviderContinuityEvidence({
    root, mode: "release", now: NOW, changedPaths,
  }), /receipt.*missing/i);

  writeOfflineRefactorStage(root, { liveCallsAuthorized: true });
  assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i);
  writeOfflineRefactorStage(root, { expiresOn: "2026-07-16" });
  assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i);
  writeOfflineRefactorStage(root);
  assert.throws(() => verify(root, {
    changedPaths: ["src/server/gpt-protocol/openai-responses-adapter.ts"],
  }), /receipt.*missing/i);

  const driftCases = [
    ["status", {}, { status: "paused" }],
    ["baseline", {}, { baselineSha: "a".repeat(40) }],
    ["plan", {}, { plan: "docs/stages/other-plan.md" }],
    ["testPlan", {}, { testPlan: "docs/stages/other-test-plan.md" }],
    ["requirement", { requirement: "other" }, {}],
    ["mode", { mode: "release" }, {}],
    ["liveCampaign", { liveCampaign: "other" }, {}],
    ["liveAuthorization", { liveAuthorization: { authorizationDigest: "a".repeat(64) } }, {}],
    ["requiredReceiptSchema", { requiredReceiptSchema: "shanhai-provider-continuity-receipt.v1" }, {}],
    ["allowedImplementationPaths", { allowedImplementationPaths: [...OFFLINE_REFACTOR_IMPLEMENTATION_PATHS, "src/server/gpt-protocol/**"] }, {}],
    ["pinnedImplementationSha256", { pinnedImplementationSha256: [] }, {}],
  ];
  for (const [label, continuityOverrides, stageOverrides] of driftCases) {
    writeOfflineRefactorStage(root, continuityOverrides, stageOverrides);
    assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i, label);
  }

  writeOfflineRefactorStage(root);
  writeFileSync(
    path.join(root, ...OFFLINE_REFACTOR_PINNED_IMPLEMENTATION_PATHS[0].split("/")),
    "export const fixture = 'semantic-drift';\n",
    "utf8",
  );
  assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i, "pinned file content drift");

  writeOfflineRefactorStage(root, {
    pinnedImplementationSha256: OFFLINE_REFACTOR_PINNED_IMPLEMENTATIONS.map((entry, index) => ({
      ...entry,
      sha256: index === 0
        ? sha256(readFileSync(path.join(root, ...entry.path.split("/"))))
        : entry.sha256,
    })),
  });
  assert.throws(
    () => verify(root, { changedPaths }),
    /receipt.*missing/i,
    "file drift with synchronized stage self-report",
  );
});

test("detectProviderImpact covers workbench production modules without matching nested tests", (t) => {
  const root = setupRepository(t);
  const productionPaths = [
    "src/server/workbench/workbench-artifact-service.ts",
    "src/server/workbench/workbench-generation-service.ts",
    "src/server/workbench/workbench-turn-job-service.ts",
  ];
  const impact = detectProviderImpact({
    root,
    changedPaths: [...productionPaths, "src/server/workbench/__tests__/service.test.ts"],
    now: NOW,
  });

  assert.equal(impact.impacted, true);
  assert.deepEqual(impact.matchedPaths, productionPaths);
  assert.deepEqual(impact.productionProviderPaths, productionPaths);
});

test("detectProviderImpact covers every decomposed message and teacher event contract module", (t) => {
  const root = setupRepository(t);
  const productionPaths = [
    "src/lib/conversation-message-contract.ts",
    "src/lib/conversation-message-parts.ts",
    "src/lib/conversation-message-projection.ts",
    "src/lib/teacher-agent-event-contract.ts",
    "src/lib/teacher-agent-event-message-merge.ts",
    "src/lib/teacher-agent-event-projection.ts",
    "src/lib/teacher-agent-event-timeline.ts",
    "src/lib/teacher-agent-events.ts",
  ];
  const impact = detectProviderImpact({ root, changedPaths: productionPaths, now: NOW });

  assert.equal(impact.impacted, true);
  assert.deepEqual(impact.matchedPaths, productionPaths);
  assert.deepEqual(impact.productionProviderPaths, productionPaths);
});

test("offline product refactor rejects legacy or unsigned receipts in release mode", (t) => {
  const root = setupRepository(t);
  const changedPaths = ["src/server/conversation/conversation-turn-service.ts"];
  writeOfflineRefactorStage(root);
  writeValidEvidence(root, { mode: "release", runCount: 5, preserveActiveStage: true });
  assert.throws(() => verifyProviderContinuityEvidence({
    root, mode: "release", now: NOW, changedPaths,
  }), (error) => error?.code === "PROVIDER_RECEIPT_SCHEMA_UNSUPPORTED");

  const manifestPath = path.join(root, ".tmp/provider-continuity/provider-continuity.manifest.json");
  const receiptPath = path.join(root, ".tmp/provider-continuity/provider-continuity.receipt.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  writeJson(manifestPath, { ...manifest, schemaVersion: "shanhai-provider-continuity-manifest.v2" });
  writeJson(receiptPath, { ...receipt, schemaVersion: "shanhai-provider-continuity-receipt.v2" });
  assert.throws(() => verifyProviderContinuityEvidence({
    root, mode: "release", now: NOW, changedPaths,
  }), (error) => error?.code === "PROVIDER_CAPTURE_TRUST_ROOT_MISSING");

  writeOfflineRefactorStage(root, {
    trustedCaptureKeyIds: ["capture-test"],
    trustedLedgerAuthorityKeyIds: ["ledger-test"],
  });
  assert.throws(() => verifyProviderContinuityEvidence({
    root, mode: "release", now: NOW, changedPaths,
  }), (error) => error?.code === "PROVIDER_LIVE_AUTHORIZATION_MISSING");
});

test("an active stage cannot validate a receipt without declaring the signed receipt schema", (t) => {
  const root = setupRepository(t);
  writeValidEvidence(root, { mode: "release", runCount: 5, preserveActiveStage: true });
  assert.throws(() => verifyProviderContinuityEvidence({
    root,
    mode: "release",
    now: NOW,
    changedPaths: ["config/development-gates.json"],
  }), (error) => error?.code === "PROVIDER_RECEIPT_SCHEMA_UNDECLARED");
});

test("active P0-05A rejects the self-reported v1 receipt even when its hashes are internally consistent", (t) => {
  const root = setupRepository(t);
  writeReadinessStage(root);
  writeValidEvidence(root, { preserveActiveStage: true });
  assert.throws(() => verify(root, {
    changedPaths: ["scripts/development-gates/provider-continuity/preflight.mjs"],
  }), (error) => error?.code === "PROVIDER_RECEIPT_SCHEMA_UNSUPPORTED");
});

test("capture bootstrap is development-only, exact-path, expiring, and never a passing receipt", (t) => {
  const root = setupRepository(t);
  writeCaptureBootstrapStage(root);
  const changedPaths = [
    ".gitattributes",
    "README.md",
    "config/development-gates.json",
    "fixtures/ppt-sample-manifest.json",
    "scripts/run-tests.mjs",
    "scripts/development-gates/provider-continuity.mjs",
    "tests/capability-availability.test.ts",
    "tests/development-gates/provider-continuity.test.mjs",
    "tests/fixtures/provider-ledger/manifest.json",
    "tests/health-route.test.ts",
    "tests/health-readiness.test.ts",
    "tests/package-tool-adapter.test.ts",
    "tests/ppt-key-sample-renderer.test.ts",
    "tests/video-narration-provider.test.ts",
    "src/server/video-quality/video-timeline-assembler.ts",
    "src/server/ppt-quality/ppt-key-sample-renderer.ts",
    "docs/stages/active-stage.json",
    ...CAPTURE_PRODUCTION_PATHS,
  ];

  const impact = detectProviderImpact({ root, changedPaths, now: NOW });
  assert.equal(impact.captureBootstrapOnly, true);
  assert.deepEqual(impact.captureProductionPaths, CAPTURE_PRODUCTION_PATHS);

  const deferred = verify(root, { changedPaths });
  assert.equal(deferred.ok, false);
  assert.equal(deferred.passed, false);
  assert.equal(deferred.status, "deferred_capture_bootstrap");

  assert.throws(
    () => verify(root, { changedPaths, mode: "release" }),
    /receipt.*missing/i,
  );
  assert.throws(
    () => verify(root, {
      changedPaths: [...changedPaths, "src/server/tools/provider-tool-adapter.ts"],
    }),
    /receipt.*missing/i,
  );
  assert.throws(
    () => verify(root, { changedPaths: [...changedPaths, "unplanned-root.txt"] }),
    /receipt.*missing/i,
  );
  assert.throws(
    () => verify(root, {
      changedPaths,
      now: new Date("2026-07-19T00:00:00.000Z"),
    }),
    /receipt.*missing/i,
  );

  writeCaptureBootstrapStage(root, {
    allowedProductionPaths: [...CAPTURE_PRODUCTION_PATHS, "src/server/tools/provider-tool-adapter.ts"],
  });
  assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i);

  writeCaptureBootstrapStage(root, { expiresOn: "2026-07-19" });
  assert.throws(() => verify(root, { changedPaths }), /receipt.*missing/i);
});

test("release verification requires five consecutive runs", (t) => {
  const root = setupRepository(t);
  writeValidEvidence(root, { mode: "release", runCount: 4 });
  assert.throws(
    () => verify(root, { mode: "release" }),
    /at least 5 consecutive runs/i,
  );

  writeValidEvidence(root, { mode: "release", runCount: 5 });
  assert.equal(verify(root, { mode: "release" }).consecutiveRuns, 5);
});

test("rejects manifest self-reference, hash mismatch, and candidate subject mismatch", async (t) => {
  await t.test("manifest self-reference", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateManifest: (manifest) => {
        manifest.manifestSha256 = "0".repeat(64);
      },
    });
    assert.throws(() => verify(root), /self-reference/i);
  });

  await t.test("manifest hash mismatch", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateReceipt: (receipt) => {
        receipt.manifestSha256 = "0".repeat(64);
      },
    });
    assert.throws(() => verify(root), /manifest sha256 mismatch/i);
  });

  await t.test("candidate commit mismatch", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateReceipt: (receipt) => {
        receipt.subject.commit = "0".repeat(40);
      },
    });
    assert.throws(() => verify(root), /subject.*mismatch/i);
  });
});

test("rejects escaped, duplicate, unlisted, and symlinked evidence files", async (t) => {
  await t.test("path escape", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateEvidenceFiles: (files) => {
        files[0].path = "../outside.json";
      },
    });
    assert.throws(() => verify(root), /unsafe evidence path/i);
  });

  await t.test("case-insensitive duplicate", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateEvidenceFiles: (files) => {
        files[1].path = files[0].path.toUpperCase();
      },
    });
    assert.throws(() => verify(root), /duplicate evidence path/i);
  });

  await t.test("extra file", () => {
    const root = setupRepository(t);
    writeValidEvidence(root);
    writeJson(path.join(root, ".tmp/provider-continuity/evidence/unlisted.json"), {
      ignored: false,
    });
    assert.throws(() => verify(root), /unlisted evidence file/i);
  });

  await t.test("symlink", (subtest) => {
    const root = setupRepository(t);
    writeValidEvidence(root);
    const evidenceRoot = path.join(root, ".tmp/provider-continuity/evidence");
    try {
      symlinkSync(
        path.join(evidenceRoot, "run-1.json"),
        path.join(evidenceRoot, "linked.json"),
        "file",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
        subtest.skip("This Windows environment does not permit test symlinks.");
        return;
      }
      throw error;
    }
    assert.throws(() => verify(root), /symbolic link/i);
  });
});

test("rejects stale receipts, incomplete scenarios, raw 5xx, timeout, and retry masking", async (t) => {
  await t.test("stale", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateReceipt: (receipt) => {
        receipt.verifiedAt = "2026-07-01T00:00:00.000Z";
      },
    });
    assert.throws(() => verify(root), /expired/i);
  });

  await t.test("fresh receipt cannot repackage stale runs", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run) => {
        run.startedAt = "2026-07-01T00:00:00.000Z";
        run.completedAt = "2026-07-01T00:00:30.000Z";
      },
      mutateManifest: (manifest) => {
        manifest.generatedAt = "2026-07-17T07:59:50.000Z";
      },
    });
    assert.throws(() => verify(root), /run-1 has expired/i);
  });

  await t.test("scenario missing", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 1) run.scenarios.pop();
      },
    });
    assert.throws(() => verify(root), /required scenarios/i);
  });

  await t.test("raw 5xx followed by success", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 1) run.scenarios[0].httpStatuses = [502, 200];
      },
    });
    assert.throws(() => verify(root), /unsuccessful http status 502/i);
  });

  await t.test("timeout", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 1) run.scenarios[0].timeOuts = [true, false];
      },
    });
    assert.throws(() => verify(root), /timeout/i);
  });

  await t.test("retry metadata", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 1) run.scenarios[0].retryCount = 1;
      },
    });
    assert.throws(() => verify(root), /retry/i);
  });
});

test("rejects forbidden modes and Tool, Artifact, or IntentEpoch contract drift", async (t) => {
  await t.test("fallback mode", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 0) run.scenarios[0].modes = ["fallback"];
      },
    });
    assert.throws(() => verify(root), /forbidden provider mode/i);
  });

  await t.test("unexpected tool", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 0) {
          run.scenarios[0].toolInvocations = [{ name: "create_video" }];
        }
      },
    });
    assert.throws(() => verify(root), /tool contract/i);
  });

  await t.test("artifact count", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 0) run.scenarios[1].artifacts = [];
      },
    });
    assert.throws(() => verify(root), /artifact contract/i);
  });

  await t.test("intent epoch", () => {
    const root = setupRepository(t);
    writeValidEvidence(root, {
      mutateRun: (run, index) => {
        if (index === 0) run.scenarios[1].intentEpochAfter += 1;
      },
    });
    assert.throws(() => verify(root), /intentepoch contract/i);
  });
});
