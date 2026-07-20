export function createDesktopServerEnvironment({
  baseEnv = {},
  port,
  databaseUrl,
  artifactStorageRoot,
} = {}) {
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    ARTIFACT_STORAGE_ROOT: artifactStorageRoot,
  };
}

export function createPlaywrightWebServerEnvironment(baseEnv = {}) {
  return {
    ...baseEnv,
    DATABASE_URL: baseEnv.DATABASE_URL ?? "file:./dev.db",
  };
}

export function createDeployDemoCommandEnvironment({
  baseEnv = {},
  databasePath,
  artifactRoot,
  bootstrapPassword,
} = {}) {
  return {
    ...baseEnv,
    SHANHAI_AUTH_MODE: "password",
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_TRUST_PROXY: "1",
    SHANHAI_APP_INSTANCE_COUNT: "1",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_BOOTSTRAP_ADMIN_EMAIL: "deploy_demo_admin",
    SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: "部署验收管理员",
    SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: bootstrapPassword,
    DATABASE_URL: `file:${databasePath}`,
    ARTIFACT_STORAGE_ROOT: artifactRoot,
  };
}
