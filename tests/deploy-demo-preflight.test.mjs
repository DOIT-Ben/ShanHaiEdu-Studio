import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createDeployDemoCommandEnvironment } from "../scripts/ops-runtime-config.mjs";

const root = process.cwd();

test("deploy demo preflight exposes an explicit isolated command environment", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["preflight:deploy-demo"], "node scripts/deploy-demo-preflight.mjs");
  assert.equal(existsSync(path.join(root, "scripts", "deploy-demo-preflight.mjs")), true);

  const environment = createDeployDemoCommandEnvironment({
    baseEnv: { KEEP_ME: "yes" },
    databasePath: "C:/tmp/deploy-demo/production.db",
    artifactRoot: "C:/tmp/deploy-demo/artifacts",
    bootstrapPassword: "fixture-only-password",
  });
  assert.equal(environment.KEEP_ME, "yes");
  assert.equal(environment.SHANHAI_AUTH_MODE, "password");
  assert.equal(environment.NEXT_PUBLIC_SHANHAI_AUTH_MODE, "password");
  assert.equal(environment.SHANHAI_TRUST_PROXY, "1");
  assert.equal(environment.SHANHAI_APP_INSTANCE_COUNT, "1");
  assert.equal(environment.SHANHAI_PUBLIC_REGISTRATION_ENABLED, "0");
  assert.equal(environment.NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED, "0");
  assert.equal(environment.DATABASE_URL, "file:C:/tmp/deploy-demo/production.db");
  assert.equal(environment.ARTIFACT_STORAGE_ROOT, "C:/tmp/deploy-demo/artifacts");
  assert.equal(environment.SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD, "fixture-only-password");

  const releaseRoadmap = readFileSync(path.join(root, "docs", "roadmap", "release", "README.md"), "utf8");
  assert.match(releaseRoadmap, /当前产品优先深度重构关闭、重新规划并通过唯一V1-9真实全链路后/);
  assert.match(releaseRoadmap, /不得提前启动/);
  assert.match(releaseRoadmap, /部署、生产写入、教师签收或公网切流/);
});
