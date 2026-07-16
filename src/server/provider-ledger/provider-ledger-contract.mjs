import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PROVIDER_RUNTIME_CONTRACT_VERSION = "provider-runtime-contract.v1";

const agentBrainPurposes = [
  "main_agent_responses",
  "critic_responses",
  "fallback_responses",
];
const agentBrainChannels = ["primary", "third", "fallback"];
const reasoningEfforts = ["low", "medium", "high", "xhigh"];
const privateEnvRelativePath = path.join("PRIVATE-LOCAL-SECRETS", "apps-api", ".env");

export class ProviderLedgerManifestContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderLedgerManifestContractError";
    this.code = code;
  }
}

export function resolveProviderLedgerManifestRoot({ cwd = process.cwd(), env = process.env, explicitRoot } = {}) {
  const candidate = explicitRoot?.trim() || env.SHANHAI_PROVIDER_LEDGER_ROOT?.trim() || path.resolve(cwd, "API台账系统");
  return path.resolve(candidate);
}

export function readProviderLedgerManifest({ ledgerRoot }) {
  const root = path.resolve(ledgerRoot);
  const manifestPath = path.resolve(root, "manifest.json");
  assertWithin(root, manifestPath);
  let value;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw contractError("LEDGER_MANIFEST_INVALID", "Provider ledger manifest is missing or invalid.");
  }
  if (!isRecord(value) || typeof value.version !== "number" || !Array.isArray(value.providers)) {
    throw contractError("LEDGER_MANIFEST_INVALID", "Provider ledger manifest has an invalid root contract.");
  }

  const ids = new Set();
  const providers = value.providers.map((entry) => {
    if (!isRecord(entry) || !isSafeId(entry.id) || !Array.isArray(entry.env_vars) || !entry.env_vars.every(isEnvName)) {
      throw contractError("LEDGER_MANIFEST_INVALID", "Provider ledger contains an invalid provider entry.");
    }
    if (ids.has(entry.id)) throw contractError("LEDGER_MANIFEST_INVALID", "Provider ledger contains duplicate provider ids.");
    ids.add(entry.id);
    return {
      id: entry.id,
      envVars: [...entry.env_vars],
      runtimeContract: entry.runtime_contract,
    };
  });
  return Object.freeze({ version: value.version, providers: Object.freeze(providers) });
}

export function resolveProviderRuntimeContract({ ledgerRoot, capability }) {
  const manifest = readProviderLedgerManifest({ ledgerRoot });
  const provider = manifest.providers.find((entry) => entry.id === capability);
  if (!provider) throw contractError("LEDGER_CAPABILITY_NOT_FOUND", "Provider capability is not registered.");
  if (!isRecord(provider.runtimeContract)) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_MISSING", "Provider runtime contract is missing.");
  }
  const contract = provider.runtimeContract;
  if (contract.schema_version !== PROVIDER_RUNTIME_CONTRACT_VERSION || typeof contract.kind !== "string") {
    throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Provider runtime contract version or kind is invalid.");
  }
  const declared = new Set(provider.envVars);
  if (contract.kind === "agent_brain_responses") return parseAgentBrainContract(contract, declared);
  if (contract.kind === "minimax_image") return parseMiniMaxImageContract(contract, declared);
  if (contract.kind === "minimax_tts") return parseMiniMaxTtsContract(contract, declared);
  throw contractError("LEDGER_RUNTIME_CONTRACT_UNKNOWN", "Provider runtime contract kind is unknown.");
}

export function resolveProviderLedgerValueSource({
  ledgerRoot,
  capability,
  ambientEnv = process.env,
  explicitLedgerRoot = Boolean(ambientEnv.SHANHAI_PROVIDER_LEDGER_ROOT?.trim()),
}) {
  const root = path.resolve(ledgerRoot);
  const manifest = readProviderLedgerManifest({ ledgerRoot: root });
  const provider = manifest.providers.find((entry) => entry.id === capability);
  if (!provider) throw contractError("LEDGER_CAPABILITY_NOT_FOUND", "Provider capability is not registered.");

  const requestedSource = ambientEnv.SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE;
  if (requestedSource && requestedSource !== "deployment_secret" && requestedSource !== "ledger_private_env") {
    throw contractError("LEDGER_SECRET_SOURCE_UNKNOWN", "Provider ledger credential source is unknown.");
  }
  const privateValues = readPrivateLedgerEnv(root);
  let source;
  let sourceValues;
  if (requestedSource === "deployment_secret") {
    source = "deployment_secret";
    sourceValues = ambientEnv;
  } else if (requestedSource === "ledger_private_env") {
    source = "ledger_private_env";
    sourceValues = privateValues;
  } else if (explicitLedgerRoot && Object.keys(privateValues).length > 0) {
    source = "ledger_private_env";
    sourceValues = privateValues;
  } else if (ambientEnv.NODE_ENV === "test") {
    source = "deployment_secret";
    sourceValues = ambientEnv;
  } else if (Object.keys(privateValues).length > 0) {
    source = "ledger_private_env";
    sourceValues = privateValues;
  } else {
    source = "deployment_secret";
    sourceValues = ambientEnv;
  }

  const values = {};
  for (const envName of provider.envVars) {
    const value = sourceValues[envName];
    if (typeof value === "string") values[envName] = value;
  }
  return Object.freeze({
    capability,
    source,
    declaredEnvNames: Object.freeze([...provider.envVars]),
    values: Object.freeze(values),
  });
}

export function resolveAgentBrainPurposeForChannel(contract, channel) {
  if (!isRecord(contract) || contract.kind !== "agent_brain_responses") {
    throw contractError("LEDGER_RUNTIME_CONTRACT_KIND_MISMATCH", "Provider runtime contract is not an Agent Brain contract.");
  }
  const match = Object.entries(contract.purposeChannels).find(([, entry]) => entry.channel === channel);
  if (!match) throw contractError("LEDGER_CHANNEL_UNKNOWN", "Selected Provider channel is not declared in the runtime contract.");
  return match[0];
}

function parseAgentBrainContract(value, declared) {
  if (value.endpoint_category !== "openai_compatible_responses" || !isEnvName(value.selected_channel_env)) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain endpoint or selected-channel contract is invalid.");
  }
  assertDeclared(declared, value.selected_channel_env);
  if (!isRecord(value.purpose_channels) || !isRecord(value.reasoning)) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain purpose or reasoning contract is invalid.");
  }

  const purposeChannels = {};
  const usedChannels = new Set();
  for (const purpose of agentBrainPurposes) {
    const entry = value.purpose_channels[purpose];
    if (!isRecord(entry) || !agentBrainChannels.includes(entry.channel)) {
      throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain purpose channel is invalid.");
    }
    if (usedChannels.has(entry.channel)) {
      throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain channels must map to one purpose each.");
    }
    usedChannels.add(entry.channel);
    for (const key of [entry.credential_env, entry.base_url_env, entry.model_env]) {
      if (!isEnvName(key)) throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain environment binding is invalid.");
      assertDeclared(declared, key);
    }
    purposeChannels[purpose] = Object.freeze({
      channel: entry.channel,
      credentialEnv: entry.credential_env,
      baseUrlEnv: entry.base_url_env,
      modelEnv: entry.model_env,
    });
  }
  if (Object.keys(value.purpose_channels).some((purpose) => !agentBrainPurposes.includes(purpose))) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain contains an unknown purpose.");
  }

  const reasoningEnv = value.reasoning.env;
  const defaultReasoning = value.reasoning.default;
  const allowedReasoning = value.reasoning.allowed;
  if (!isEnvName(reasoningEnv) || !reasoningEfforts.includes(defaultReasoning) ||
      !Array.isArray(allowedReasoning) || allowedReasoning.length === 0 ||
      !allowedReasoning.every((item) => reasoningEfforts.includes(item)) ||
      new Set(allowedReasoning).size !== allowedReasoning.length ||
      !allowedReasoning.includes(defaultReasoning)) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Agent Brain reasoning contract is invalid.");
  }
  assertDeclared(declared, reasoningEnv);

  return Object.freeze({
    schemaVersion: PROVIDER_RUNTIME_CONTRACT_VERSION,
    kind: "agent_brain_responses",
    endpointCategory: "openai_compatible_responses",
    selectedChannelEnv: value.selected_channel_env,
    purposeChannels: Object.freeze(purposeChannels),
    reasoning: Object.freeze({
      env: reasoningEnv,
      default: defaultReasoning,
      allowed: Object.freeze([...allowedReasoning]),
    }),
  });
}

function parseMiniMaxImageContract(value, declared) {
  const selectedChannelEnv = requiredEnvBinding(value.selected_channel_env, declared);
  const requiredChannel = requiredLiteral(value.required_channel, "minimax");
  return Object.freeze({
    schemaVersion: PROVIDER_RUNTIME_CONTRACT_VERSION,
    kind: "minimax_image",
    selectedChannelEnv,
    requiredChannel,
    credentialEnv: requiredEnvBinding(value.credential_env, declared),
    baseUrlEnv: requiredEnvBinding(value.base_url_env, declared),
    modelEnv: requiredEnvBinding(value.model_env, declared),
  });
}

function parseMiniMaxTtsContract(value, declared) {
  const selectedModeEnv = requiredEnvBinding(value.selected_mode_env, declared);
  const requiredMode = requiredLiteral(value.required_mode, "minimax");
  return Object.freeze({
    schemaVersion: PROVIDER_RUNTIME_CONTRACT_VERSION,
    kind: "minimax_tts",
    selectedModeEnv,
    requiredMode,
    credentialEnv: requiredEnvBinding(value.credential_env, declared),
    baseUrlEnv: requiredEnvBinding(value.base_url_env, declared),
    modelEnv: requiredEnvBinding(value.model_env, declared),
  });
}

function requiredEnvBinding(value, declared) {
  if (!isEnvName(value)) throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Provider environment binding is invalid.");
  assertDeclared(declared, value);
  return value;
}

function requiredLiteral(value, expected) {
  if (value !== expected) throw contractError("LEDGER_RUNTIME_CONTRACT_INVALID", "Provider runtime selection is invalid.");
  return expected;
}

function assertDeclared(declared, envName) {
  if (!declared.has(envName)) {
    throw contractError("LEDGER_RUNTIME_CONTRACT_UNDECLARED_ENV", "Provider runtime contract references an undeclared environment variable.");
  }
}

function assertWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw contractError("LEDGER_PATH_ESCAPE", "Provider ledger path escapes its configured root.");
  }
}

function readPrivateLedgerEnv(ledgerRoot) {
  const envPath = path.resolve(ledgerRoot, privateEnvRelativePath);
  assertWithin(ledgerRoot, envPath);
  if (!existsSync(envPath)) return {};
  return parseEnv(readFileSync(envPath, "utf8"));
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = unquote(trimmed.slice(separator + 1).trim());
  }
  return values;
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function contractError(code, message) {
  return new ProviderLedgerManifestContractError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function isEnvName(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value);
}
