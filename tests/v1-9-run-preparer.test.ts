import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareV1_9Run,
  terminateV1_9RunForContractUpgrade,
} from "../scripts/prepare-v1-9-run";
import {
  V1_9_FROZEN_PROMPT,
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
import { projectReadyV1_9Authority } from "./support/v1-9-authority-summary";

const OLD_RUN_ID = "v1-9-20260714212914-a036beb9";
const NEW_RUN_ID = "v1-9-20260715-a23-preparer";
const V2_RUN_ID = "v1-9-20260715-a23-active";
const CREATED_AT = "2026-07-15T13:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("V1-9 v2 run preparer", () => {
  it("creates a fresh run without a predecessor pointer, history, or predecessor environment", async () => {
    const rootDir = await createEmptyFixture();
    const result = await prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    });

    const runRoot = path.join(rootDir, "test-results", NEW_RUN_ID);
    const manifest = await readJson(path.join(runRoot, "run-manifest.json"));
    expect(manifest.predecessor).toBeNull();
    expect(manifest.promptDigest).toBe(sha256(Buffer.from(V1_9_FROZEN_PROMPT, "utf8")));
    await expect(access(path.join(runRoot, "predecessor-history-evidence.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(rootDir, "test-results", "v1-9-product-e2e-history.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readJson(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json"))).toEqual({
      schemaVersion: "v1-9-active-run.v2",
      ...result,
    });
  });

  it("creates a fresh run with opaque history only when no active pointer exists", async () => {
    const fixture = await createFreshHistoryFixture();
    const historyBytes = Buffer.from('{"legacy":"opaque-history"}\n', "utf8");
    await writeFile(fixture.historyPath, historyBytes);
    const oldManifestBytes = await readFile(fixture.oldManifestPath);

    await prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    });

    expect(await readFile(fixture.oldManifestPath)).toEqual(oldManifestBytes);
    expect(await readFile(fixture.historyPath)).toEqual(historyBytes);
    expect((await readJson(path.join(fixture.rootDir, "test-results", NEW_RUN_ID, "run-manifest.json"))).predecessor).toBeNull();
    await expect(access(path.join(fixture.rootDir, "test-results", NEW_RUN_ID, "predecessor-history-evidence.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["legacy", "v2-running", "v2-completed"] as const)(
    "refuses fresh mode when a %s active pointer already exists",
    async (kind) => {
      const fixture = kind === "legacy"
        ? await createFixture()
        : await createV2Fixture(kind === "v2-running" ? "running" : "completed");
      const before = await snapshotTree(fixture.rootDir);
      const createBaselineLock = vi.fn(() => baselineLock());
      const resolveExecutionLocks = vi.fn(async () => executionLocks());

      await expect(prepareV1_9Run({
        rootDir: fixture.rootDir,
        env: prepareEnv({
          V1_9_PREDECESSOR_RUN_ID: undefined,
          V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
        }),
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        dependencies: { createBaselineLock, resolveExecutionLocks },
      })).rejects.toThrow(/v1_9_fresh_active_pointer_conflict/);

      expect(createBaselineLock).not.toHaveBeenCalled();
      expect(resolveExecutionLocks).not.toHaveBeenCalled();
      expect(await snapshotTree(fixture.rootDir)).toEqual(before);
    },
  );

  it("preserves a competing pointer created in the final fresh publish window", async () => {
    const rootDir = await createEmptyFixture();
    const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
    const competingPointer = Buffer.from('{"schemaVersion":"external-writer","runId":"other"}\n', "utf8");

    await expect(prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "before_pointer_publish") await writeFile(pointerPath, competingPointer, { flag: "wx" });
        },
      },
    })).rejects.toThrow(/v1_9_active_pointer_drift/);

    expect(await readFile(pointerPath)).toEqual(competingPointer);
  });

  it("rejects a recovered fresh journal that claims a previous active pointer", async () => {
    const rootDir = await createEmptyFixture();
    const input = {
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: vi.fn(async (phase: string) => {
          if (phase === "journal_written") throw new Error("simulated_journal_fault");
        }),
      },
    };
    await expect(prepareV1_9Run(input)).rejects.toThrow(/simulated_journal_fault/);
    const journalPath = path.join(rootDir, "test-results", ".v1-9-prepare-transaction.json");
    const journal = await readJson(journalPath);
    journal.previousPointerSha256 = "a".repeat(64);
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    input.dependencies.afterTransactionPhase.mockImplementation(async () => undefined);

    await expect(prepareV1_9Run(input)).rejects.toThrow(/v1_9_prepare_transaction_invalid/);
    await expect(access(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  for (const kind of ["test-results", "repository-alias"] as const) {
    it(`refuses the ${kind} junction before writing outside the repository`, async (testContext) => {
      const rootDir = await createEmptyFixture();
      const outside = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-path-outside-"));
      temporaryRoots.push(outside);
      const sentinelPath = path.join(outside, "sentinel.txt");
      await writeFile(sentinelPath, "keep", "utf8");
      let configuredRoot = rootDir;
      const linkPath = kind === "test-results"
        ? path.join(rootDir, "test-results")
        : path.join(path.dirname(rootDir), `${path.basename(rootDir)}-alias`);
      try {
        await symlink(kind === "test-results" ? outside : rootDir, linkPath, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        testContext.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
        return;
      }
      if (kind === "repository-alias") {
        configuredRoot = linkPath;
        temporaryRoots.push(linkPath);
      }

      await expect(prepareV1_9Run({
        rootDir: configuredRoot,
        env: prepareEnv({
          V1_9_PREDECESSOR_RUN_ID: undefined,
          V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
        }),
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        dependencies: {
          createBaselineLock: vi.fn(() => baselineLock()),
          resolveExecutionLocks: vi.fn(async () => executionLocks()),
        },
      })).rejects.toThrow(/v1_9_prepare_path_unsafe/);

      expect(await readFile(sentinelPath, "utf8")).toBe("keep");
      expect((await readdir(outside)).sort()).toEqual(["sentinel.txt"]);
    });
  }

  it("rechecks the staged root after a phase hook replaces it with a junction", async (testContext) => {
    const rootDir = await createEmptyFixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-stage-outside-"));
    temporaryRoots.push(outside);
    const sentinelPath = path.join(outside, "sentinel.txt");
    await writeFile(sentinelPath, "keep", "utf8");
    const probe = path.join(rootDir, "junction-probe");
    try {
      await symlink(outside, probe, process.platform === "win32" ? "junction" : "dir");
      await rm(probe);
    } catch (error) {
      testContext.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return;
    }

    await expect(prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase !== "manifest_staged") return;
          const resultsRoot = path.join(rootDir, "test-results");
          const temporaryName = (await readdir(resultsRoot)).find((name) => name.startsWith(".v1-9-prepare-v1-9-"));
          if (!temporaryName) throw new Error("temporary_root_missing");
          const temporaryRoot = path.join(resultsRoot, temporaryName);
          await rm(temporaryRoot, { recursive: true });
          await symlink(outside, temporaryRoot, process.platform === "win32" ? "junction" : "dir");
        },
      },
    })).rejects.toThrow(/v1_9_prepare_path_unsafe/);

    expect(await readFile(sentinelPath, "utf8")).toBe("keep");
    expect((await readdir(outside)).sort()).toEqual(["sentinel.txt"]);
  });

  it.each([
    [OLD_RUN_ID, undefined],
    [undefined, "f".repeat(64)],
  ])("rejects partial predecessor identity before any write", async (predecessorRunId, predecessorManifestSha256) => {
    const rootDir = await createEmptyFixture();
    const before = await snapshotTree(rootDir);
    await expect(prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: predecessorRunId,
        V1_9_PREDECESSOR_MANIFEST_SHA256: predecessorManifestSha256,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_predecessor_pair_invalid/);
    expect(await snapshotTree(rootDir)).toEqual(before);
  });

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
    const frozenBaseline = baselineLock();
    const createBaselineLock = vi.fn(() => frozenBaseline);
    const assertCurrentBaselineLock = vi.fn(() => frozenBaseline);
    const resolveExecutionLocks = vi.fn(async () => executionLocks());

    const result = await prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: { createBaselineLock, assertCurrentBaselineLock, resolveExecutionLocks },
    });

    expect(createBaselineLock).toHaveBeenCalledOnce();
    expect(createBaselineLock).toHaveBeenCalledWith({
      cwd: fixture.rootDir,
      env: expect.objectContaining({
        SHANHAI_SKILLS_SOURCE_ROOT: "E:\\authority\\shanhaiedu-skills",
      }),
    });
    expect(assertCurrentBaselineLock).toHaveBeenCalledTimes(6);
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
      schemaVersion: "v1-9-run-state.v3",
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
    "staged",
    "run_published",
    "before_pointer_publish",
    "pointer_published",
  ] as const)(
    "recovers the same fresh run after a %s transaction fault",
    async (phase) => {
      const fixture = await createFreshHistoryFixture();
      const rootDir = fixture.rootDir;
      const historyBytes = Buffer.from('{"legacy":"opaque-history"}\n', "utf8");
      await writeFile(fixture.historyPath, historyBytes);
      const oldManifestBytes = await readFile(fixture.oldManifestPath);
      const env = prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      });
      const dependencies = {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: vi.fn(async (currentPhase: string) => {
          if (currentPhase === phase) throw new Error(`simulated_fresh_${phase}_fault`);
        }),
      };

      await expect(prepareV1_9Run({
        rootDir,
        env,
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        dependencies,
      })).rejects.toThrow(new RegExp(`simulated_fresh_${phase}_fault`));

      expect(await readFile(fixture.oldManifestPath)).toEqual(oldManifestBytes);
      expect(await readFile(fixture.historyPath)).toEqual(historyBytes);
      const pointerAfterFault = await readFile(fixture.pointerPath).catch(() => null);
      if (phase === "pointer_published") {
        expect(JSON.parse(pointerAfterFault!.toString("utf8"))).toMatchObject({ runId: NEW_RUN_ID });
      } else {
        expect(pointerAfterFault).toBeNull();
      }

      dependencies.afterTransactionPhase.mockImplementation(async () => undefined);
      const recovered = await prepareV1_9Run({
        rootDir,
        env,
        runId: NEW_RUN_ID,
        createdAt: CREATED_AT,
        dependencies,
      });
      expect(recovered.runId).toBe(NEW_RUN_ID);
      expect((await readJson(path.join(rootDir, recovered.manifestPath))).predecessor).toBeNull();
      expect(await readFile(fixture.oldManifestPath)).toEqual(oldManifestBytes);
      expect(await readFile(fixture.historyPath)).toEqual(historyBytes);
      expect(await readJson(fixture.pointerPath)).toMatchObject({ runId: NEW_RUN_ID });
      await expect(access(path.join(rootDir, recovered.relativeRunRoot, "predecessor-history-evidence.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      const names = await readdir(path.join(rootDir, "test-results"));
      expect(names).not.toContain(expect.stringMatching(/^\.v1-9-prepare-/));
      expect(names).not.toContain(".v1-9-prepare.lock");
      expect(names).not.toContain(".v1-9-prepare-transaction.json");
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

  it("rejects recovery when published successor evidence no longer matches the journal", async () => {
    const fixture = await createFixture();
    const pointerBefore = await readFile(fixture.pointerPath);
    const dependencies = {
      createBaselineLock: vi.fn(() => baselineLock()),
      resolveExecutionLocks: vi.fn(async () => executionLocks()),
      afterTransactionPhase: vi.fn(async (phase: string) => {
        if (phase !== "run_published") return;
        await writeFile(
          path.join(fixture.rootDir, "test-results", NEW_RUN_ID, "predecessor-history-evidence.json"),
          '{"schemaVersion":"tampered"}\n',
          "utf8",
        );
        throw new Error("simulated_successor_evidence_crash");
      }),
    };
    const input = {
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies,
    };

    await expect(prepareV1_9Run(input)).rejects.toThrow(/simulated_successor_evidence_crash/);
    dependencies.afterTransactionPhase.mockImplementation(async () => undefined);
    await expect(prepareV1_9Run(input)).rejects.toThrow(/v1_9_prepare_transaction_evidence_invalid/);

    expect(await readFile(fixture.pointerPath)).toEqual(pointerBefore);
    expect(await existsPath(path.join(
      fixture.rootDir,
      "test-results",
      ".v1-9-prepare-transaction.json",
    ))).toBe(true);
  });

  it("rejects recovery when a published fresh run gains predecessor evidence", async () => {
    const rootDir = await createEmptyFixture();
    const dependencies = {
      createBaselineLock: vi.fn(() => baselineLock()),
      resolveExecutionLocks: vi.fn(async () => executionLocks()),
      afterTransactionPhase: vi.fn(async (phase: string) => {
        if (phase !== "run_published") return;
        await writeFile(
          path.join(rootDir, "test-results", NEW_RUN_ID, "predecessor-history-evidence.json"),
          '{}\n',
          "utf8",
        );
        throw new Error("simulated_fresh_evidence_crash");
      }),
    };
    const input = {
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies,
    };

    await expect(prepareV1_9Run(input)).rejects.toThrow(/simulated_fresh_evidence_crash/);
    dependencies.afterTransactionPhase.mockImplementation(async () => undefined);
    await expect(prepareV1_9Run(input)).rejects.toThrow(/v1_9_prepare_transaction_evidence_invalid/);

    expect(await existsPath(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json"))).toBe(false);
  });

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

  it("selects one dead-owner takeover claimant before quarantining the lock", async () => {
    const fixture = await createFixture();
    const lockRoot = path.join(fixture.rootDir, "test-results", ".v1-9-prepare.lock");
    await mkdir(lockRoot);
    await writeFile(path.join(lockRoot, "owner.json"), `${JSON.stringify({
      schemaVersion: "v1-9-prepare-lock.v1",
      pid: 2_147_483_647,
      token: "a".repeat(24),
      createdAt: CREATED_AT,
    }, null, 2)}\n`, "utf8");
    let releaseClaim!: () => void;
    let markClaimed!: () => void;
    const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const claimed = new Promise<void>((resolve) => { markClaimed = resolve; });
    const first = prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterLockTakeoverClaimed: async () => {
          markClaimed();
          await claimGate;
        },
      },
    });
    await claimed;

    expect((await readJson(path.join(lockRoot, "owner.json"))).token).toBe("a".repeat(24));
    expect(await existsPath(path.join(lockRoot, "takeover-claim.json"))).toBe(true);
    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: "v1-9-20260715-second-claimant",
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_prepare_locked/);
    expect((await readJson(path.join(lockRoot, "owner.json"))).token).toBe("a".repeat(24));

    releaseClaim();
    expect((await first).runId).toBe(NEW_RUN_ID);
    expect(await existsPath(lockRoot)).toBe(false);
  });

  it("recovers a takeover claim abandoned by a dead claimant", async () => {
    const fixture = await createFixture();
    const lockRoot = path.join(fixture.rootDir, "test-results", ".v1-9-prepare.lock");
    await mkdir(lockRoot);
    await writeFile(path.join(lockRoot, "owner.json"), `${JSON.stringify({ schemaVersion: "v1-9-prepare-lock.v1",
      pid: 2_147_483_647, token: "a".repeat(24), createdAt: CREATED_AT }, null, 2)}\n`, "utf8");
    await writeFile(path.join(lockRoot, "takeover-claim.json"), `${JSON.stringify({ schemaVersion: "v1-9-prepare-lock-takeover-claim.v1", claimantPid: 2_147_483_646, claimantToken: "b".repeat(24), expectedOwnerToken: "a".repeat(24), createdAt: CREATED_AT }, null, 2)}\n`, "utf8");

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
    })).resolves.toMatchObject({ runId: NEW_RUN_ID });
    expect(await existsPath(lockRoot)).toBe(false);
  });

  it("preserves a concurrent history update and recovers only after the original bytes return", async () => {
    const fixture = await createFixture();
    const pointerBefore = await readFile(fixture.pointerPath);
    const concurrentHistory = Buffer.from('{"schemaVersion":"v1-9-run-history.v1","entries":[]}\n', "utf8");

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "run_published") await writeFile(fixture.historyPath, concurrentHistory, { flag: "wx" });
        },
      },
    })).rejects.toThrow(/v1_9_run_history_drift/);

    expect(await readFile(fixture.historyPath)).toEqual(concurrentHistory);
    expect(await readFile(fixture.pointerPath)).toEqual(pointerBefore);
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
    })).rejects.toThrow(/v1_9_prepare_transaction_conflict/);

    await rm(fixture.historyPath);
    const recovered = await prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    });
    expect(recovered.runId).toBe(NEW_RUN_ID);
  });

  it("preserves a competing successor pointer written in the final cooperative CAS window", async () => {
    const fixture = await createFixture();
    const competingPointer = Buffer.from('{"schemaVersion":"external-writer","runId":"other"}\n', "utf8");

    await expect(prepareV1_9Run({
      rootDir: fixture.rootDir,
      env: prepareEnv(),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      expectedPredecessorManifestSha256: fixture.oldManifestSha256,
      dependencies: {
        createBaselineLock: vi.fn(() => baselineLock()),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "before_pointer_publish") await writeFile(fixture.pointerPath, competingPointer);
        },
      },
    })).rejects.toThrow(/v1_9_active_pointer_drift/);

    expect(await readFile(fixture.pointerPath)).toEqual(competingPointer);
  });

  it("revalidates the baseline after run publication before publishing an active pointer", async () => {
    const rootDir = await createEmptyFixture();
    let checks = 0;
    const expected = baselineLock();

    await expect(prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => {
          checks += 1;
          if (checks === 2) throw new Error("v1_9_baseline_lock_drift");
          return expected;
        }),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_baseline_lock_drift/);

    expect(checks).toBe(2);
    await expect(access(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates the baseline after the final pointer hook", async () => {
    const rootDir = await createEmptyFixture();
    const expected = baselineLock();
    let drifted = false;

    await expect(prepareV1_9Run({
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => {
          if (drifted) throw new Error("v1_9_baseline_lock_drift");
          return expected;
        }),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "before_pointer_publish") drifted = true;
        },
      },
    })).rejects.toThrow(/v1_9_baseline_lock_drift/);

    await expect(access(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates the baseline before a crashed fresh transaction can publish its pointer", async () => {
    const rootDir = await createEmptyFixture();
    const expected = baselineLock();
    const firstDependencies = {
      createBaselineLock: vi.fn(() => expected),
      assertCurrentBaselineLock: vi.fn(() => expected),
      resolveExecutionLocks: vi.fn(async () => executionLocks()),
      afterTransactionPhase: vi.fn(async (phase: string) => {
        if (phase === "run_published") throw new Error("simulated_crash_before_pointer");
      }),
    };
    const input = {
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
    };
    await expect(prepareV1_9Run({ ...input, dependencies: firstDependencies }))
      .rejects.toThrow(/simulated_crash_before_pointer/);

    await expect(prepareV1_9Run({
      ...input,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => { throw new Error("v1_9_baseline_lock_drift"); }),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_baseline_lock_drift/);
    await expect(access(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not finalize recovery after a pointer-published crash when baseline evidence drifts", async () => {
    const rootDir = await createEmptyFixture();
    const expected = baselineLock();
    const input = {
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
    };
    await expect(prepareV1_9Run({
      ...input,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => expected),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "pointer_published") throw new Error("simulated_pointer_published_crash");
        },
      },
    })).rejects.toThrow(/simulated_pointer_published_crash/);

    const journalPath = path.join(rootDir, "test-results", ".v1-9-prepare-transaction.json");
    expect((await readJson(path.join(rootDir, "test-results", "v1-9-product-e2e-active.json"))).runId).toBe(NEW_RUN_ID);
    await expect(prepareV1_9Run({
      ...input,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => { throw new Error("v1_9_baseline_lock_drift"); }),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_baseline_lock_drift/);
    expect(await access(journalPath).then(() => true)).toBe(true);
  });

  it("rejects recovery when the published pointer is semantically equal but byte-different", async () => {
    const rootDir = await createEmptyFixture();
    const expected = baselineLock();
    const input = {
      rootDir,
      env: prepareEnv({
        V1_9_PREDECESSOR_RUN_ID: undefined,
        V1_9_PREDECESSOR_MANIFEST_SHA256: undefined,
      }),
      runId: NEW_RUN_ID,
      createdAt: CREATED_AT,
    };
    await expect(prepareV1_9Run({
      ...input,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => expected),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
        afterTransactionPhase: async (phase) => {
          if (phase === "pointer_published") throw new Error("simulated_pointer_published_crash");
        },
      },
    })).rejects.toThrow(/simulated_pointer_published_crash/);

    const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
    const journalPath = path.join(rootDir, "test-results", ".v1-9-prepare-transaction.json");
    const semanticPointer = await readJson(pointerPath);
    const byteDifferentPointer = Buffer.from(`${JSON.stringify(semanticPointer)}\n`, "utf8");
    await writeFile(pointerPath, byteDifferentPointer);

    await expect(prepareV1_9Run({
      ...input,
      dependencies: {
        createBaselineLock: vi.fn(() => expected),
        assertCurrentBaselineLock: vi.fn(() => expected),
        resolveExecutionLocks: vi.fn(async () => executionLocks()),
      },
    })).rejects.toThrow(/v1_9_prepare_transaction_conflict/);
    expect(await readFile(pointerPath)).toEqual(byteDifferentPointer);
    expect(await access(journalPath).then(() => true)).toBe(true);
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
          expect(await existsPath(path.join(
            fixture.rootDir,
            "test-results",
            ".v1-9-prepare.lock",
          ))).toBe(true);
          const current = await readFile(fixture.statePath);
          await writeFile(fixture.statePath, Buffer.concat([current, Buffer.from("\n")]));
        },
      },
    })).rejects.toThrow(/v1_9_predecessor_state_drift/);

    expect(await readFile(fixture.pointerPath)).toEqual(pointerBefore);
    expect(await readFile(fixture.oldManifestPath)).toEqual(manifestBefore);
    expect((await readJson(fixture.statePath)).status).toBe("running");
    expect(await existsPath(path.join(
      fixture.rootDir,
      "test-results",
      ".v1-9-prepare.lock",
    ))).toBe(false);
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
    schemaVersion: "v1-9-baseline-lock.v2" as const,
    branch: "main" as const,
    gitHead: "a".repeat(40),
    generationIntensity: "standard" as const,
    runtimeSourceDigest: "1".repeat(64),
    requirementsBaselineDigest: "2".repeat(64),
    registryDigest: "3".repeat(64),
    projectionRegistryDigest: "3".repeat(64),
    providerLedgerManifestDigest: "4".repeat(64),
    projectionId: "runtime-projection-a23-fixture",
    verificationManifestSha256: "5".repeat(64),
    workingTreeDigest: "6".repeat(64),
    policySha256: "7".repeat(64),
    stageSha256: "8".repeat(64),
    providerContinuityManifestSha256: "b".repeat(64),
    providerContinuityReceiptSha256: "9".repeat(64),
    providerContinuityEvidenceRootDigest: "c".repeat(64),
    providerContinuitySubjectDigest: "a".repeat(64),
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

async function createEmptyFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-fresh-preparer-"));
  temporaryRoots.push(rootDir);
  return rootDir;
}

async function createFreshHistoryFixture() {
  const rootDir = await createEmptyFixture();
  const runRoot = path.join(rootDir, "test-results", OLD_RUN_ID);
  const oldManifestPath = path.join(runRoot, "run-manifest.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const historyPath = path.join(rootDir, "test-results", "v1-9-product-e2e-history.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(oldManifestPath, `${JSON.stringify({
    schemaVersion: "v1-9-run-manifest.v1",
    runId: OLD_RUN_ID,
    relativeRunRoot: `test-results/${OLD_RUN_ID}`,
    status: "failed",
  }, null, 2)}\n`, "utf8");
  return { rootDir, oldManifestPath, pointerPath, historyPath };
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
    state = markV1_9RunStatePackageReady(projectReadyV1_9Authority(state), {
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
