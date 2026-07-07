import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("deploy demo preflight exposes a production-like one-command readiness gate", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["preflight:deploy-demo"], "node scripts/deploy-demo-preflight.mjs");

  const scriptPath = path.join(root, "scripts", "deploy-demo-preflight.mjs");
  assert.equal(existsSync(scriptPath), true);
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /preflight:production/);
  assert.match(script, /db:init/);
  assert.match(script, /build/);
  assert.match(script, /\.next.+standalone.+server\.js/s);
  assert.match(script, /deploy-demo-preflight-report\.json/);
  assert.match(script, /deploy-demo-preflight-report\.md/);
  assert.match(script, /mode:\s*"deploy-demo-readiness"/);
  assert.match(script, /dotenv\/config/);
  assert.match(script, /SHANHAI_DEPLOY_DEMO_PREFLIGHT_SKIP_DOTENV/);
  assert.match(script, /normalizeDatabaseUrlForStandalone/);
  assert.doesNotMatch(script, /readFileSync\([^)]*\.env/);
  assert.doesNotMatch(script, /console\.log\(process\.env/);
});
