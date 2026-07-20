import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";
import { checkSqliteSchemaReadiness } from "../src/server/health/sqlite-schema-readiness.mjs";

export async function runProductionPreflight({ cwd = process.cwd(), env = process.env } = {}) {
  const checks = [
    checkPackageScripts(cwd),
    checkNextStandalone(cwd),
    checkServerAuthMode(env),
    checkClientAuthMode(env),
    checkTrustedProxy(env),
    checkSingleInstanceTopology(env),
    checkPublicRegistration(env),
    checkDatabaseUrl(cwd, env),
    checkDatabaseSchemaReadiness(cwd, env),
    checkAdminReadiness(cwd, env),
    checkArtifactStorageRoot(cwd, env),
    checkOpenAiProvider(cwd, env),
    checkCozePptProvider(env),
    checkImageProvider(cwd, env),
    checkVideoProvider(env, cwd),
    checkTtsProvider(cwd, env),
  ];

  return {
    ok: checks.every((item) => item.ok),
    stage: "m31_production_preflight",
    checkedAt: new Date().toISOString(),
    checks,
  };
}

function checkPackageScripts(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
    const missing = ["build", "start"].filter((scriptName) => !pkg.scripts?.[scriptName]);
    return buildCheck("package-production-scripts", missing.length === 0, {
      message: missing.length === 0 ? "build/start scripts are present." : "Production build/start scripts are missing.",
      missing,
    });
  } catch {
    return buildCheck("package-production-scripts", false, {
      message: "package.json could not be read.",
      missing: ["package.json"],
    });
  }
}

function checkNextStandalone(cwd) {
  try {
    const configText = readFileSync(path.join(cwd, "next.config.ts"), "utf8");
    const ok = /output\s*:\s*["']standalone["']/.test(configText);
    return buildCheck("next-standalone-output", ok, {
      message: ok ? "Next standalone output is configured." : "Next standalone output is not configured.",
    });
  } catch {
    return buildCheck("next-standalone-output", false, {
      message: "next.config.ts could not be read.",
    });
  }
}

function checkServerAuthMode(env) {
  const ok = env.SHANHAI_AUTH_MODE?.trim().toLowerCase() === "password";
  return buildCheck("auth-server-mode", ok, {
    message: ok ? "Server authentication mode is password." : "Set SHANHAI_AUTH_MODE=password for production.",
    missing: env.SHANHAI_AUTH_MODE?.trim() ? [] : ["SHANHAI_AUTH_MODE"],
    source: ok ? "password" : "invalid",
  });
}

function checkSingleInstanceTopology(env) {
  const declared = parsePositiveInteger(env.SHANHAI_APP_INSTANCE_COUNT);
  const workerOverrides = ["WEB_CONCURRENCY", "PM2_INSTANCES", "NODE_CLUSTER_WORKERS"]
    .filter((name) => env[name]?.trim())
    .map((name) => ({ name, count: parsePositiveInteger(env[name]) }));
  const conflicting = workerOverrides.filter((entry) => entry.count !== 1).map((entry) => entry.name);
  const ok = declared === 1 && conflicting.length === 0;
  return buildCheck("single-instance-topology", ok, {
    message: ok
      ? "Single application instance topology is declared for SQLite."
      : "Declare exactly one application instance and remove multi-worker overrides before using SQLite in production.",
    missing: env.SHANHAI_APP_INSTANCE_COUNT?.trim() ? conflicting : ["SHANHAI_APP_INSTANCE_COUNT", ...conflicting],
    source: ok ? "single_process_sqlite" : "invalid",
  });
}

function checkClientAuthMode(env) {
  const ok = env.NEXT_PUBLIC_SHANHAI_AUTH_MODE?.trim().toLowerCase() === "password";
  return buildCheck("auth-client-mode", ok, {
    message: ok ? "Client authentication mode is password." : "Set NEXT_PUBLIC_SHANHAI_AUTH_MODE=password at build time.",
    missing: env.NEXT_PUBLIC_SHANHAI_AUTH_MODE?.trim() ? [] : ["NEXT_PUBLIC_SHANHAI_AUTH_MODE"],
    source: ok ? "password" : "invalid",
  });
}

function checkTrustedProxy(env) {
  const ok = env.SHANHAI_TRUST_PROXY?.trim() === "1";
  return buildCheck("trusted-proxy", ok, {
    message: ok ? "Trusted reverse proxy mode is enabled." : "Set SHANHAI_TRUST_PROXY=1 behind a proxy that overwrites forwarding headers.",
    missing: env.SHANHAI_TRUST_PROXY?.trim() ? [] : ["SHANHAI_TRUST_PROXY"],
    source: ok ? "trusted_proxy" : "invalid",
  });
}

function checkPublicRegistration(env) {
  const serverConfigured = env.SHANHAI_PUBLIC_REGISTRATION_ENABLED?.trim();
  const clientConfigured = env.NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED?.trim();
  const ok = serverConfigured === "0" && clientConfigured === "0";
  return buildCheck("public-registration", ok, {
    message: ok ? "Public registration is disabled on server and client." : "Set both public registration flags to 0 for production.",
    missing: [
      ...(serverConfigured ? [] : ["SHANHAI_PUBLIC_REGISTRATION_ENABLED"]),
      ...(clientConfigured ? [] : ["NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED"]),
    ],
    source: ok ? "disabled" : "invalid",
  });
}

function checkDatabaseUrl(cwd, env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  const databasePath = tryResolveDatabasePath(databaseUrl, cwd);
  const absolute = Boolean(databasePath && path.isAbsolute(databasePath));
  const releaseRealpath = tryRealpath(cwd);
  const configuredOutsideRelease = Boolean(databasePath && absolute && releaseRealpath && !isPathInside(releaseRealpath, databasePath));
  const databaseRealpath = databasePath ? tryRealpath(databasePath) : null;
  const databaseParentRealpath = databasePath ? tryRealpath(path.dirname(databasePath)) : null;
  const realpathOutsideRelease = Boolean(
    databaseRealpath && databaseParentRealpath && releaseRealpath &&
      !isPathInside(releaseRealpath, databaseRealpath) &&
      !isPathInside(releaseRealpath, databaseParentRealpath),
  );
  const nonDefault = Boolean(databasePath && path.basename(databasePath).toLowerCase() !== "dev.db");
  const ok = Boolean(databasePath && absolute && configuredOutsideRelease && realpathOutsideRelease && nonDefault);
  return buildCheck("database-url", ok, {
    message: ok ? "SQLite DATABASE_URL uses an external absolute production path." : "Set DATABASE_URL to a non-default absolute SQLite file path outside the release directory.",
    missing: databaseUrl ? [] : ["DATABASE_URL"],
    source: ok ? "external_sqlite_file" : databaseUrl ? "invalid" : "missing",
    absolute,
  });
}

function checkAdminReadiness(cwd, env) {
  const databasePath = tryResolveDatabasePath(env.DATABASE_URL?.trim(), cwd);
  const ok = databasePath ? hasActivePasswordAdmin(databasePath) : false;
  return buildCheck("admin-readiness", ok, {
    message: ok ? "An active password administrator exists in SQLite." : "Initialize and verify a password administrator in the configured SQLite database.",
    missing: databasePath ? [] : ["DATABASE_URL"],
    source: ok ? "sqlite_password_admin" : "missing_or_invalid_admin",
  });
}

function checkDatabaseSchemaReadiness(cwd, env) {
  const databasePath = tryResolveDatabasePath(env.DATABASE_URL?.trim(), cwd);
  const readiness = databasePath
    ? checkSqliteSchemaReadiness(databasePath)
    : { ready: false, reasons: [{ code: "database_configuration_invalid" }] };
  return buildCheck("database-schema-readiness", readiness.ready, {
    message: readiness.ready
      ? "SQLite schema contains the required control-plane tables, columns, indexes, and triggers."
      : "Initialize or upgrade SQLite before starting the application.",
    missing: readiness.reasons.map(formatSchemaReason),
    reasons: readiness.reasons,
    source: readiness.ready ? "sqlite_schema_contract" : "missing_or_incompatible_schema",
  });
}

function hasActivePasswordAdmin(databasePath) {
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const admin = db
      .prepare(
        'SELECT "id" FROM "LocalUser" WHERE "role" = ? AND "authMode" = ? AND "passwordHash" IS NOT NULL AND length(trim("passwordHash")) > 0 LIMIT 1',
      )
      .get("admin", "password");
    return Boolean(admin?.id);
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function checkArtifactStorageRoot(cwd, env) {
  const storageRoot = env.ARTIFACT_STORAGE_ROOT?.trim();
  const absolute = Boolean(storageRoot && path.isAbsolute(storageRoot));
  const configuredPath = storageRoot && absolute ? path.resolve(storageRoot) : null;
  const releasePath = tryRealpath(cwd);
  const storageRealpath = storageRoot ? tryRealpath(storageRoot) : null;
  const configuredOutsideRelease = Boolean(configuredPath && releasePath && !isPathInside(releasePath, configuredPath));
  const realpathOutsideRelease = Boolean(storageRealpath && releasePath && !isPathInside(releasePath, storageRealpath));
  const writable = storageRealpath ? canAccessDirectory(storageRealpath) : false;
  const ok = Boolean(storageRoot && absolute && configuredOutsideRelease && realpathOutsideRelease && writable);
  return buildCheck("artifact-storage-root", ok, {
    message: ok ? "Artifact storage root resolves outside the release and is accessible." : "Set ARTIFACT_STORAGE_ROOT to a real, absolute, writable directory outside the release tree.",
    missing: storageRoot ? [] : ["ARTIFACT_STORAGE_ROOT"],
    source: storageRoot ? "configured" : "missing",
    absolute,
    writable,
  });
}

function checkOpenAiProvider(cwd, env) {
  return checkGatewayCapability("provider-openai", cwd, env, "MODEL_GATEWAY_AGENT_MODEL");
}

function checkCozePptProvider(env) {
  const local = env.COZE_PPT_CHANNEL?.trim().toLowerCase() === "cli" || env.COZE_PPT_USE_CLI?.trim() === "1";
  return buildCheck("provider-coze-ppt", local, {
    message: local ? "PPTX generation uses the local controlled CLI path." : "Legacy remote Coze PPT is disabled in gateway-only mode.",
    missing: local ? [] : ["COZE_PPT_CHANNEL=cli"],
    source: local ? "local_cli" : "disabled_gateway_only",
  });
}

function checkImageProvider(cwd, env) {
  return checkGatewayCapability("provider-image", cwd, env, "MODEL_GATEWAY_IMAGE_MODEL");
}

function checkVideoProvider(env, cwd = process.cwd()) {
  return checkGatewayCapability("provider-video", cwd, env, "MODEL_GATEWAY_VIDEO_MODEL");
}

function checkTtsProvider(cwd, env) {
  return checkGatewayCapability("provider-tts", cwd, env, "MODEL_GATEWAY_TTS_MODEL");
}

function checkGatewayCapability(id, cwd, env, modelName) {
  const values = resolveGatewayValues(cwd, env);
  const missing = ["MODEL_GATEWAY_BASE_URL", "MODEL_GATEWAY_API_KEY", modelName].filter((name) => !values[name]?.trim());
  return buildCheck(id, missing.length === 0, {
    message: missing.length === 0 ? "Unified model gateway configuration is present." : "Unified model gateway configuration is incomplete.",
    missing,
    source: "model_gateway",
  });
}

function resolveGatewayValues(cwd, env) {
  const localEnv = path.resolve(cwd, ".env.local");
  const pointer = env.MODEL_GATEWAY_ENV_FILE?.trim() || (env.SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV === "1" ? "" : (existsSync(localEnv) ? parseSimpleEnv(readFileSync(localEnv, "utf8")).MODEL_GATEWAY_ENV_FILE : ""));
  let fileValues = {};
  if (pointer && existsSync(pointer)) {
    const raw = readFileSync(pointer, "utf8").trim();
    try {
      const value = JSON.parse(raw);
      if (typeof value.key === "string" && typeof value.url === "string") {
        const normalizedUrl = value.url.replace(/\/+$/, "");
        fileValues = { MODEL_GATEWAY_API_KEY: value.key, MODEL_GATEWAY_BASE_URL: normalizedUrl.endsWith("/v1") ? normalizedUrl : `${normalizedUrl}/v1` };
      }
    } catch {
      fileValues = parseSimpleEnv(raw);
    }
  }
  return {
    MODEL_GATEWAY_AGENT_MODEL: "gpt-5.6",
    MODEL_GATEWAY_TEXT_MODEL: "deepseek",
    MODEL_GATEWAY_IMAGE_MODEL: "image-2",
    MODEL_GATEWAY_VIDEO_MODEL: "video-grok",
    MODEL_GATEWAY_TTS_MODEL: "speech-2.8-hd",
    ...fileValues,
    ...env,
  };
}

function parseSimpleEnv(raw) {
  return Object.fromEntries(raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}

function buildCheck(id, ok, detail) {
  return {
    id,
    ok,
    message: detail.message,
    missing: detail.missing ?? [],
    source: detail.source,
    absolute: detail.absolute,
    writable: detail.writable,
    reasons: detail.reasons,
  };
}

function formatSchemaReason(reason) {
  if (reason.code === "database_schema_missing_table") return `table:${reason.table}`;
  if (reason.code === "database_schema_missing_column") return `column:${reason.table}.${reason.column}`;
  if (reason.code === "database_schema_missing_index") return `index:${reason.table}.${reason.index}`;
  if (reason.code === "database_schema_invalid_index") return `index-invalid:${reason.table}.${reason.index}`;
  if (reason.code === "database_schema_missing_trigger") return `trigger:${reason.table}.${reason.trigger}`;
  if (reason.code === "database_schema_invalid_trigger") return `trigger-invalid:${reason.table}.${reason.trigger}`;
  return reason.code;
}

function parsePositiveInteger(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function canAccessDirectory(directory) {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function tryResolveDatabasePath(databaseUrl, cwd) {
  try {
    return resolveSqliteFileUrl(databaseUrl, { baseDir: cwd, requireAbsolute: true });
  } catch {
    return null;
  }
}

function tryRealpath(directory) {
  try {
    return realpathSync(directory);
  } catch {
    return null;
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  if (process.env.SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV !== "1") {
    await import("dotenv/config");
  }
  const result = await runProductionPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(2);
  }
}
