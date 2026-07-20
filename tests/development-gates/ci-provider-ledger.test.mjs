import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCiPublicProviderManifest,
  stageCiProviderLedger,
} from "../../scripts/stage-ci-provider-ledger.mjs";

test("CI Provider ledger staging produces only a public standalone manifest", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-ci-ledger-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "tests", "fixtures", "provider-ledger");
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(path.join(sourceDirectory, "manifest.json"), JSON.stringify({
    version: 1,
    providers: [{ id: "fixture", env_vars: ["FIXTURE_API_KEY"] }],
  }));

  const target = stageCiProviderLedger({ root, env: { CI: "true", GITHUB_ACTIONS: "true" } });
  const manifest = JSON.parse(readFileSync(target, "utf8"));

  assert.equal(manifest.project.contains_real_secrets, false);
  assert.equal(manifest.package_modes.public_zip.contains_private_env, false);
  assert.deepEqual(manifest.providers, [{ id: "fixture", env_vars: ["FIXTURE_API_KEY"] }]);
  assert.throws(() => stageCiProviderLedger({ root, env: {} }), /restricted to GitHub Actions/);
});

test("CI public manifest builder rejects malformed fixtures", () => {
  assert.throws(() => createCiPublicProviderManifest({ version: 1 }), /fixture is invalid/);
});
