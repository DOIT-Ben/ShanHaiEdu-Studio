import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDeployDemoCommandEnvironment,
  createDesktopServerEnvironment,
  createPlaywrightWebServerEnvironment,
} from "../scripts/ops-runtime-config.mjs";

test("desktop and Playwright runtime config carries only server-owned paths", () => {
  const desktop = createDesktopServerEnvironment({
    baseEnv: { KEEP_ME: "yes" },
    port: 3127,
    databaseUrl: "file:C:/data/app.db",
    artifactStorageRoot: "C:/data/artifacts",
  });
  assert.deepEqual(desktop, {
    KEEP_ME: "yes",
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: "3127",
    DATABASE_URL: "file:C:/data/app.db",
    ARTIFACT_STORAGE_ROOT: "C:/data/artifacts",
  });
  assert.equal("NEXT_PUBLIC_WORKBENCH_DATA_SOURCE" in desktop, false);

  const playwright = createPlaywrightWebServerEnvironment({ KEEP_ME: "yes" });
  assert.deepEqual(playwright, { KEEP_ME: "yes", DATABASE_URL: "file:./dev.db" });
  assert.equal("NEXT_PUBLIC_WORKBENCH_DATA_SOURCE" in playwright, false);
});

test("deploy demo config is explicit, isolated, and credential-shaped", () => {
  const environment = createDeployDemoCommandEnvironment({
    baseEnv: { KEEP_ME: "yes" },
    databasePath: "C:/tmp/production.db",
    artifactRoot: "C:/tmp/artifacts",
    bootstrapPassword: "fixture-only-password",
  });

  assert.deepEqual(environment, {
    KEEP_ME: "yes",
    SHANHAI_AUTH_MODE: "password",
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_TRUST_PROXY: "1",
    SHANHAI_APP_INSTANCE_COUNT: "1",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_BOOTSTRAP_ADMIN_EMAIL: "deploy_demo_admin",
    SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: "部署验收管理员",
    SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: "fixture-only-password",
    DATABASE_URL: "file:C:/tmp/production.db",
    ARTIFACT_STORAGE_ROOT: "C:/tmp/artifacts",
  });
});
