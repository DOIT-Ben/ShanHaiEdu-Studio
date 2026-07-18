import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";
import { checkSqliteSchemaReadiness } from "../src/server/health/sqlite-schema-readiness.mjs";
import {
  resolveProviderLedgerManifestRoot,
  resolveProviderLedgerValueSource,
  resolveProviderRuntimeContract,
} from "../src/server/provider-ledger/provider-ledger-contract.mjs";

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
    checkVideoProvider(env),
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
  try {
    const { contract, valueSource } = resolveRuntimeProvider(cwd, env, "agent_brain");
    if (contract.kind !== "agent_brain_responses") throw new Error("agent_brain_contract_kind_invalid");
    const selectedChannel = providerValue(valueSource, contract.selectedChannelEnv)?.toLowerCase();
    const channel = Object.values(contract.purposeChannels).find((entry) => entry.channel === selectedChannel);
    if (!selectedChannel || !channel) {
      return buildCheck("provider-openai", false, {
        message: "Select a ledger-declared Agent Brain channel for production.",
        missing: selectedChannel ? [] : [contract.selectedChannelEnv],
        source: "provider_ledger:invalid_channel",
      });
    }
    const missing = missingProviderValues(valueSource, [channel.credentialEnv, channel.baseUrlEnv, channel.modelEnv]);
    const reasoning = providerValue(valueSource, contract.reasoning.env)?.toLowerCase() || contract.reasoning.default;
    const reasoningAllowed = contract.reasoning.allowed.includes(reasoning);
    return buildCheck("provider-openai", missing.length === 0 && reasoningAllowed, {
      message: missing.length === 0 && reasoningAllowed
        ? "Agent Brain matches the ledger runtime contract."
        : "Agent Brain does not satisfy the ledger runtime contract.",
      missing,
      source: `provider_ledger:${selectedChannel}`,
    });
  } catch {
    return invalidLedgerCheck("provider-openai", "Agent Brain ledger runtime contract is unavailable or invalid.");
  }
}

function checkCozePptProvider(env) {
  const missing = missingEnv(env, ["COZE_PPT_RUN_URL", "COZE_API_TOKEN"]);
  return buildCheck("provider-coze-ppt", missing.length === 0, {
    message: missing.length === 0 ? "Coze PPT run env is present." : "Coze PPT run env is missing.",
    missing,
    source: "coze_run",
  });
}

function checkImageProvider(cwd, env) {
  try {
    const { contract, valueSource } = resolveRuntimeProvider(cwd, env, "image_generation");
    if (contract.kind !== "minimax_image") throw new Error("image_contract_kind_invalid");
    const selectedChannel = providerValue(valueSource, contract.selectedChannelEnv)?.toLowerCase();
    const missing = missingProviderValues(valueSource, [contract.credentialEnv, contract.baseUrlEnv, contract.modelEnv]);
    const ok = selectedChannel === contract.requiredChannel && missing.length === 0;
    return buildCheck("provider-image", ok, {
      message: ok ? "MiniMax image generation matches the ledger runtime contract." : "Only the ledger-declared MiniMax image channel is release-ready.",
      missing: selectedChannel ? missing : [contract.selectedChannelEnv, ...missing],
      source: selectedChannel === contract.requiredChannel ? "provider_ledger:minimax" : "provider_ledger:invalid_channel",
    });
  } catch {
    return invalidLedgerCheck("provider-image", "Image ledger runtime contract is unavailable or invalid.");
  }
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

function checkTtsProvider(cwd, env) {
  try {
    const { contract, valueSource } = resolveRuntimeProvider(cwd, env, "tts_minimax");
    if (contract.kind !== "minimax_tts") throw new Error("tts_contract_kind_invalid");
    const selectedMode = providerValue(valueSource, contract.selectedModeEnv)?.toLowerCase();
    const missing = missingProviderValues(valueSource, [contract.credentialEnv, contract.baseUrlEnv, contract.modelEnv]);
    const ok = selectedMode === contract.requiredMode && missing.length === 0;
    return buildCheck("provider-tts", ok, {
      message: ok ? "MiniMax TTS matches the ledger runtime contract." : "MiniMax TTS requires the ledger-declared mode, key, base URL, and model.",
      missing: selectedMode ? missing : [contract.selectedModeEnv, ...missing],
      source: selectedMode === contract.requiredMode ? "provider_ledger:minimax" : "provider_ledger:invalid_mode",
    });
  } catch {
    return invalidLedgerCheck("provider-tts", "TTS ledger runtime contract is unavailable or invalid.");
  }
}

function resolveRuntimeProvider(cwd, env, capability) {
  const ledgerRoot = resolveProviderLedgerManifestRoot({ cwd, env });
  return {
    contract: resolveProviderRuntimeContract({ ledgerRoot, capability }),
    valueSource: resolveProviderLedgerValueSource({
      ledgerRoot,
      capability,
      ambientEnv: env,
      explicitLedgerRoot: Boolean(env.SHANHAI_PROVIDER_LEDGER_ROOT?.trim()),
    }),
  };
}

function invalidLedgerCheck(id, message) {
  return buildCheck(id, false, {
    message,
    missing: ["provider-ledger-runtime-contract"],
    source: "provider_ledger:invalid_contract",
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

function missingEnv(env, keys) {
  return keys.filter((key) => !env[key]?.trim());
}

function missingProviderValues(valueSource, keys) {
  return keys.filter((key) => !providerValue(valueSource, key));
}

function providerValue(valueSource, key) {
  const value = valueSource.values[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
