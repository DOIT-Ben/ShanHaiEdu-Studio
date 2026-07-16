import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createOpenAICompatibleConfigDigest } from "../src/server/openai-compatible-config";
import {
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStatePackageReady,
  markV1_9RunStateRecoveryStop,
  recordV1_9ExternalAcceptanceRound,
  recordV1_9RunStateMutation,
  type V1_9ProviderLock,
  type V1_9ProviderRuntimeLock,
  type V1_9RunManifestV2,
  type V1_9RunState,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import {
  runV1_9ProductPreflight,
  serializeV1_9ProductPreflight,
  type V1_9ProductPreflightDependencies,
} from "../scripts/v1-9-product-preflight";
import {
  createV1_9NpmListInvocation,
  evaluateV1_9InstalledTreeProbe,
} from "../scripts/lib/v1-9-installed-tree.mjs";

const runId = "v1-9-20260715090000-fixture";
const relativeRunRoot = `test-results/${runId}`;

describe("V1-9 product preflight", () => {
  it("runs through the same tsx CLI boundary used by the unique V1-9 runner", () => {
    const result = spawnSync(process.execPath, [
      path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
      path.resolve("scripts", "v1-9-product-preflight.ts"),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, M67_E2E_DETERMINISTIC: "1" },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(/Transform failed|Top-level await/i);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      providerRequestCount: 0,
      failureReasonCodes: ["v1_9_deterministic_runtime_forbidden"],
    });
  });

  it.each([
    "M67_E2E_DETERMINISTIC",
    "SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT",
    "SHANHAI_E2E_DETERMINISTIC_RUNTIME",
  ])("fails before any eager or external boundary when %s is enabled", async (name) => {
    const dependencies = readyDependencies();

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: { [name]: "1" },
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report).toMatchObject({
      ok: false,
      providerRequestCount: 0,
      failureReasonCodes: ["v1_9_deterministic_runtime_forbidden"],
      checks: [{
        id: "profile-deterministic-disabled",
        ok: false,
        reasonCode: "v1_9_deterministic_runtime_forbidden",
      }],
    });
    expect(dependencies.preflightSkills).not.toHaveBeenCalled();
    expect(dependencies.resolveProviderValueBag).not.toHaveBeenCalled();
    expect(dependencies.probeInstalledTree).not.toHaveBeenCalled();
    expect(dependencies.probeBinary).not.toHaveBeenCalled();
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("validates immutable v2 manifest, separate state, baseline, Skills, five Provider summaries, binaries and storage without writes or Provider calls", async () => {
    const manifest = readyManifest();
    const state = readyRunState(manifest);
    const dependencies = readyDependencies({ manifest, state });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(report.providerRequestCount).toBe(0);
    expect(report.failureReasonCodes).toEqual([]);
    expect(dependencies.preflightSkills).toHaveBeenCalledWith(expect.objectContaining({ mode: "required" }));
    expect(dependencies.probeInstalledTree).toHaveBeenCalledWith({
      cwd: fixtureCwd(),
      env: {},
    });
    expect(dependencies.resolveProviderValueBag.mock.calls.map(([input]) => input.capability)).toEqual([
      "agent_brain",
      "coze_ppt",
      "image_generation",
      "video_generation",
      "tts_minimax",
    ]);
    expect(dependencies.probeBinary.mock.calls.map(([command]) => command)).toEqual([
      "ffmpeg",
      "ffprobe",
      "soffice",
      "pdfinfo",
      "pdftoppm",
      "fc-match",
    ]);
    expect(dependencies.assertCurrentBaselineLock).toHaveBeenCalledWith(
      manifest.baselineLock,
      expect.objectContaining({ cwd: fixtureCwd() }),
    );
    expect(dependencies.probeRunStorage).toHaveBeenCalledWith({
      runRoot: path.join(fixtureCwd(), ...relativeRunRoot.split("/")),
      databasePath: path.join(fixtureCwd(), ...relativeRunRoot.split("/"), "m67.sqlite"),
      artifactRoot: path.join(fixtureCwd(), ...relativeRunRoot.split("/"), "artifact-storage"),
    });
    expect(manifest).toEqual(readyManifest());
    expect(state).toEqual(readyRunState(readyManifest()));
    expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      "skill-runtime-required",
      "provider-ledger-agent-brain",
      "provider-ledger-coze-ppt",
      "provider-ledger-image-generation",
      "provider-ledger-video-generation",
      "provider-ledger-tts-minimax",
      "binary-ffmpeg",
      "binary-ffprobe",
      "binary-soffice",
      "runtime-installed-tree",
      "run-manifest-identity",
      "run-baseline-current",
      "run-manifest-skill-lock",
      "run-manifest-provider-locks",
      "runtime-storage",
    ]));
    const identityOrder = Math.max(
      ...dependencies.readJson.mock.invocationCallOrder,
      ...dependencies.readBytes.mock.invocationCallOrder,
    );
    const baselineOrder = dependencies.assertCurrentBaselineLock.mock.invocationCallOrder[0];
    const installedTreeOrder = dependencies.probeInstalledTree.mock.invocationCallOrder[0];
    const skillOrder = dependencies.preflightSkills.mock.invocationCallOrder[0];
    const providerOrder = dependencies.resolveProviderValueBag.mock.invocationCallOrder[0];
    const binaryOrder = dependencies.probeBinary.mock.invocationCallOrder[0];
    expect(identityOrder).toBeLessThan(baselineOrder);
    expect(baselineOrder).toBeLessThan(installedTreeOrder);
    expect(installedTreeOrder).toBeLessThan(skillOrder);
    expect(skillOrder).toBeLessThan(providerOrder);
    expect(providerOrder).toBeLessThan(binaryOrder);
  });

  it("accepts only lock-backed optional extraneous packages without exposing their path", async () => {
    const dependencies = readyDependencies();
    dependencies.probeInstalledTree.mockResolvedValueOnce({
      ok: true,
      allowedOptionalExtraneousCount: 1,
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual({
      id: "runtime-installed-tree",
      ok: true,
      allowedOptionalExtraneousCount: 1,
    });
    expect(serializeV1_9ProductPreflight(report)).not.toMatch(/node_modules|@emnapi|Users|private/i);
  });

  it("fails closed with one stable installed-tree reason and no raw npm detail", async () => {
    const dependencies = readyDependencies();
    dependencies.probeInstalledTree.mockRejectedValueOnce(
      new Error("missing private package at C:\\Users\\Teacher\\node_modules token=private"),
    );

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });
    const serialized = serializeV1_9ProductPreflight(report);

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toEqual(["v1_9_installed_tree_invalid"]);
    expect(report.checks).toContainEqual({
      id: "runtime-installed-tree",
      ok: false,
      reasonCode: "v1_9_installed_tree_invalid",
      allowedOptionalExtraneousCount: 0,
    });
    expect(serialized).not.toMatch(/Teacher|node_modules|token=private|missing private/i);
    expect(dependencies.readJson).toHaveBeenCalledWith(fixturePointerPath());
    expect(dependencies.readBytes).toHaveBeenCalledWith(fixtureManifestPath());
    expect(dependencies.assertCurrentBaselineLock).toHaveBeenCalled();
    expect(dependencies.preflightSkills).not.toHaveBeenCalled();
    expect(dependencies.resolveProviderValueBag).not.toHaveBeenCalled();
    expect(dependencies.probeBinary).not.toHaveBeenCalled();
  });

  it("strictly evaluates npm ls output and permits the current lock-backed optional residue", () => {
    const installedPath = path.join(fixtureCwd(), "node_modules", "@emnapi", "runtime");
    const result = evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      commandStatus: 0,
      stdout: JSON.stringify({
        name: "fixture",
        problems: [`extraneous: @emnapi/runtime@1.11.2 ${installedPath}`],
      }),
      packageLock: readyInstalledTreeLock(),
    });

    expect(result).toEqual({ ok: true, allowedOptionalExtraneousCount: 1 });
  });

  it("pins npm ls to the physical local tree and removes ambient npm tree semantics", () => {
    const invocation = createV1_9NpmListInvocation({
      cwd: fixtureCwd(),
      execPath: "C:\\runtime\\node.exe",
      npmCliPath: "C:\\runtime\\node_modules\\npm\\bin\\npm-cli.js",
      env: {
        Path: "C:\\runtime",
        SystemRoot: "C:\\Windows",
        SHANHAI_TEST_SENTINEL: "preserved",
        npm_config_package_lock_only: "true",
        NPM_CONFIG_OMIT: "dev",
        NpM_CoNfIg_Global: "true",
        npm_config_workspaces: "true",
        NPM_CONFIG_LINK: "true",
        NODE_ENV: "production",
        node_env: "development",
        NODE_OPTIONS: "--require=C:\\private\\tree-hook.js",
        Node_Path: "C:\\private\\node_modules",
      },
    });

    expect(invocation).not.toBeNull();
    expect(invocation?.args).toEqual([
      "C:\\runtime\\node_modules\\npm\\bin\\npm-cli.js",
      "ls",
      "--all",
      "--json",
      "--long=true",
      "--package-lock-only=false",
      "--global=false",
      "--workspaces=false",
      "--link=false",
      "--include=prod",
      "--include=dev",
      "--include=optional",
      "--include=peer",
      "--ignore-scripts=true",
      "--offline=true",
      "--prefix=.",
    ]);
    expect(invocation?.options.env).toMatchObject({
      Path: "C:\\runtime",
      SystemRoot: "C:\\Windows",
      SHANHAI_TEST_SENTINEL: "preserved",
    });
    expect(invocation?.options).toMatchObject({
      cwd: fixtureCwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(Object.keys(invocation?.options.env ?? {})).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^npm_config_/i),
      expect.stringMatching(/^(?:node_env|node_options|node_path)$/i),
    ]));
  });

  it("requires the long npm tree shape and rejects a link signal even when the lock entry matches", () => {
    const invocation = createV1_9NpmListInvocation({
      cwd: fixtureCwd(),
      execPath: "C:\\runtime\\node.exe",
      npmCliPath: "C:\\runtime\\node_modules\\npm\\bin\\npm-cli.js",
      env: {},
    });
    expect(invocation?.args).toContain("--long=true");
    expect(evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      commandStatus: 0,
      stdout: JSON.stringify({
        path: fixtureCwd(),
        dependencies: {
          linked: {
            name: "linked",
            version: "1.0.0",
            path: path.join(fixtureCwd(), "node_modules", "linked"),
            link: true,
          },
        },
      }),
      packageLock: {
        lockfileVersion: 3,
        packages: {
          "": { name: "fixture", version: "1.0.0" },
          "node_modules/linked": { version: "1.0.0" },
        },
      },
    })).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
  });

  it("rejects a real package-root junction even when dependency and lock paths match", (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "v1-9-installed-tree-junction-"));
    const outside = path.join(root, "outside");
    const nodeModules = path.join(root, "node_modules");
    const linked = path.join(nodeModules, "linked");
    mkdirSync(outside, { recursive: true });
    mkdirSync(nodeModules, { recursive: true });
    try {
      try {
        symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
        return;
      }
      expect(evaluateV1_9InstalledTreeProbe({
        cwd: root,
        commandStatus: 0,
        stdout: JSON.stringify({
          path: root,
          dependencies: {
            linked: {
              name: "linked",
              version: "1.0.0",
              path: linked,
            },
          },
        }),
        packageLock: {
          lockfileVersion: 3,
          packages: {
            "": { name: "fixture", version: "1.0.0" },
            "node_modules/linked": { version: "1.0.0" },
          },
        },
      })).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an otherwise allowed optional extraneous package when its physical root is a junction", (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "v1-9-installed-tree-optional-junction-"));
    const outside = path.join(root, "outside");
    const scopeRoot = path.join(root, "node_modules", "@emnapi");
    const linked = path.join(scopeRoot, "runtime");
    mkdirSync(outside, { recursive: true });
    mkdirSync(scopeRoot, { recursive: true });
    try {
      try {
        symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
        return;
      }
      expect(evaluateV1_9InstalledTreeProbe({
        cwd: root,
        commandStatus: 1,
        stdout: JSON.stringify({
          path: root,
          problems: [`extraneous: @emnapi/runtime@1.11.2 ${linked}`],
          dependencies: {
            "@emnapi/runtime": {
              name: "@emnapi/runtime",
              version: "1.11.2",
              path: linked,
              extraneous: true,
            },
          },
        }),
        packageLock: readyInstalledTreeLock(),
      })).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a physical hoisted, nested, scoped dependency tree with exact lock paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "v1-9-installed-tree-physical-"));
    const paths = {
      hoisted: path.join(root, "node_modules", "hoisted"),
      parent: path.join(root, "node_modules", "parent"),
      nested: path.join(root, "node_modules", "parent", "node_modules", "@scope", "nested"),
    };
    Object.values(paths).forEach((entry) => mkdirSync(entry, { recursive: true }));
    try {
      expect(evaluateV1_9InstalledTreeProbe({
        cwd: root,
        commandStatus: 0,
        stdout: JSON.stringify({
          path: root,
          dependencies: {
            hoisted: { name: "hoisted", version: "1.0.0", path: paths.hoisted },
            parent: {
              name: "parent",
              version: "2.0.0",
              path: paths.parent,
              dependencies: {
                "@scope/nested": {
                  name: "@scope/nested",
                  version: "3.0.0",
                  path: paths.nested,
                },
              },
            },
          },
        }),
        packageLock: {
          lockfileVersion: 3,
          packages: {
            "": { name: "fixture", version: "1.0.0" },
            "node_modules/hoisted": { version: "1.0.0" },
            "node_modules/parent": { version: "2.0.0" },
            "node_modules/parent/node_modules/@scope/nested": { version: "3.0.0" },
          },
        },
      })).toEqual({ ok: true, allowedOptionalExtraneousCount: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only lock-confirmed omitted optional dependencies represented by empty npm nodes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "v1-9-installed-tree-omitted-optional-"));
    const npmTree = {
      path: root,
      optionalDependencies: { "optional-runtime": "1.0.0" },
      dependencies: { "optional-runtime": {} },
    };
    const packageLock = {
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture",
          version: "1.0.0",
          optionalDependencies: { "optional-runtime": "1.0.0" },
        },
      },
    };
    try {
      expect(evaluateV1_9InstalledTreeProbe({
        cwd: root,
        commandStatus: 0,
        stdout: JSON.stringify(npmTree),
        packageLock,
      })).toEqual({ ok: true, allowedOptionalExtraneousCount: 0 });
      expect(evaluateV1_9InstalledTreeProbe({
        cwd: root,
        commandStatus: 0,
        stdout: JSON.stringify({ path: root, dependencies: { "optional-runtime": {} } }),
        packageLock,
      })).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["devOptional with integrity", readyInstalledTreeLock({ optional: false, devOptional: true })],
    ["optional in-bundle", readyInstalledTreeLock({ integrity: undefined, inBundle: true })],
  ])("accepts a locked %s extraneous package", (_label, packageLock) => {
    const installedPath = path.join(fixtureCwd(), "node_modules", "@emnapi", "runtime");
    expect(evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      commandStatus: 0,
      stdout: JSON.stringify({
        problems: [`extraneous: @emnapi/runtime@1.11.2 ${installedPath}`],
      }),
      packageLock,
    })).toEqual({ ok: true, allowedOptionalExtraneousCount: 1 });
  });

  it.each([
    ["top-level unscoped", "node_modules/optional-runtime", "optional-runtime"],
    ["nested unscoped", "node_modules/parent/node_modules/optional-runtime", "optional-runtime"],
    ["nested scoped", "node_modules/parent/node_modules/@fixture/optional-runtime", "@fixture/optional-runtime"],
  ])("accepts a lock-backed %s package at its exact nested path", (_label, lockPath, packageName) => {
    const packageLock = readyInstalledTreeLock();
    const packages = packageLock.packages as Record<string, Record<string, unknown>>;
    packages[lockPath] = {
      version: "2.0.0",
      optional: true,
      integrity: "sha512-nested-fixture",
    };

    expect(evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      commandStatus: 0,
      stdout: JSON.stringify({
        problems: [`extraneous: ${packageName}@2.0.0 ${path.join(fixtureCwd(), ...lockPath.split("/"))}`],
      }),
      packageLock,
    })).toEqual({ ok: true, allowedOptionalExtraneousCount: 1 });
  });

  it.each([
    ["non-zero exit", { commandStatus: 1, stdout: JSON.stringify({ problems: [] }) }],
    ["timeout or spawn error", { commandStatus: null, commandError: new Error("timed out"), stdout: "" }],
    ["invalid JSON", { commandStatus: 0, stdout: "not-json" }],
    ["npm error payload", { commandStatus: 0, stdout: JSON.stringify({ error: { code: "ELSPROBLEMS" }, problems: [] }) }],
    ["invalid problems shape", { commandStatus: 0, stdout: JSON.stringify({ problems: "private" }) }],
    ["missing dependency", { commandStatus: 0, stdout: JSON.stringify({ problems: ["missing: required-package@1.0.0, required by fixture@1.0.0"] }) }],
    ["invalid dependency", { commandStatus: 0, stdout: JSON.stringify({ problems: ["invalid: required-package@0.9.0 C:\\private"] }) }],
    ["missing peer dependency", { commandStatus: 0, stdout: JSON.stringify({ problems: ["missing: peer-package@^2, required by fixture@1.0.0"] }) }],
    ["unlocked extraneous", {
      commandStatus: 0,
      stdout: JSON.stringify({ problems: [`extraneous: unlocked-package@1.0.0 ${path.join(fixtureCwd(), "node_modules", "unlocked-package")}`] }),
    }],
    ["extraneous outside the repository", {
      commandStatus: 0,
      stdout: JSON.stringify({ problems: [`extraneous: @emnapi/runtime@1.11.2 ${path.resolve(fixtureCwd(), "..", "outside", "node_modules", "@emnapi", "runtime")}`] }),
    }],
    ["wrong extraneous version", {
      commandStatus: 0,
      stdout: JSON.stringify({ problems: [`extraneous: @emnapi/runtime@9.9.9 ${path.join(fixtureCwd(), "node_modules", "@emnapi", "runtime")}`] }),
    }],
    ["non-optional extraneous", {
      commandStatus: 0,
      stdout: JSON.stringify({ problems: [`extraneous: @emnapi/runtime@1.11.2 ${path.join(fixtureCwd(), "node_modules", "@emnapi", "runtime")}`] }),
      packageLock: readyInstalledTreeLock({ optional: false }),
    }],
    ["extraneous without integrity", {
      commandStatus: 0,
      stdout: JSON.stringify({ problems: [`extraneous: @emnapi/runtime@1.11.2 ${path.join(fixtureCwd(), "node_modules", "@emnapi", "runtime")}`] }),
      packageLock: readyInstalledTreeLock({ integrity: undefined }),
    }],
  ])("rejects %s installed-tree evidence", (_label, evidence) => {
    const result = evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      packageLock: readyInstalledTreeLock(),
      ...evidence,
    });

    expect(result).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
  });

  it.each([
    [
      "a different Windows drive",
      "C:\\outside\\node_modules\\@emnapi\\runtime",
      "C:/outside/node_modules/@emnapi/runtime",
    ],
    [
      "a Windows UNC share",
      "\\\\private-server\\share\\node_modules\\@emnapi\\runtime",
      "//private-server/share/node_modules/@emnapi/runtime",
    ],
  ])("rejects an extraneous package path on %s even when a matching lock key exists", (_label, installedPath, lockPath) => {
    const packageLock = readyInstalledTreeLock();
    const packages = packageLock.packages as Record<string, Record<string, unknown>>;
    packages[lockPath] = {
      version: "1.11.2",
      optional: true,
      integrity: "sha512-fixture",
    };

    expect(evaluateV1_9InstalledTreeProbe({
      cwd: fixtureCwd(),
      commandStatus: 0,
      stdout: JSON.stringify({
        problems: [`extraneous: @emnapi/runtime@1.11.2 ${installedPath}`],
      }),
      packageLock,
    })).toEqual({ ok: false, allowedOptionalExtraneousCount: 0 });
  });

  it("discovers immutable manifest and state from the active pointer when paths are omitted", async () => {
    const dependencies = readyDependencies();

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(dependencies.readJson).toHaveBeenCalledWith(fixturePointerPath());
    expect(dependencies.readBytes).toHaveBeenCalledWith(fixtureManifestPath());
    expect(dependencies.readJson).toHaveBeenCalledWith(fixtureRunStatePath());
  });

  it("preserves the stable Skill reasonCode and never serializes private failure detail", async () => {
    const dependencies = readyDependencies();
    dependencies.preflightSkills.mockRejectedValueOnce(Object.assign(
      new Error("failed at E:\\private\\projection with token=private-value"),
      { reasonCode: "skill_runtime_lock_digest_mismatch" },
    ));

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });
    const output = serializeV1_9ProductPreflight(report);

    expect(report.failureReasonCodes).toContain("skill_runtime_lock_digest_mismatch");
    expect(output).not.toMatch(/private|projection|token|E:\\/i);
    expect(dependencies.resolveProviderValueBag).not.toHaveBeenCalled();
  });

  it("fails closed when a required Provider capability lacks configuration without leaking key names or values", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "image_generation") return providerBag({
        IMAGE_PROVIDER_MODE: "primary",
        IMAGEGEN_MYSELF_PRIMARY_API_KEY: "private-image-key",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });
    const output = serializeV1_9ProductPreflight(report);

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toContain("v1_9_provider_ledger_invalid");
    expect(output).not.toMatch(/IMAGEGEN_|private-image-key|API_KEY|BASE_URL/i);
    expect(report.providerRequestCount).toBe(0);
  });

  it("rejects a non-MiniMax image channel for the V1 product run", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "image_generation") return providerBag({
        IMAGE_PROVIDER_CHANNEL: "primary",
        MINIMAX_API_KEY: "image-private",
        MINIMAX_BASE_URL: "https://provider.invalid",
        MINIMAX_IMAGE_MODEL: "image-01",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: { IMAGE_PROVIDER_CHANNEL: "primary" },
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.providerRequestCount).toBe(0);
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "provider-ledger-image-generation",
      ok: false,
      reasonCode: "v1_9_provider_ledger_invalid",
    }));
  });

  it("validates the selected Agent Brain channel rather than unrelated primary credentials", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "agent_brain") return providerBag({
        AGENT_BRAIN_CHANNEL: "fallback",
        AGENT_BRAIN_API_KEY: "primary-private",
        AGENT_BRAIN_BASE_URL: "https://primary.invalid/v1",
        AGENT_BRAIN_MODEL: "gpt-5.6-terra",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toContain("v1_9_provider_ledger_invalid");
    expect(report.providerRequestCount).toBe(0);
  });

  it("accepts a complete selected primary channel without requiring unrelated critic or fallback channels", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "agent_brain") return providerBag({
        AGENT_BRAIN_CHANNEL: "primary",
        AGENT_BRAIN_API_KEY: "primary-private",
        AGENT_BRAIN_BASE_URL: "https://primary.invalid/v1",
        AGENT_BRAIN_MODEL: "gpt-5.6-terra",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
  });

  it.each(["fallback-typo", " "])("fails closed for invalid Agent Brain channel %j", async (channel) => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "agent_brain") return providerBag({ AGENT_BRAIN_CHANNEL: channel });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toContain("v1_9_agent_brain_channel_invalid");
    expect(dependencies.resolveProviderValueBag).toHaveBeenCalledTimes(1);
  });

  it("rejects a valid but different Agent Brain configuration instead of rewriting the frozen manifest", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "agent_brain") return providerBag({
        AGENT_BRAIN_CHANNEL: "fallback",
        AGENT_BRAIN_FALLBACK_API_KEY: "fallback-private",
        AGENT_BRAIN_FALLBACK_BASE_URL: "https://fallback.invalid/v1",
        AGENT_BRAIN_FALLBACK_MODEL: "gpt-5.6-terra",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toContain("v1_9_provider_lock_mismatch");
    expect(report.providerRequestCount).toBe(0);
  });

  it.each([
    ["wrong model", { AGENT_BRAIN_MODEL: "gpt-5.5" }],
    ["wrong reasoning", { AGENT_BRAIN_REASONING_EFFORT: "high" }],
    ["wrong intensity", { V1_9_E2E_GENERATION_INTENSITY: "enhanced" }],
  ])("requires standard gpt-5.6-terra with medium reasoning: %s", async (_label, env) => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "agent_brain") {
        return providerBag({ ...providerValues().agent_brain, ...env });
      }
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env,
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.failureReasonCodes).toContain("v1_9_provider_ledger_invalid");
    expect(report.providerRequestCount).toBe(0);
  });

  it("requires a frozen MiniMax TTS voice id", async () => {
    const dependencies = readyDependencies();
    dependencies.resolveProviderValueBag.mockImplementation(({ capability }) => {
      if (capability === "tts_minimax") return providerBag({
        TTS_PROVIDER_MODE: "minimax",
        MINIMAX_API_KEY: "tts-private",
        MINIMAX_BASE_URL: "https://provider.invalid",
        MINIMAX_TTS_MODEL: "speech-01",
      });
      return providerBags()[capability];
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: "provider-ledger-tts-minimax",
      ok: false,
      reasonCode: "v1_9_provider_ledger_invalid",
    }));
  });

  it.each(["agent_brain", "coze_ppt", "image_generation", "video_generation", "tts_minimax"])(
    "fails closed when the frozen %s summary differs from the current ledger",
    async (capability) => {
      const manifest = withChangedProviderSummary(readyManifest(), capability);
      const dependencies = readyDependencies({ manifest, state: readyRunState(manifest) });

      const report = await runV1_9ProductPreflight({
        cwd: fixtureCwd(),
        env: {},
        manifestPath: fixtureManifestPath(),
        runStatePath: fixtureRunStatePath(),
        activePointerPath: fixturePointerPath(),
        dependencies,
      });

      expect(report.ok).toBe(false);
      expect(report.failureReasonCodes).toContain("v1_9_provider_lock_mismatch");
      expect(report.providerRequestCount).toBe(0);
    },
  );

  it.each(["projectionLockDigest", "bindingPolicyDigest"] as const)(
    "rejects frozen Skill %s drift without rewriting manifest",
    async (field) => {
      const original = readyManifest();
      const manifest = {
        ...original,
        skillLock: { ...original.skillLock, [field]: "f".repeat(64) },
      } satisfies V1_9RunManifestV2;
      const dependencies = readyDependencies({ manifest, state: readyRunState(manifest) });

      const report = await runV1_9ProductPreflight({
        cwd: fixtureCwd(),
        env: {},
        manifestPath: fixtureManifestPath(),
        runStatePath: fixtureRunStatePath(),
        activePointerPath: fixturePointerPath(),
        dependencies,
      });

      expect(report.failureReasonCodes).toContain("v1_9_skill_lock_invalid");
      expect(report.providerRequestCount).toBe(0);
    },
  );

  it("rejects source, requirements, Registry or A23 projection drift before storage or Provider requests", async () => {
    const dependencies = readyDependencies();
    dependencies.assertCurrentBaselineLock.mockImplementationOnce(() => {
      throw Object.assign(new Error("v1_9_baseline_lock_drift"), {
        reasonCode: "v1_9_baseline_lock_drift",
        driftedFields: [
          "runtimeSourceDigest",
          "requirementsBaselineDigest",
          "registryDigest",
          "projectionRegistryDigest",
          "providerLedgerManifestDigest",
          "projectionId",
        ],
      });
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_baseline_lock_drift");
    expect(report.providerRequestCount).toBe(0);
    expect(dependencies.probeInstalledTree).not.toHaveBeenCalled();
    expect(dependencies.preflightSkills).not.toHaveBeenCalled();
    expect(dependencies.resolveProviderValueBag).not.toHaveBeenCalled();
    expect(dependencies.probeBinary).not.toHaveBeenCalled();
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("rejects a state whose immutable manifest digest differs", async () => {
    const state = { ...readyRunState(), manifestSha256: "f".repeat(64) } satisfies V1_9RunState;
    const dependencies = readyDependencies({ state });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_run_manifest_identity_invalid");
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("rejects semantically identical manifest bytes whose raw SHA-256 drifted", async () => {
    const manifest = readyManifest();
    const dependencies = readyDependencies({
      manifest,
      manifestBytes: Buffer.from(JSON.stringify(manifest), "utf8"),
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_run_manifest_identity_invalid");
    expect(report.providerRequestCount).toBe(0);
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("rejects an active pointer whose run identity differs", async () => {
    const dependencies = readyDependencies({ pointer: { ...readyPointer(), runId: "v1-9-other-run" } });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_run_manifest_identity_invalid");
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("rejects a v2 active pointer with legacy or unknown fields", async () => {
    const dependencies = readyDependencies({ pointer: { ...readyPointer(), status: "active" } });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_run_manifest_identity_invalid");
    expect(dependencies.probeInstalledTree).not.toHaveBeenCalled();
    expect(dependencies.preflightSkills).not.toHaveBeenCalled();
    expect(dependencies.resolveProviderValueBag).not.toHaveBeenCalled();
    expect(dependencies.probeBinary).not.toHaveBeenCalled();
    expect(dependencies.assertCurrentBaselineLock).not.toHaveBeenCalled();
    expect(dependencies.probeRunStorage).not.toHaveBeenCalled();
  });

  it("fresh prepared state does not require recovery health evidence", async () => {
    const dependencies = readyDependencies();

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(dependencies.readProviderHealthEvidence).not.toHaveBeenCalled();
  });

  it("external acceptance repair state resumes without Provider health evidence", async () => {
    const dependencies = readyDependencies({ state: externalAcceptanceRepairState() });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(report.failureReasonCodes).not.toContain("v1_9_agent_brain_health_evidence_required");
    expect(dependencies.readProviderHealthEvidence).not.toHaveBeenCalled();
  });

  it("paused recovery requires a new matching health evidence id", async () => {
    const dependencies = readyDependencies({ state: pausedRecoveryState() });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_agent_brain_health_evidence_required");
    expect(report.providerRequestCount).toBe(0);
  });

  it.each([
    ["wrong config digest", { configDigest: "f".repeat(64) }],
    ["old evidence", { testedAt: "2026-07-15T00:59:59.000Z" }],
    ["sdk retry", { retryCount: 1, maxRetries: 1 }],
  ])("rejects %s instead of recovering the paused run", async (_label, change) => {
    const evidenceId = "agent-brain-health-fixture";
    const dependencies = readyDependencies({
      state: pausedRecoveryState(),
      healthEvidence: { ...readyHealthEvidence(evidenceId), ...change },
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: { V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: evidenceId },
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(false);
    expect(report.providerRequestCount).toBe(0);
    expect(report.failureReasonCodes).toContain("v1_9_agent_brain_health_evidence_invalid");
  });

  it("accepts one fresh zero-retry ledger evidence matching the frozen Provider lock", async () => {
    const evidenceId = "agent-brain-health-fixture";
    const dependencies = readyDependencies({
      state: pausedRecoveryState(),
      healthEvidence: readyHealthEvidence(evidenceId),
    });

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: { V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: evidenceId },
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toContainEqual({ id: "agent-brain-health-evidence", ok: true });
  });

  it("fails closed when a required renderer is unavailable", async () => {
    const dependencies = readyDependencies();
    dependencies.probeBinary.mockImplementation(async (command) => command !== "soffice");

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_binary_unavailable");
  });

  it("fails closed when isolated SQLite and artifact storage are not writable", async () => {
    const dependencies = readyDependencies();
    dependencies.probeRunStorage.mockResolvedValueOnce(false);

    const report = await runV1_9ProductPreflight({
      cwd: fixtureCwd(),
      env: {},
      manifestPath: fixtureManifestPath(),
      runStatePath: fixtureRunStatePath(),
      activePointerPath: fixturePointerPath(),
      dependencies,
    });

    expect(report.failureReasonCodes).toContain("v1_9_runtime_storage_invalid");
  });
});

function fixtureCwd() {
  return path.resolve(".tmp", "v1-9-product-preflight-fixture");
}

function fixtureManifestPath() {
  return path.join(fixtureCwd(), ...relativeRunRoot.split("/"), "run-manifest.json");
}

function fixtureRunStatePath() {
  return path.join(fixtureCwd(), ...relativeRunRoot.split("/"), "run-state.json");
}

function fixturePointerPath() {
  return path.join(fixtureCwd(), "test-results", "v1-9-product-e2e-active.json");
}

function readyBaselineLock() {
  return {
    schemaVersion: "v1-9-baseline-lock.v1" as const,
    branch: "main" as const,
    gitHead: "c".repeat(40),
    generationIntensity: "standard" as const,
    runtimeSourceDigest: "1".repeat(64),
    requirementsBaselineDigest: "2".repeat(64),
    registryDigest: "3".repeat(64),
    projectionRegistryDigest: "3".repeat(64),
    providerLedgerManifestDigest: "4".repeat(64),
    projectionId: "runtime-projection-a23-20260715-2040",
  };
}

function readySkillLock() {
  return {
    schemaVersion: "v1-9-skill-lock.v1" as const,
    projectionLockDigest: "a".repeat(64),
    bindingPolicyDigest: "b".repeat(64),
    activeSkills: [{ name: "shanhai-jiaoan", version: "1.1" }],
  };
}

function readyManifest() {
  return createV1_9RunManifestV2({
    runId,
    relativeRunRoot,
    prompt: "fixture full material package",
    createdAt: "2026-07-15T01:00:00.000Z",
    baselineLock: readyBaselineLock(),
    skillLock: readySkillLock(),
    agentBrain: { providerLock: fixtureProviderLock() },
    providerRuntimeLocks: fixtureProviderRuntimeLocks(),
    predecessor: {
      runId: "v1-9-20260714212914-a036beb9",
      relativeRunRoot: "test-results/v1-9-20260714212914-a036beb9",
      manifestSha256: "d".repeat(64),
      disposition: "historical_failed",
    },
  });
}

function readyRunState(manifest = readyManifest()) {
  return createV1_9RunState({ manifest, createdAt: "2026-07-15T01:00:00.000Z" });
}

function pausedRecoveryState() {
  let state = bindV1_9RunStateProjectIdentity(readyRunState(), {
    actorUserId: "teacher-fixture",
    projectId: "project-fixture",
    boundAt: "2026-07-15T01:00:00.000Z",
  });
  state = bindV1_9TaskContractLock(state, {
    actorUserId: "teacher-fixture",
    projectId: "project-fixture",
    taskId: "task-fixture",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-fixture",
    turnJobId: "turn-job-fixture",
    taskBriefDigest: "1".repeat(64),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: "2".repeat(64),
    budgetDigest: "3".repeat(64),
    initialPlanRevision: 0,
    boundAt: "2026-07-15T01:00:00.000Z",
  });
  return markV1_9RunStateRecoveryStop(state, {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: null,
    observationRefs: [],
    stoppedAt: "2026-07-15T01:00:00.000Z",
  });
}

function externalAcceptanceRepairState() {
  let state = bindV1_9RunStateProjectIdentity(readyRunState(), {
    actorUserId: "teacher-fixture",
    projectId: "project-fixture",
    boundAt: "2026-07-15T01:00:00.000Z",
  });
  state = bindV1_9TaskContractLock(state, {
    actorUserId: "teacher-fixture",
    projectId: "project-fixture",
    taskId: "task-fixture",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-fixture",
    turnJobId: "turn-job-fixture",
    taskBriefDigest: "1".repeat(64),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: "2".repeat(64),
    budgetDigest: "3".repeat(64),
    initialPlanRevision: 0,
    boundAt: "2026-07-15T01:00:00.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "GET",
    pathname: "/api/workbench/projects/project-fixture/artifacts/package-fixture/package",
    source: "ui",
    recordedAt: "2026-07-15T01:00:01.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-fixture",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "a".repeat(64),
    turnJobId: "turn-job-fixture",
    teacherMessageId: "teacher-message-fixture",
    downloadedAt: "2026-07-15T01:00:02.000Z",
  });
  return recordV1_9ExternalAcceptanceRound(state, {
    auditRound: 1,
    reportId: "external-acceptance-round-1",
    reportPath: "external-acceptance/round-0001/report.json",
    reportDigest: "b".repeat(64),
    packageArtifactId: "package-fixture",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "a".repeat(64),
    outcome: "repair_required",
    reviewedFindingIds: [],
    openP0FindingIds: ["finding-page-3"],
    affectedUnits: [{
      unitId: "ppt_deck:page:3",
      kind: "page",
      artifactRole: "ppt_deck",
      artifactId: "pptx-fixture",
      artifactVersion: "course-v1",
      pageNumber: 3,
      shotId: null,
      packageEntry: "materials/course-v1.pptx",
    }],
    repairFeedback: [{
      findingId: "finding-page-3",
      responsibilityLayer: "quality_gate",
      category: "design_quality",
      design: "第3页越过安全边距。",
      vulnerability: null,
      engineering: "仅返修第3页。",
    }],
    repairHandoffPath: "external-acceptance/round-0001/repair-handoff.json",
    repairHandoffDigest: "c".repeat(64),
    generatedAt: "2026-07-15T01:00:03.000Z",
  });
}

function fixtureProviderLock(): V1_9ProviderLock {
  const identity = {
    credential: "primary-private",
    channel: "primary" as const,
    baseURL: "https://primary.invalid/v1",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium" as const,
    credentialSource: "ledger_private_env" as const,
    endpointCategory: "openai_compatible_responses" as const,
  };
  return {
    schemaVersion: "v1-9-provider-lock.v1",
    channel: identity.channel,
    model: identity.model,
    endpointCategory: identity.endpointCategory,
    reasoningEffort: identity.reasoningEffort,
    credentialSource: identity.credentialSource,
    configDigest: createOpenAICompatibleConfigDigest(identity),
  };
}

function fixtureProviderRuntimeLocks(): V1_9ProviderRuntimeLock[] {
  const values = providerValues();
  const providerLock = fixtureProviderLock();
  return [
    {
      capability: "agent_brain",
      credentialSource: providerLock.credentialSource,
      configDigest: providerLock.configDigest,
    },
    providerRuntimeLock("coze_ppt", values.coze_ppt, ["COZE_API_TOKEN", "COZE_PPT_RUN_URL", "COZE_PPT_BOT_ID"]),
    providerRuntimeLock("image_generation", values.image_generation, [
      "IMAGE_PROVIDER_CHANNEL", "MINIMAX_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_IMAGE_MODEL",
    ]),
    providerRuntimeLock("video_generation", values.video_generation, [
      "VIDEO_PROVIDER_MODE", "EVOLINK_API_KEY", "EVOLINK_BASE_URL", "EVOLINK_VIDEO_MODEL",
    ]),
    providerRuntimeLock("tts_minimax", values.tts_minimax, [
      "TTS_PROVIDER_MODE", "MINIMAX_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_TTS_MODEL", "MINIMAX_TTS_VOICE_ID",
    ]),
  ];
}

function providerRuntimeLock(
  capability: V1_9ProviderRuntimeLock["capability"],
  source: Record<string, string>,
  keys: string[],
): V1_9ProviderRuntimeLock {
  const values = [...new Set(keys)].sort().flatMap((key) => {
    const value = source[key]?.trim();
    return value ? [{ key, valueDigest: sha256(value) }] : [];
  });
  return {
    capability,
    credentialSource: "ledger_private_env",
    configDigest: sha256(JSON.stringify({ capability, credentialSource: "ledger_private_env", values })),
  };
}

function withChangedProviderSummary(manifest: V1_9RunManifestV2, capability: string): V1_9RunManifestV2 {
  const changedDigest = "f".repeat(64);
  const providerRuntimeLocks = manifest.providerRuntimeLocks.map((lock) => (
    lock.capability === capability ? { ...lock, configDigest: changedDigest } : lock
  ));
  if (capability !== "agent_brain") return { ...manifest, providerRuntimeLocks };
  return {
    ...manifest,
    agentBrain: {
      providerLock: { ...manifest.agentBrain.providerLock, configDigest: changedDigest },
    },
    providerRuntimeLocks,
  };
}

function readyHealthEvidence(evidenceId: string) {
  const lock = fixtureProviderLock();
  return {
    schemaVersion: "v1-9-agent-brain-health.v2",
    evidenceId,
    providerId: "agent_brain",
    capability: "agent_brain",
    purpose: "main_agent_responses",
    channel: lock.channel,
    model: lock.model,
    endpointCategory: lock.endpointCategory,
    reasoningEffort: lock.reasoningEffort,
    credentialSource: lock.credentialSource,
    configDigest: lock.configDigest,
    probe: "single_strict_structured_text",
    result: "succeeded",
    testedAt: "2026-07-15T02:00:00.000Z",
    providerRequestCount: 1,
    maxRetries: 0,
    retryCount: 0,
    errorCategory: "none",
  };
}

function readyPointer(manifest = readyManifest()) {
  return {
    schemaVersion: "v1-9-active-run.v2",
    runId,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256: createV1_9RunManifestV2Digest(manifest),
    statePath: `${relativeRunRoot}/run-state.json`,
  };
}

function readyDependencies(overrides: {
  pointer?: Record<string, unknown>;
  manifest?: V1_9RunManifestV2;
  manifestBytes?: Buffer;
  state?: V1_9RunState;
  healthEvidence?: Record<string, unknown>;
} = {}) {
  const manifest = overrides.manifest ?? readyManifest();
  const state = overrides.state ?? readyRunState(manifest);
  const jsonByPath = new Map<string, unknown>([
    [fixtureManifestPath(), manifest],
    [fixtureRunStatePath(), state],
    [fixturePointerPath(), overrides.pointer ?? readyPointer(manifest)],
  ]);
  const preflightSkills = vi.fn<V1_9ProductPreflightDependencies["preflightSkills"]>(async () => ({
    status: "ready",
    activeSkillNames: ["shanhai-jiaoan"],
    activeSkills: [{ name: "shanhai-jiaoan", version: "1.1" }],
    checkedBindingCount: 21,
    projectionLockDigest: "a".repeat(64),
    bindingPolicyDigest: "b".repeat(64),
  }));
  const resolveProviderValueBag = vi.fn<V1_9ProductPreflightDependencies["resolveProviderValueBag"]>(
    ({ capability }) => providerBags()[capability],
  );
  const resolveProviderRuntimeContract = vi.fn<V1_9ProductPreflightDependencies["resolveProviderRuntimeContract"]>(
    ({ capability }) => fixtureRuntimeContract(capability),
  );
  const assertCurrentBaselineLock = vi.fn<V1_9ProductPreflightDependencies["assertCurrentBaselineLock"]>(
    (expected) => expected,
  );
  const probeInstalledTree = vi.fn<V1_9ProductPreflightDependencies["probeInstalledTree"]>(async () => ({
    ok: true,
    allowedOptionalExtraneousCount: 0,
  }));
  const probeBinary = vi.fn<V1_9ProductPreflightDependencies["probeBinary"]>(async () => true);
  const probeRunStorage = vi.fn<V1_9ProductPreflightDependencies["probeRunStorage"]>(async () => true);
  const readJson = vi.fn<V1_9ProductPreflightDependencies["readJson"]>(async (filePath) => {
    if (!jsonByPath.has(filePath)) throw new Error("private file path was not found");
    return structuredClone(jsonByPath.get(filePath));
  });
  const readBytes = vi.fn<V1_9ProductPreflightDependencies["readBytes"]>(async (filePath) => {
    if (filePath !== fixtureManifestPath()) throw new Error("private file path was not found");
    return overrides.manifestBytes ?? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  });
  const readProviderHealthEvidence = vi.fn(async () => {
    if (!overrides.healthEvidence) throw new Error("health evidence not found");
    return structuredClone(overrides.healthEvidence);
  });
  return {
    preflightSkills,
    resolveProviderValueBag,
    resolveProviderRuntimeContract,
    assertCurrentBaselineLock,
    probeInstalledTree,
    probeBinary,
    probeRunStorage,
    readJson,
    readBytes,
    readProviderHealthEvidence,
  } satisfies V1_9ProductPreflightDependencies;
}

function readyInstalledTreeLock(overrides: {
  optional?: boolean;
  devOptional?: boolean;
  integrity?: string;
  inBundle?: boolean;
} = {}) {
  const packageEntry: Record<string, unknown> = {
    version: "1.11.2",
    optional: overrides.optional ?? true,
    integrity: overrides.integrity === undefined && Object.hasOwn(overrides, "integrity")
      ? undefined
      : overrides.integrity ?? "sha512-fixture",
  };
  if (overrides.devOptional !== undefined) packageEntry.devOptional = overrides.devOptional;
  if (overrides.inBundle !== undefined) packageEntry.inBundle = overrides.inBundle;
  return {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", version: "1.0.0" },
      "node_modules/@emnapi/runtime": packageEntry,
    },
  };
}

function fixtureRuntimeContract(capability: string) {
  if (capability === "agent_brain") {
    return {
      schemaVersion: "provider-runtime-contract.v1" as const,
      kind: "agent_brain_responses" as const,
      endpointCategory: "openai_compatible_responses" as const,
      selectedChannelEnv: "AGENT_BRAIN_CHANNEL",
      purposeChannels: {
        main_agent_responses: {
          channel: "primary" as const,
          credentialEnv: "AGENT_BRAIN_API_KEY",
          baseUrlEnv: "AGENT_BRAIN_BASE_URL",
          modelEnv: "AGENT_BRAIN_MODEL",
        },
        critic_responses: {
          channel: "third" as const,
          credentialEnv: "AGENT_BRAIN_THIRD_API_KEY",
          baseUrlEnv: "AGENT_BRAIN_THIRD_BASE_URL",
          modelEnv: "AGENT_BRAIN_THIRD_MODEL",
        },
        fallback_responses: {
          channel: "fallback" as const,
          credentialEnv: "AGENT_BRAIN_FALLBACK_API_KEY",
          baseUrlEnv: "AGENT_BRAIN_FALLBACK_BASE_URL",
          modelEnv: "AGENT_BRAIN_FALLBACK_MODEL",
        },
      },
      reasoning: {
        env: "AGENT_BRAIN_REASONING_EFFORT",
        default: "medium" as const,
        allowed: ["low", "medium", "high", "xhigh"] as const,
      },
    };
  }
  if (capability === "image_generation") {
    return {
      schemaVersion: "provider-runtime-contract.v1" as const,
      kind: "minimax_image" as const,
      selectedChannelEnv: "IMAGE_PROVIDER_CHANNEL",
      requiredChannel: "minimax" as const,
      credentialEnv: "MINIMAX_API_KEY",
      baseUrlEnv: "MINIMAX_BASE_URL",
      modelEnv: "MINIMAX_IMAGE_MODEL",
    };
  }
  if (capability === "tts_minimax") {
    return {
      schemaVersion: "provider-runtime-contract.v1" as const,
      kind: "minimax_tts" as const,
      selectedModeEnv: "TTS_PROVIDER_MODE",
      requiredMode: "minimax" as const,
      credentialEnv: "MINIMAX_API_KEY",
      baseUrlEnv: "MINIMAX_BASE_URL",
      modelEnv: "MINIMAX_TTS_MODEL",
    };
  }
  throw new Error(`fixture runtime contract unavailable: ${capability}`);
}

function providerValues(): Record<string, Record<string, string>> {
  return {
    agent_brain: {
      AGENT_BRAIN_CHANNEL: "primary",
      AGENT_BRAIN_API_KEY: "primary-private",
      AGENT_BRAIN_BASE_URL: "https://primary.invalid/v1",
      AGENT_BRAIN_MODEL: "gpt-5.6-terra",
      AGENT_BRAIN_REASONING_EFFORT: "medium",
      AGENT_BRAIN_THIRD_API_KEY: "critic-private",
      AGENT_BRAIN_THIRD_BASE_URL: "https://critic.invalid/v1",
      AGENT_BRAIN_THIRD_MODEL: "gpt-5.6-terra",
      AGENT_BRAIN_FALLBACK_API_KEY: "fallback-private",
      AGENT_BRAIN_FALLBACK_BASE_URL: "https://fallback.invalid/v1",
      AGENT_BRAIN_FALLBACK_MODEL: "gpt-5.6-terra",
    },
    coze_ppt: {
      COZE_API_TOKEN: "coze-private",
      COZE_PPT_RUN_URL: "https://provider.invalid/run",
    },
    image_generation: {
      IMAGE_PROVIDER_CHANNEL: "minimax",
      MINIMAX_API_KEY: "image-private",
      MINIMAX_BASE_URL: "https://provider.invalid",
      MINIMAX_IMAGE_MODEL: "image-01",
    },
    video_generation: {
      VIDEO_PROVIDER_MODE: "evolink",
      EVOLINK_API_KEY: "video-private",
      EVOLINK_BASE_URL: "https://provider.invalid",
    },
    tts_minimax: {
      TTS_PROVIDER_MODE: "minimax",
      MINIMAX_API_KEY: "tts-private",
      MINIMAX_BASE_URL: "https://provider.invalid",
      MINIMAX_TTS_MODEL: "speech-01",
      MINIMAX_TTS_VOICE_ID: "Chinese (Mandarin)_Gentleman",
    },
  };
}

function providerBags(): Record<string, ReturnType<typeof providerBag>> {
  return Object.fromEntries(Object.entries(providerValues()).map(([capability, values]) => [
    capability,
    providerBag(values),
  ]));
}

function providerBag(values: Record<string, string>) {
  return Object.freeze({
    capability: "fixture",
    source: "ledger_private_env" as const,
    has: (key: string) => Object.hasOwn(values, key),
    get: (key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error("ledger variable is not declared");
      return values[key];
    },
    require: (key: string) => {
      if (!Object.hasOwn(values, key) || !values[key]?.trim()) throw new Error("ledger value is missing");
      return values[key];
    },
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
