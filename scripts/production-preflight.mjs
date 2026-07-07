import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    checkDatabaseUrl(env),
    checkArtifactStorageRoot(cwd, env),
    checkOpenAiProvider(env),
    checkCozePptProvider(env),
    checkImageProvider(env),
    checkVideoProvider(env),
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

function checkDatabaseUrl(env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  const ok = Boolean(databaseUrl && databaseUrl.startsWith("file:") && databaseUrl !== "file:./dev.db");
  return buildCheck("database-url", ok, {
    message: ok ? "SQLite DATABASE_URL is explicitly configured for local production readiness." : "Set DATABASE_URL to an explicit file: SQLite path that is not file:./dev.db.",
    missing: databaseUrl ? [] : ["DATABASE_URL"],
    source: databaseUrl ? "sqlite_file" : "missing",
  });
}

function checkArtifactStorageRoot(cwd, env) {
  const storageRoot = env.ARTIFACT_STORAGE_ROOT?.trim();
  const absolute = Boolean(storageRoot && path.isAbsolute(storageRoot));
  const projectTmp = storageRoot ? path.resolve(storageRoot) === path.join(path.resolve(cwd), ".tmp") : false;
  const writable = storageRoot ? canAccessDirectory(storageRoot) : false;
  const ok = Boolean(storageRoot && absolute && !projectTmp && writable);
  return buildCheck("artifact-storage-root", ok, {
    message: ok ? "Artifact storage root is absolute and accessible." : "Set ARTIFACT_STORAGE_ROOT to an absolute writable directory outside project .tmp.",
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
  const missing = missingEnv(env, [channel.apiKey, channel.baseUrl, channel.model]);
  return buildCheck("provider-image", missing.length === 0, {
    message: missing.length === 0 ? "Image provider env is present." : "Image provider env is missing.",
    missing,
    source: channelName,
  });
}

function checkVideoProvider(env) {
  const hasOcto = hasAll(env, ["OCTO_API_KEY", "OCTO_BASE_URL"]) && Boolean(env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim());
  const hasNewApi = hasAll(env, ["NEWAPI_API_KEY", "NEWAPI_BASE_URL"]) && Boolean(env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim());
  const missing = hasOcto || hasNewApi ? [] : ["OCTO_API_KEY", "OCTO_BASE_URL", "VIDEO_MODEL"];
  return buildCheck("provider-video", missing.length === 0, {
    message: missing.length === 0 ? "Video provider env is present." : "Video provider env is missing.",
    missing,
    source: hasOcto ? "octo" : hasNewApi ? "newapi" : "missing",
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

function canAccessDirectory(directory) {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
