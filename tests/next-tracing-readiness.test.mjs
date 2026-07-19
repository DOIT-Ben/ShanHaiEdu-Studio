import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { prepareDesktopBundle } from "../scripts/prepare-desktop-bundle.mjs";
import {
  inspectNextBuildOutput,
  sanitizeNextStandalone,
} from "../scripts/verify-next-build-output.mjs";

const fixtureRoots = [];

after(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("Next build output inspection accepts only the runtime server and public Provider manifest", () => {
  const root = createBuildFixture();
  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, true);
  assert.equal(result.standaloneFileCount, 9);
  assert.equal(result.nftFileCount, 1);
  assert.equal(result.nftEntryCount, 2);
  assert.deepEqual(result.forbidden, []);
});

for (const relativePath of [
  ".env",
  ".env.production",
  "dev.db",
  "dev.db-wal",
  "dev.db-shm",
  ".tmp/generated.bin",
  "test-results/run.json",
  "tests/fixture.ts",
  "docs/internal.md",
  "API台账系统/PRIVATE-LOCAL-SECRETS/apps-api/.env",
  "API台账系统/research/provider-notes.md",
  "API台账系统/evidence/provider-run.json",
  "API台账系统/install-private-env.ps1",
  "api台账系统/private-local-secrets/apps-api/.ENV",
  "output/internal.json",
  "dist-desktop/app.exe",
  "desktop-bundle/server.js",
  "graphify-out/graph.json",
  "playwright-report/index.html",
  "README.md",
  "unplanned-runtime.txt",
]) {
  test(`Next build output inspection rejects ${relativePath}`, () => {
    const root = createBuildFixture();
    writeFixtureFile(path.join(root, ".next", "standalone", ...relativePath.split("/")));

    const result = inspectNextBuildOutput({ cwd: root });

    assert.equal(result.ok, false);
    assert.ok(result.forbidden.some(
      (entry) => entry.location === "standalone" && entry.path.toLowerCase() === relativePath.toLowerCase(),
    ));
  });
}

test("Next build output inspection rejects forbidden project files referenced by an NFT", () => {
  const root = createBuildFixture();
  const tracePath = path.join(root, ".next", "server", "instrumentation.js.nft.json");
  writeFileSync(tracePath, JSON.stringify({ version: 1, files: ["../../server.js", "../../test-results/run.json"] }));

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.location === "nft" && entry.path === "test-results/run.json"));
});

test("Next build output inspection rejects an NFT entry outside the repository", () => {
  const root = createBuildFixture();
  const tracePath = path.join(root, ".next", "server", "instrumentation.js.nft.json");
  writeFileSync(tracePath, JSON.stringify({ version: 1, files: ["../../../outside.env"] }));

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.location === "nft" && entry.path.startsWith("../")));
});

test("Next build output inspection requires a physical instrumentation trace", () => {
  const root = createBuildFixture();
  rmSync(path.join(root, ".next", "server", "instrumentation.js.nft.json"));

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes(".next/server/instrumentation.js.nft.json"));
});

test("required runtime paths must be ordinary files", () => {
  const root = createBuildFixture();
  const serverPath = path.join(root, ".next", "standalone", "server.js");
  rmSync(serverPath);
  mkdirSync(serverPath);

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("server.js"));
});

test("public Provider manifest must explicitly declare that the public package has no secrets", () => {
  const root = createBuildFixture();
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(publicManifest({ containsRealSecrets: true })),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "unsafe_manifest"));
});

test("public Provider manifest rejects nested credential material despite safe self-declarations", () => {
  const root = createBuildFixture();
  const manifest = publicManifest();
  manifest.providers = [{ id: "provider-1", api_token: "sk-not-public-credential" }];
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(manifest),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "unsafe_manifest"));
});

test("public Provider manifest permits credential environment-variable references without credential values", () => {
  const root = createBuildFixture();
  const manifest = publicManifest();
  manifest.providers = [{
    env_vars: ["SHANHAI_PROVIDER_TOKEN"],
    runtime_contract: {
      credential_env: "SHANHAI_PROVIDER_TOKEN",
    },
  }];
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(manifest),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, true);
});

test("public Provider manifest rejects an undeclared credential environment-variable reference", () => {
  const root = createBuildFixture();
  const manifest = publicManifest();
  manifest.providers = [{
    env_vars: ["SHANHAI_DECLARED_PROVIDER_TOKEN"],
    runtime_contract: {
      credential_env: "SHANHAI_UNDECLARED_PROVIDER_TOKEN",
    },
  }];
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(manifest),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "unsafe_manifest"));
});

test("public Provider manifest rejects a credential reference declared only in a nested object", () => {
  const root = createBuildFixture();
  const manifest = publicManifest();
  manifest.providers = [{
    runtime_contract: {
      env_vars: ["SHANHAI_NESTED_PROVIDER_TOKEN"],
      credential_env: "SHANHAI_NESTED_PROVIDER_TOKEN",
    },
  }];
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(manifest),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "unsafe_manifest"));
});

test("public Provider manifest rejects a credential value disguised as credential_env", () => {
  const root = createBuildFixture();
  const manifest = publicManifest();
  manifest.providers = [{ runtime_contract: { credential_env: "sk-not-an-environment-variable" } }];
  writeFileSync(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    JSON.stringify(manifest),
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "unsafe_manifest"));
});

test("standalone inspection and sanitization reject a child directory link", () => {
  const root = createBuildFixture();
  const external = mkdtempSync(path.join(os.tmpdir(), "shanhai-next-external-"));
  fixtureRoots.push(external);
  writeFixtureFile(path.join(external, "private.txt"));
  symlinkSync(
    external,
    path.join(root, ".next", "standalone", "runtime-cache"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = inspectNextBuildOutput({ cwd: root });

  assert.equal(result.ok, false);
  assert.ok(result.forbidden.some((entry) => entry.reason === "symbolic_link"));
  assert.throws(() => sanitizeNextStandalone({ cwd: root }), /unsafe next standalone tree/i);
  assert.equal(existsSync(path.join(external, "private.txt")), true);
});

test("standalone sanitization refuses a linked root without deleting its target", () => {
  const root = createBuildFixture();
  const standalone = path.join(root, ".next", "standalone");
  rmSync(standalone, { recursive: true, force: true });
  const external = mkdtempSync(path.join(os.tmpdir(), "shanhai-next-root-link-"));
  fixtureRoots.push(external);
  writeFixtureFile(path.join(external, ".env"), "must-survive");
  symlinkSync(external, standalone, process.platform === "win32" ? "junction" : "dir");

  assert.throws(() => sanitizeNextStandalone({ cwd: root }), /unsafe next standalone tree/i);
  assert.equal(existsSync(path.join(external, ".env")), true);
});

test("standalone sanitization removes only forbidden generated output before final inspection", () => {
  const root = createBuildFixture();
  for (const relativePath of [
    ".env",
    "dev.db-wal",
    ".tmp/generated.bin",
    "API台账系统/PRIVATE-LOCAL-SECRETS/apps-api/.env",
  ]) {
    writeFixtureFile(path.join(root, ".next", "standalone", ...relativePath.split("/")));
  }

  const resultBefore = inspectNextBuildOutput({ cwd: root });
  const sanitized = sanitizeNextStandalone({ cwd: root });
  const resultAfter = inspectNextBuildOutput({ cwd: root });

  assert.equal(resultBefore.ok, false);
  assert.equal(sanitized.removed, 4);
  assert.equal(resultAfter.ok, true);
  assert.equal(existsSync(path.join(root, ".next", "standalone", "server.js")), true);
  assert.equal(existsSync(path.join(root, ".next", "standalone", "API台账系统", "manifest.json")), true);
});

test("desktop preparation refuses a standalone source containing any forbidden path", async () => {
  const root = createBuildFixture();
  for (const relativePath of [
    ".env.local",
    "dev.db-wal",
    "dev.db-shm",
    ".tmp/generated.bin",
    "test-results/run.json",
    "tests/fixture.ts",
    "docs/internal.md",
    "API台账系统/PRIVATE-LOCAL-SECRETS/apps-api/.env",
    "API台账系统/research/provider-notes.md",
    "API台账系统/evidence/provider-run.json",
  ]) {
    writeFixtureFile(path.join(root, ".next", "standalone", ...relativePath.split("/")));
  }

  const result = await prepareDesktopBundle({ cwd: root });

  assert.equal(result.ok, false);
  assert.equal(existsSync(path.join(root, "desktop-bundle")), false);
});

test("desktop preparation copies a clean physical standalone and passes a second inspection", async () => {
  const root = createBuildFixture();

  const result = await prepareDesktopBundle({ cwd: root });

  assert.equal(result.ok, true);
  assert.equal(existsSync(path.join(root, "desktop-bundle", "server.js")), true);
  assert.equal(existsSync(path.join(root, "desktop-bundle", "API台账系统", "manifest.json")), true);
  assert.equal(
    inspectNextBuildOutput({ cwd: root, standaloneRoot: path.join(root, "desktop-bundle"), inspectNft: false }).ok,
    true,
  );
});

test("desktop preparation fails when the generated Prisma client runtime is absent", async () => {
  const root = createBuildFixture();
  rmSync(path.join(root, ".next", "standalone", "node_modules", "@prisma", "client", "runtime", "client.js"));

  const result = await prepareDesktopBundle({ cwd: root });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["@prisma/client/runtime/client"]);
});

function createBuildFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-next-trace-"));
  fixtureRoots.push(root);
  writeFixtureFile(path.join(root, ".next", "standalone", "server.js"));
  writeFixtureFile(
    path.join(root, ".next", "standalone", "API台账系统", "manifest.json"),
    `${JSON.stringify(publicManifest())}\n`,
  );
  writePackageFixture(root, "next");
  writePackageFixture(root, "better-sqlite3");
  writePackageFixture(root, "@prisma/client");
  writeFixtureFile(path.join(
    root,
    ".next",
    "standalone",
    "node_modules",
    "@prisma",
    "client",
    "runtime",
    "client.js",
  ), "module.exports = {};\n");
  const tracePath = path.join(root, ".next", "server", "instrumentation.js.nft.json");
  writeFixtureFile(tracePath, JSON.stringify({ version: 1, files: ["../../server.js", "../../API台账系统/manifest.json"] }));
  return root;
}

function writePackageFixture(root, packageName) {
  const packageRoot = path.join(root, ".next", "standalone", "node_modules", ...packageName.split("/"));
  writeFixtureFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName, main: "index.js" }));
  writeFixtureFile(path.join(packageRoot, "index.js"), "module.exports = {};\n");
}

function publicManifest({ containsRealSecrets = false } = {}) {
  return {
    version: 1,
    project: { contains_real_secrets: containsRealSecrets },
    package_modes: { public_zip: { contains_private_env: false } },
  };
}

function writeFixtureFile(filePath, contents = "fixture") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}
