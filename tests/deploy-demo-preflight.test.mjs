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
  assert.match(script, /mode:\s*"isolated-standalone-rehearsal"/);
  assert.match(script, /# V1-10B 隔离 Standalone 发布 Rehearsal 报告/);
  assert.match(script, /dotenv\/config/);
  assert.match(script, /SHANHAI_DEPLOY_DEMO_PREFLIGHT_SKIP_DOTENV/);
  assert.doesNotMatch(script, /normalizeDatabaseUrlForStandalone/);
  assert.match(script, /mkdtempSync/);
  assert.match(script, /os\.tmpdir/);
  assert.match(script, /deploy-demo-shared/);
  assert.match(script, /SHANHAI_APP_INSTANCE_COUNT:\s*"1"/);
  assert.match(script, /NEXT_PUBLIC_SHANHAI_AUTH_MODE:\s*"password"/);
  assert.match(script, /SHANHAI_TRUST_PROXY:\s*"1"/);
  assert.match(script, /SHANHAI_PUBLIC_REGISTRATION_ENABLED:\s*"0"/);
  assert.match(script, /NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED:\s*"0"/);
  assert.match(script, /SHANHAI_BOOTSTRAP_ADMIN_EMAIL:\s*"deploy_demo_admin"/);
  assert.match(script, /SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD:\s*randomBytes/);
  assert.match(script, /db:init"\],\s*\{\},\s*\{ quiet:\s*true \}/);
  assert.match(script, /bootstrap-admin\.mjs[\s\S]*quiet:\s*true/);
  assert.match(script, /bootstrap-admin\.mjs/);
  assert.match(script, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM:\s*"CREATE_ADMIN"/);
  assert.ok(script.indexOf('"db:init"') < script.indexOf("bootstrap-admin.mjs"));
  assert.ok(script.indexOf("bootstrap-admin.mjs") < script.indexOf('"preflight:production"'));
  assert.match(script, /"http-project-list"[\s\S]*"\/api\/workbench\/projects"[\s\S]*401/);
  assert.match(script, /expectedStatus/);
  assert.match(script, /"http-health"[\s\S]*"\/api\/health"[\s\S]*200/);
  assert.match(script, /"http-registration"[\s\S]*"\/api\/auth\/register"[\s\S]*403/);
  assert.match(script, /rmSync\(sharedRoot[\s\S]*recursive:\s*true[\s\S]*force:\s*true/);
  assert.doesNotMatch(script, /readFileSync\([^)]*\.env/);
  assert.doesNotMatch(script, /console\.log\(process\.env/);

  const localRunbook = readFileSync(path.join(root, "docs", "runbooks", "local-real-mvp-production-readiness.md"), "utf8");
  const liveRunbook = readFileSync(path.join(root, "docs", "runbooks", "live-deployment-demo-handoff.md"), "utf8");
  for (const runbook of [localRunbook, liveRunbook]) {
    assert.match(runbook, /password[^\n]*401/i);
    assert.match(runbook, /local[^\n]*200/i);
    assert.match(runbook, /SHANHAI_TRUST_PROXY=1/);
    assert.match(runbook, /覆盖[^\n]*(?:不能|不要|而非)追加/);
    assert.match(runbook, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM[^\n]*CREATE_ADMIN/);
  }
  const localGate = localRunbook.slice(localRunbook.indexOf("上线前检查命令"));
  const serverSteps = liveRunbook.slice(liveRunbook.indexOf("服务器部署顺序"));
  assert.ok(localGate.indexOf("bootstrap-admin.mjs") < localGate.indexOf("preflight:production"));
  assert.ok(serverSteps.indexOf("bootstrap-admin.mjs") < serverSteps.indexOf("preflight:production"));
});
