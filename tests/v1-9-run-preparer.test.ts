import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  V1_9_FROZEN_PROMPT,
  prepareV1_9Run,
  terminateV1_9RunForContractUpgrade,
} from "../scripts/prepare-v1-9-run";
import {
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStatePackageReady,
  recordV1_9ExternalAcceptanceRound,
  recordV1_9RunStateMutation,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import type { V1_9ResolvedExecutionLocks } from "../scripts/v1-9-product-preflight";

const OLD_RUN_ID = "v1-9-20260714212914-a036beb9";
const NEW_RUN_ID = "v1-9-20260715-a23-preparer";
const V2_RUN_ID = "v1-9-20260715-a23-active";
const CREATED_AT = "2026-07-15T13:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V1-9 v2 run preparer", () => {
  it.each([
    [undefined, OLD_RUN_ID],
    ["resume", OLD_RUN_ID],
    ["start-new", "v1-9-wrong-predecessor"],
  ])("rejects mode=%s predecessor=%s before any write", async (runMode, predecessorRunId) => {
    const fixture = await createFixture();
    const before = await snapshotTree(fixture.rootDir);
    const createBaselineLock = vi.fn(() => baselineLock());
    const resolveExecutionLocks = vi.fn(async () => executionLocks());

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv({
        V1_9_RUN_MODE: runMode,
        V1_9_PREDECESSOR_RUN_ID: predecessorRunId,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: { createBaselineLock, resolveExecutionLocks },
    })).rejects.toThrow(/v1_9_(?:run_mode|predecessor)_invalid/);

    expect(createBaselineLock).not.toHaveBeenCalled();
    expect(resolveExecutionLocks).not.toHaveBeenCalled();
    expect(await snapshotTree(fixture.rootDir)).toEqual(before);
  });

  it("requires an explicit Skill source root before resolving any lock", async () => {
    const fixture = await createFixture();
    const before = await snapshotTree(fixture.rootDir);
    const createBaselineLock = vi.fn(() => baselineLock());
    const resolveExecutionLocks = vi.fn(async () => executionLocks());
    const env = prepareEnv();
    delete env.SHANHAI_SKILLS_SOURCE_ROOT;

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env,
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: { createBaselineLock, resolveExecutionLocks },
    })).rejects.toThrow(/v1_9_skills_source_root_required/);

    expect(createBaselineLock).not.toHaveBeenCalled();
    expect(resolveExecutionLocks).not.toHaveBeenCalled();
    expect(await snapshotTree(fixture.rootDir)).toEqual(before);
  });

  it("rejects predecessor hash drift without changing the old pointer, manifest, or run roots", async () => {
    const fixture = await createFixture();
    const before = await snapshotTree(fixture.rootDir);

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: "f".repeat(64),
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_predecessor_manifest_digest_mismatch/);

    expect(await snapshotTree(fixture.rootDir)).toEqual(before);
  });

  it("leaves no files when baseline or execution lock resolution fails", async () => {
    const fixture = await createFixture();
    const before = await snapshotTree(fixture.rootDir);
    const resolveExecutionLocks = vi.fn(async () => executionLocks());

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => {
          throw new Error("v1_9_baseline_registry_projection_mismatch");
        }),
        resolveExecutionLocks,
      },
    })).rejects.toThrow(/v1_9_baseline_registry_projection_mismatch/);

    expect(resolveExecutionLocks).not.toHaveBeenCalled();
    expect(await snapshotTree(fixture.rootDir)).toEqual(before);
  });

  it("atomically prepares one immutable v2 run and switches the strict pointer last", async () => {
    const fixture = await createFixture();
    const oldManifestBytes = await readFile(fixture.oldManifestPath);
    const oldPointerBytes = await readFile(fixture.pointerPath);
    const createBaselineLock = vi.fn(() => baselineLock());
    const resolveExecutionLocks = vi.fn(async () => executionLocks());

    const result = await prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: { createBaselineLock, resolveExecutionLocks },
    });

    expect(createBaselineLock).toHaveBeenCalledOnce();
    expect(createBaselineLock).toHaveBeenCalledWith({
      cwd: fixture.rootDir,
      env: expect.objectContaining({
        SHANHAI_SKILLS_SOURCE_ROOT: "E:\\authority\\shanhaiedu-skills",
      }),
    });
    expect(resolveExecutionLocks).toHaveBeenCalledOnce();
    expect(await readFile(fixture.oldManifestPath)).toEqual(oldManifestBytes);
    expect(oldPointerBytes.toString("utf8")).toContain('"schemaVersion": "v1-9-active-run.v1"');

    const runRoot = path.join(fixture.rootDir, "test-results", NEW_RUN_ID);
    const manifestPath = path.join(runRoot, "run-manifest.json");
    const statePath = path.join(runRoot, "run-state.json");
    const historyEvidencePath = path.join(runRoot, "predecessor-history-evidence.json");
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const state = await readJson(statePath);
    const historyEvidence = await readJson(historyEvidencePath);
    const history = await readJson(fixture.historyPath);
    const pointer = await readJson(fixture.pointerPath);

    expect(result).toEqual({
      runId: NEW_RUN_ID,
      relativeRunRoot: `test-results/${NEW_RUN_ID}`,
      manifestPath: `test-results/${NEW_RUN_ID}/run-manifest.json`,
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      statePath: `test-results/${NEW_RUN_ID}/run-state.json`,
    });
    expect(result.manifestSha256).toBe(sha256(manifestBytes));
    expect(manifest).toMatchObject({
      schemaVersion: "v1-9-run-manifest.v2",
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      baselineLock: baselineLock(),
      skillLock: executionLocks().skillLock,
      agentBrain: { providerLock: executionLocks().providerLock },
      providerRuntimeLocks: executionLocks().providerRuntimeLocks,
      predecessor: {
        runId: OLD_RUN_ID,
        relativeRunRoot: `test-results/${OLD_RUN_ID}`,
        manifestSha256: fixture.oldManifestSha256,
        disposition: "historical_failed",
      },
    });
    expect(manifest).not.toHaveProperty("status");
    expect(state).toMatchObject({
      schemaVersion: "v1-9-run-state.v2",
      runId: NEW_RUN_ID,
      manifestSha256: result.manifestSha256,
      status: "prepared",
    });
    expect(historyEvidence).toEqual({
      schemaVersion: "v1-9-predecessor-history-evidence.v1",
      predecessor: manifest.predecessor,
      predecessorPointerSha256: sha256(oldPointerBytes),
      successorRunId: NEW_RUN_ID,
      verifiedAt: CREATED_AT,
    });
    expect(history).toEqual({
      schemaVersion: "v1-9-run-history.v1",
      entries: [{
        ...manifest.predecessor,
        manifestPath: `test-results/${OLD_RUN_ID}/run-manifest.json`,
        successorRunId: NEW_RUN_ID,
        recordedAt: CREATED_AT,
      }],
    });
    expect(Object.keys(pointer)).toEqual([
      "schemaVersion",
      "runId",
      "relativeRunRoot",
      "manifestPath",
      "manifestSha256",
      "statePath",
    ]);
    expect(pointer).toEqual({ schemaVersion: "v1-9-active-run.v2", ...result });
    expect(await readdir(path.join(fixture.rootDir, "test-results"))).not.toContain(
      expect.stringMatching(/^\.v1-9-prepare-/),
    );

    const runnerModulePath = "../scripts/run-v1-9-e2e.mjs";
    const runner = await import(runnerModulePath);
    expect(V1_9_FROZEN_PROMPT).toBe(runner.V1_9_FROZEN_PROMPT);
    expect(manifest.promptDigest).toBe(sha256(Buffer.from(V1_9_FROZEN_PROMPT, "utf8")));
  });

  it("refuses an invalid history index before creating a temporary or final run directory", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.historyPath, '{"schemaVersion":"unknown","entries":[]}\n', "utf8");
    const before = await snapshotTree(fixture.rootDir);

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_run_history_invalid/);

    expect(await snapshotTree(fixture.rootDir)).toEqual(before);
  });

  it("atomically terminates a v2 run and prepares only its bound successor", async () => {
    const fixture = await createV2Fixture("running");
    const pointerBefore = await readFile(fixture.pointerPath);
    const manifestBefore = await readFile(fixture.oldManifestPath);

    const termination = await terminateV1_9RunForContractUpgrade({
      rootDir: fixture.rootDir,
      predecessorRunId: V2_RUN_ID,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      successorRunId: NEW_RUN_ID,
      reasonCode: "v1_9_contract_upgrade",
      driftedFields: ["runtimeSourceDigest"],
      terminatedAt: "2026-07-15T12:59:00.000Z",
    });

    expect(termination).toMatchObject({
      runId: V2_RUN_ID,
      successorRunId: NEW_RUN_ID,
      status: "terminated_contract_upgrade",
    });
    expect(await readFile(fixture.pointerPath)).toEqual(pointerBefore);
    expect(await readFile(fixture.oldManifestPath)).toEqual(manifestBefore);
    expect(await readJson(fixture.statePath)).toMatchObject({
      status: "terminated_contract_upgrade",
      termination: {
        successorRunId: NEW_RUN_ID,
        recoveryEntry: `test-results/${NEW_RUN_ID}/run-state.json`,
      },
    });

    const prepared = await prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv({ V1_9_PREDECESSOR_RUN_ID: V2_RUN_ID }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    });

    expect(prepared.runId).toBe(NEW_RUN_ID);
    const successorManifest = await readJson(path.join(
      fixture.rootDir, "test-results", NEW_RUN_ID, "run-manifest.json",
    ));
    expect(successorManifest.predecessor).toEqual({
      runId: V2_RUN_ID,
      relativeRunRoot: `test-results/${V2_RUN_ID}`,
      manifestSha256: fixture.oldManifestSha256,
      disposition: "terminated_contract_upgrade",
    });
  });

  it.each(["running", "completed"] as const)(
    "refuses a v2 predecessor in %s state without mutating it",
    async (status) => {
      const fixture = await createV2Fixture(status);
      const before = await snapshotTree(fixture.rootDir);

      await expect(prepareV1_9Run({
        rootDir: fixture.rootDir,
        env: prepareEnv({ V1_9_PREDECESSOR_RUN_ID: V2_RUN_ID }),
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        expectedPredecessorManifestSha256: fixture.oldManifestSha256,
        dependencies: {
          createBaselineLock: vi.fn(() => baselineLock()),
          resolveExecutionLocks: vi.fn(async () => executionLocks()),
        },
      })).rejects.toThrow(/v1_9_predecessor_state_invalid/);

      expect(await snapshotTree(fixture.rootDir)).toEqual(before);
    },
  );

  it.each([
    "journal_written",
    "manifest_staged",
    "state_staged",
    "evidence_staged",
    "run_published",
    "history_published",
    "pointer_published",
  ] as const)(
    "recovers the same successor after a %s transaction fault",
    async (phase) => {
      const fixture = await createFixture();
      const dependencies = {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: vi.fn(async (currentPhase: string) => {
          if (currentPhase === phase) throw new Error(`simulated_${phase}_fault`);
        }),
      };

      await expect(prepareV1_9Run({
        rootDir: fixture.rootDir,
        env: prepareEnv(),
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        expectedPredecessorManifestSha256: fixture.oldManifestSha256,
        dependencies,
      })).rejects.toThrow(new RegExp(`simulated_${phase}_fault`));

      dependencies.afterTransactionPhase.mockImplementation(async () => undefined);
      const recovered = await prepareV1_9Run({
        rootDir: fixture.rootDir,
        env: prepareEnv(),
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        expectedPredecessorManifestSha256: fixture.oldManifestSha256,
        dependencies,
      });
      expect(recovered.runId).toBe(NEW_RUN_ID);
      const history = await readJson(fixture.historyPath);
      expect(history.entries).toHaveLength(1);
      const names = await readdir(path.join(fixture.rootDir, "test-results"));
      expect(names).not.toContain(expect.stringMatching(/^\.v1-9-prepare-/));
      expect(names).not.toContain(".v1-9-prepare.lock");
      expect(names).not.toContain(".v1-9-prepare-transaction.json");
    },
  );

  it("allows only one concurrent prepare transaction", async () => {
    const fixture = await createFixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enteredPhase = new Promise<void>((resolve) => { entered = resolve; });
    const first = prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase !== "run_published") return;
          entered();
          await gate;
        },
      },
    });
    await enteredPhase;

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: "v1-9-20260715-concurrent",
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_prepare_locked/);

    release();
    expect((await first).runId).toBe(NEW_RUN_ID);
    expect(await existsPath(path.join(fixture.rootDir, "test-results", "v1-9-20260715-concurrent"))).toBe(false);
  });

  it("atomically takes over a dead-owner lock and recovers its valid journal", async () => {
    const fixture = await createFixture();
    const dependencies = {
      createBaselineLock: vi.fn(() => baselineLock()),
      resolveExecutionLocks: vi.fn(async () => executionLocks()),
      afterTransactionPhase: vi.fn(async (phase: string) => {
        if (phase === "run_published") throw new Error("simulated_process_crash");
      }),
    };
    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies,
    })).rejects.toThrow(/simulated_process_crash/);

    const lockRoot = path.join(fixture.rootDir, "test-results", ".v1-9-prepare.lock");
    await mkdir(lockRoot);
    await writeFile(path.join(lockRoot, "owner.json"), `${JSON.stringify({
      schemaVersion: "v1-9-prepare-lock.v1",
      pid: 2_147_483_647,
      token: "a".repeat(24),
      createdAt: CREATED_AT,
    }, null, 2)}\n`, "utf8");
    dependencies.afterTransactionPhase.mockImplementation(async () => undefined);

    const recoveryInput = {
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies,
    };
    const attempts = await Promise.allSettled([
      prepareV1_9Run(recoveryInput),
      prepareV1_9Run(recoveryInput),
    ]);
    const recovered = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ value: { runId: NEW_RUN_ID } });
    expect(await existsPath(lockRoot)).toBe(false);
    expect((await readJson(fixture.historyPath)).entries).toHaveLength(1);
  });

  it("fails contract-upgrade termination on a concurrent state byte change", async () => {
    const fixture = await createV2Fixture("running");
    const pointerBefore = await readFile(fixture.pointerPath);
    const manifestBefore = await readFile(fixture.oldManifestPath);

    await expect(terminateV1_9RunForContractUpgrade({
      rootDir: fixture.rootDir,
      predecessorRunId: V2_RUN_ID,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      successorRunId: NEW_RUN_ID,
      reasonCode: "v1_9_contract_upgrade",
      terminatedAt: "2026-07-15T12:59:00.000Z",
      dependencies: {
        beforeTerminationCommit: async () => {
          const current = await readFile(fixture.statePath);
          await writeFile(fixture.statePath, Buffer.concat([current, Buffer.from("\n")]));
        },
      },
    })).rejects.toThrow(/v1_9_predecessor_state_drift/);

    expect(await readFile(fixture.pointerPath)).toEqual(pointerBefore);
    expect(await readFile(fixture.oldManifestPath)).toEqual(manifestBefore);
    expect((await readJson(fixture.statePath)).status).toBe("running");
  });

  it("rejects completed v2 termination and raw manifest drift without writes", async () => {
    const completed = await createV2Fixture("completed");
    const completedBefore = await snapshotTree(completed.rootDir);
    await expect(terminateV1_9RunForContractUpgrade({
      rootDir: completed.rootDir,
      predecessorRunId: V2_RUN_ID,
      expectedPredecessorManifestSha256: completed.oldManifestSha256,
      successorRunId: NEW_RUN_ID,
      reasonCode: "v1_9_contract_upgrade",
      terminatedAt: "2026-07-15T12:59:00.000Z",
    })).rejects.toThrow(/v1_9_predecessor_state_invalid/);
    expect(await snapshotTree(completed.rootDir)).toEqual(completedBefore);

    const drifted = await createV2Fixture("running");
    await writeFile(drifted.oldManifestPath, Buffer.concat([
      await readFile(drifted.oldManifestPath),
      Buffer.from("\n"),
    ]));
    const driftedBefore = await snapshotTree(drifted.rootDir);
    await expect(prepareV1_9Run({
      rootDir: drifted.rootDir,
      env: prepareEnv({ V1_9_PREDECESSOR_RUN_ID: V2_RUN_ID }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: drifted.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_predecessor_manifest_digest_mismatch/);
    expect(await snapshotTree(drifted.rootDir)).toEqual(driftedBefore);
  });
});

function prepareEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    V1_9_RUN_MODE: "start-new",
    V1_9_PREDECESSOR_RUN_ID: OLD_RUN_ID,
    SHANHAI_SKILLS_SOURCE_ROOT: "E:\\authority\\shanhaiedu-skills",
    SHANHAI_SKILLS_RUNTIME_ROOT: "E:\\runtime\\a23-projection",
    ...overrides,
  };
}

function baselineLock() {
  return {
    schemaVersion: "v1-9-baseline-lock.v1" as const,
    branch: "main" as const,
    gitHead: "a".repeat(40),
    generationIntensity: "standard" as const,
    runtimeSourceDigest: "1".repeat(64),
    requirementsBaselineDigest: "2".repeat(64),
    registryDigest: "3".repeat(64),
    projectionRegistryDigest: "3".repeat(64),
    providerLedgerManifestDigest: "4".repeat(64),
    projectionId: "runtime-projection-a23-fixture",
  };
}

function executionLocks(): V1_9ResolvedExecutionLocks {
  const providerLock = {
    schemaVersion: "v1-9-provider-lock.v1" as const,
    channel: "primary" as const,
    model: "gpt-5.6-terra",
    endpointCategory: "openai_compatible_responses" as const,
    reasoningEffort: "medium" as const,
    credentialSource: "ledger_private_env" as const,
    configDigest: "5".repeat(64),
  };
  return {
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1" as const,
      projectionLockDigest: "6".repeat(64),
      bindingPolicyDigest: "7".repeat(64),
      activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    providerLock,
    providerRuntimeLocks: [
      { capability: "agent_brain", credentialSource: "ledger_private_env", configDigest: "5".repeat(64) },
      { capability: "coze_ppt", credentialSource: "ledger_private_env", configDigest: "8".repeat(64) },
      { capability: "image_generation", credentialSource: "ledger_private_env", configDigest: "9".repeat(64) },
      { capability: "tts_minimax", credentialSource: "ledger_private_env", configDigest: "a".repeat(64) },
      { capability: "video_generation", credentialSource: "ledger_private_env", configDigest: "b".repeat(64) },
    ],
    checkedBindingCount: 21,
  };
}

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-preparer-"));
  temporaryRoots.push(rootDir);
  const relativeOldRunRoot = `test-results/${OLD_RUN_ID}`;
  const oldRunRoot = path.join(rootDir, "test-results", OLD_RUN_ID);
  const oldManifestPath = path.join(oldRunRoot, "run-manifest.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const historyPath = path.join(rootDir, "test-results", "v1-9-product-e2e-history.json");
  await mkdir(oldRunRoot, { recursive: true });
  const oldManifest = `${JSON.stringify({
    schemaVersion: "v1-9-run-manifest.v1",
    runId: OLD_RUN_ID,
    relativeRunRoot: relativeOldRunRoot,
    status: "paused_recovery",
  }, null, 2)}\n`;
  await writeFile(oldManifestPath, oldManifest, "utf8");
  await writeFile(pointerPath, `${JSON.stringify({
    schemaVersion: "v1-9-active-run.v1",
    runId: OLD_RUN_ID,
    relativeRunRoot: relativeOldRunRoot,
    status: "active",
  }, null, 2)}\n`, "utf8");
  return {
    rootDir,
    oldManifestPath,
    oldManifestSha256: sha256(Buffer.from(oldManifest, "utf8")),
    pointerPath,
    historyPath,
  };
}

async function createV2Fixture(status: "running" | "completed") {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-v2-predecessor-"));
  temporaryRoots.push(rootDir);
  const relativeRunRoot = `test-results/${V2_RUN_ID}`;
  const runRoot = path.join(rootDir, "test-results", V2_RUN_ID);
  const oldManifestPath = path.join(runRoot, "run-manifest.json");
  const statePath = path.join(runRoot, "run-state.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const historyPath = path.join(rootDir, "test-results", "v1-9-product-e2e-history.json");
  const manifest = createV1_9RunManifestV2({
    runId: V2_RUN_ID,
    relativeRunRoot,
    prompt: V1_9_FROZEN_PROMPT,
    createdAt: "2026-07-15T12:00:00.000Z",
    baselineLock: baselineLock(),
    skillLock: executionLocks().skillLock,
    agentBrain: { providerLock: executionLocks().providerLock },
    providerRuntimeLocks: executionLocks().providerRuntimeLocks,
    predecessor: {
      runId: OLD_RUN_ID,
      relativeRunRoot: `test-results/${OLD_RUN_ID}`,
      manifestSha256: "c".repeat(64),
      disposition: "historical_failed",
    },
  });
  const oldManifestSha256 = createV1_9RunManifestV2Digest(manifest);
  let state = createV1_9RunState({ manifest, createdAt: "2026-07-15T12:00:00.000Z" });
  state = bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    boundAt: "2026-07-15T12:01:00.000Z",
  });
  state = bindV1_9TaskContractLock(state, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: "task-1",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-1",
    turnJobId: "turn-job-1",
    taskBriefDigest: "1".repeat(64),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: "2".repeat(64),
    budgetDigest: "3".repeat(64),
    initialPlanRevision: 0,
    boundAt: "2026-07-15T12:02:00.000Z",
  });
  if (status === "completed") {
    state = recordV1_9RunStateMutation(state, {
      method: "GET",
      pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
      source: "ui",
      recordedAt: "2026-07-15T12:10:00.000Z",
    });
    state = markV1_9RunStatePackageReady(state, {
      packageArtifactId: "package-1",
      packageArtifactVersion: 1,
      packageVersion: "course-v1",
      packageSha256: "d".repeat(64),
      turnJobId: "turn-job-1",
      teacherMessageId: "teacher-message-1",
      downloadedAt: "2026-07-15T12:10:01.000Z",
    });
    state = recordV1_9ExternalAcceptanceRound(state, {
      auditRound: 1,
      reportId: "external-acceptance-round-1",
      reportPath: "external-acceptance/round-0001/report.json",
      reportDigest: "e".repeat(64),
      packageArtifactId: "package-1",
      packageArtifactVersion: 1,
      packageVersion: "course-v1",
      packageSha256: "d".repeat(64),
      outcome: "accepted",
      reviewedFindingIds: [],
      openP0FindingIds: [],
      affectedUnits: [],
      repairFeedback: [],
      repairHandoffPath: null,
      repairHandoffDigest: null,
      generatedAt: "2026-07-15T12:20:00.000Z",
    });
  }
  await mkdir(runRoot, { recursive: true });
  await writeFile(oldManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(pointerPath, `${JSON.stringify({
    schemaVersion: "v1-9-active-run.v2",
    runId: V2_RUN_ID,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256: oldManifestSha256,
    statePath: `${relativeRunRoot}/run-state.json`,
  }, null, 2)}\n`, "utf8");
  return {
    rootDir,
    oldManifestPath,
    oldManifestSha256,
    statePath,
    pointerPath,
    historyPath,
  };
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function existsPath(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function snapshotTree(rootDir: string) {
  const entries: Array<{ path: string; content: string }> = [];
  await visit(rootDir);
  return entries.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        entries.push({
          path: path.relative(rootDir, absolute).replaceAll("\\", "/"),
          content: (await readFile(absolute)).toString("base64"),
        });
      }
    }
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
