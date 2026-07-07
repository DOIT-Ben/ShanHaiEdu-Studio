import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("stage41 delivery demo exposes a one-command local end-to-end delivery script", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["demo:e2e:delivery"], "node scripts/run-stage41-delivery-demo.mjs");
  assert.equal(packageJson.scripts["test:e2e:stage41"], "node scripts/run-stage41-delivery-demo.mjs");

  const scriptPath = path.join(root, "scripts", "run-stage41-delivery-demo.mjs");
  assert.equal(existsSync(scriptPath), true);
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /stage41-delivery-demo\.db/);
  assert.match(script, /stage41-delivery-demo-report\.json/);
  assert.match(script, /stage41-delivery-demo-report\.md/);
  assert.match(script, /stage41-auto-delivery-demo\.spec\.ts/);
  assert.match(script, /E2E_PORT/);
  assert.match(script, /findAvailablePort/);
  assert.doesNotMatch(script, /readFileSync\([^)]*\.env/);
  assert.doesNotMatch(script, /console\.log\(process\.env/);
});
