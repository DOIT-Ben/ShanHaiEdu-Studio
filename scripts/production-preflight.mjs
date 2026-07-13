import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";

const openAiLedgerChannels = {
  primary: {
    apiKey: "AGENT_BRAIN_API_KEY",
    baseUrl: "AGENT_BRAIN_BASE_URL",
    model: "AGENT_BRAIN_MODEL",
    source: "agent_brain_primary",
  },
  third: {
    apiKey: "AGENT_BRAIN_THIRD_API_KEY",
    baseUrl: "AGENT_BRAIN_THIRD_BASE_URL",
    model: "AGENT_BRAIN_THIRD_MODEL",
    source: "agent_brain_third",
  },
  fallback: {
    apiKey: "AGENT_BRAIN_FALLBACK_API_KEY",
    baseUrl: "AGENT_BRAIN_FALLBACK_BASE_URL",
    model: "AGENT_BRAIN_FALLBACK_MODEL",
    source: "agent_brain_fallback",
  },
};

const imageChannels = {
  primary: {
    apiKey: "IMAGEGEN_MYSELF_PRIMARY_API_KEY",
    baseUrl: "IMAGEGEN_MYSELF_PRIMARY_BASE_URL",
    model: "IMAGEGEN_MYSELF_MODEL",
  },
  free: {
    apiKey: "IMAGEGEN_FREE_API_KEY",
    baseUrl: "IMAGEGEN_FREE_BASE_URL",
    model: "IMAGEGEN_FREE_MODEL",
  },
  free_primary: {
    apiKey: "IMAGEGEN_FREE_PRIMARY_API_KEY",
    baseUrl: "IMAGEGEN_FREE_PRIMARY_BASE_URL",
    model: "IMAGEGEN_FREE_PRIMARY_MODEL",
  },
  myself_fallback: {
    apiKey: "IMAGEGEN_MYSELF_FALLBACK_API_KEY",
    baseUrl: "IMAGEGEN_MYSELF_FALLBACK_BASE_URL",
    model: "IMAGEGEN_MYSELF_FALLBACK_MODEL",
  },
};

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
    checkAdminReadiness(cwd, env),
    checkArtifactStorageRoot(cwd, env),
    checkOpenAiProvider(env),
    checkCozePptProvider(env),
    checkImageProvider(env),
    checkVideoProvider(env),
    checkTtsProvider(env),
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

function checkOpenAiProvider(env) {
  if (hasAll(env, ["OPENAI_API_KEY", "OPENAI_MODEL"])) {
    return buildCheck("provider-openai", true, {
      message: "OpenAI-compatible provider env is present.",
      source: "openai_env",
    });
  }

  const channelName = (env.AGENT_BRAIN_CHANNEL?.trim() || "primary").toLowerCase();
  const channel = openAiLedgerChannels[channelName] ?? openAiLedgerChannels.primary;
  const missing = missingEnv(env, [channel.apiKey, channel.model]);
  return buildCheck("provider-openai", missing.length === 0, {
    message: missing.length === 0 ? "OpenAI-compatible ledger provider env is present." : "OpenAI-compatible provider env is missing.",
    missing,
    source: channel.source,
  });
}

function checkCozePptProvider(env) {
  const missing = missingEnv(env, ["COZE_PPT_RUN_URL", "COZE_API_TOKEN"]);
  return buildCheck("provider-coze-ppt", missing.length === 0, {
    message: missing.length === 0 ? "Coze PPT run env is present." : "Coze PPT run env is missing.",
    missing,
    source: "coze_run",
  });
}

function checkImageProvider(env) {
  const channelName = env.IMAGE_PROVIDER_CHANNEL?.trim() || "primary";
  const channel = imageChannels[channelName] ?? imageChannels.primary;
  const missing = missingEnv(env, [channel.apiKey, channel.baseUrl]);
  return buildCheck("provider-image", missing.length === 0, {
    message: missing.length === 0 ? "Image provider env is present." : "Image provider env is missing.",
    missing,
    source: channelName,
  });
}

function checkVideoProvider(env) {
  const wantsEvolink = env.VIDEO_PROVIDER_MODE?.trim() === "evolink" || Boolean(env.EVOLINK_API_KEY?.trim() || env.EVOLINK_VIDEO_API_KEY?.trim());
  if (wantsEvolink) {
    const hasKey = Boolean(env.EVOLINK_VIDEO_API_KEY?.trim() || env.EVOLINK_API_KEY?.trim());
    return buildCheck("provider-video", hasKey, {
      message: hasKey ? "Evolink video provider env is present." : "Evolink video provider env is missing.",
      missing: hasKey ? [] : ["EVOLINK_VIDEO_API_KEY"],
      source: "evolink",
    });
  }

  const hasOcto = hasAll(env, ["OCTO_API_KEY", "OCTO_BASE_URL"]) && Boolean(env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim());
  const hasNewApi = hasAll(env, ["NEWAPI_API_KEY", "NEWAPI_BASE_URL"]) && Boolean(env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim());
  const missing = hasOcto || hasNewApi ? [] : ["OCTO_API_KEY", "OCTO_BASE_URL", "VIDEO_MODEL"];
  return buildCheck("provider-video", missing.length === 0, {
    message: missing.length === 0 ? "Video provider env is present." : "Video provider env is missing.",
    missing,
    source: hasOcto ? "octo" : hasNewApi ? "newapi" : "missing",
  });
}

function checkTtsProvider(env) {
  const hasKey = Boolean(env.MINIMAX_TTS_API_KEY?.trim() || env.MINIMAX_API_KEY?.trim());
  return buildCheck("provider-tts", hasKey, {
    message: hasKey ? "MiniMax TTS provider env is present." : "MiniMax TTS provider env is missing.",
    missing: hasKey ? [] : ["MINIMAX_TTS_API_KEY"],
    source: "minimax_tts",
  });
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
  };
}

function missingEnv(env, keys) {
  return keys.filter((key) => !env[key]?.trim());
}

function hasAll(env, keys) {
  return missingEnv(env, keys).length === 0;
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
