import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ProviderLedgerManifestContractError,
  readProviderLedgerManifest,
  resolveAgentBrainPurposeForChannel,
  resolveProviderLedgerValueSource,
  resolveProviderRuntimeContract as readProviderRuntimeContract,
  type AgentBrainRuntimeContract,
  type ProviderRuntimeContract,
} from "./provider-ledger-contract.mjs";

export type ProviderLedgerPurpose =
  | "main_agent_responses"
  | "critic_responses"
  | "fallback_responses";

export type ProviderLedgerChannel = "primary" | "third" | "fallback";
export type ProviderEndpointCategory = "openai_compatible_responses";
export type ProviderLedgerCredentialSource = "ledger_private_env" | "deployment_secret";

export type ProviderLedgerConfig = {
  providerId: string;
  capability: string;
  purpose: ProviderLedgerPurpose;
  channel: ProviderLedgerChannel;
  credential: string;
  credentialSource: ProviderLedgerCredentialSource;
  baseURL?: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  endpointCategory: ProviderEndpointCategory;
};

export type ProviderLedgerEnv = Record<string, string | undefined> & {
  SHANHAI_PROVIDER_LEDGER_ROOT?: string;
  SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE?: "ledger_private_env" | "deployment_secret";
};

type ProviderManifestEntry = {
  id: string;
  env_vars: string[];
};

type ProviderLedgerManifest = {
  version: number;
  providers: ProviderManifestEntry[];
};

type ResolveProviderLedgerConfigInput = {
  ledgerRoot?: string;
  capability: string;
  purpose: ProviderLedgerPurpose;
  ambientEnv?: ProviderLedgerEnv;
};

export type ResolveProviderLedgerValueBagInput = {
  ledgerRoot?: string;
  capability: string;
  ambientEnv?: ProviderLedgerEnv;
};

export type ProviderLedgerValueBag = {
  capability: string;
  source: ProviderLedgerCredentialSource;
  has(key: string): boolean;
  get(key: string): string | undefined;
  require(key: string): string;
};

export type ProviderAdapterEvidenceStatus = "passed" | "failed" | "skipped";
export type ProviderAdapterErrorCategory =
  | "none"
  | "authorization"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "provider"
  | "model_not_found"
  | "invalid_response"
  | "contract"
  | "unknown";

export type ProviderAdapterEvidenceInput = {
  ledgerRoot?: string;
  evidenceId: string;
  providerId: string;
  capability: string;
  purpose: ProviderLedgerPurpose;
  model: string;
  endpointCategory: ProviderEndpointCategory;
  status: ProviderAdapterEvidenceStatus;
  testedAt: string;
  errorCategory: ProviderAdapterErrorCategory;
  requestCount: number;
  retryCount: number;
};

export class ProviderLedgerContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProviderLedgerContractError";
  }
}

export function resolveProviderLedgerRoot(
  env: ProviderLedgerEnv = process.env,
  explicitRoot?: string,
): string {
  const candidate = explicitRoot?.trim() || env.SHANHAI_PROVIDER_LEDGER_ROOT?.trim() || path.resolve(process.cwd(), "API台账系统");
  return path.resolve(candidate);
}

export function resolveProviderLedgerConfig(input: ResolveProviderLedgerConfigInput): ProviderLedgerConfig {
  const runtimeContract = resolveAgentBrainRuntimeContract(input);
  const channel = runtimeContract.purposeChannels[input.purpose];
  if (!channel) {
    throw new ProviderLedgerContractError("LEDGER_PURPOSE_UNKNOWN", "Provider purpose is not declared in the runtime contract.");
  }
  const values = resolveProviderLedgerValueBag(input);
  const credential = values.require(channel.credentialEnv);
  const baseURL = values.require(channel.baseUrlEnv);
  const model = values.require(channel.modelEnv);
  const reasoningEffort = parseReasoningEffort(values.get(runtimeContract.reasoning.env), runtimeContract);

  const config = {
    providerId: input.capability,
    capability: input.capability,
    purpose: input.purpose,
    channel: channel.channel,
    credentialSource: values.source,
    baseURL,
    model,
    reasoningEffort,
    endpointCategory: "openai_compatible_responses",
  } as ProviderLedgerConfig;
  Object.defineProperty(config, "credential", {
    value: credential,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return config;
}

export function resolveSelectedProviderLedgerConfig(input: Omit<ResolveProviderLedgerConfigInput, "purpose">): ProviderLedgerConfig {
  const runtimeContract = resolveAgentBrainRuntimeContract(input);
  const values = resolveProviderLedgerValueBag(input);
  const selectedChannel = values.get(runtimeContract.selectedChannelEnv)?.trim().toLowerCase();
  if (!isProviderLedgerChannel(selectedChannel)) {
    throw new ProviderLedgerContractError("LEDGER_CHANNEL_UNKNOWN", "Selected Provider channel is not declared in the runtime contract.");
  }
  let selectedPurpose: ProviderLedgerPurpose;
  try {
    selectedPurpose = resolveAgentBrainPurposeForChannel(runtimeContract, selectedChannel);
  } catch (error) {
    throw normalizeManifestError(error);
  }
  return resolveProviderLedgerConfig({ ...input, purpose: selectedPurpose });
}

export function resolveProviderLedgerRuntimeContract(input: {
  ledgerRoot?: string;
  capability: string;
  ambientEnv?: ProviderLedgerEnv;
}): ProviderRuntimeContract {
  const ambientEnv = input.ambientEnv ?? process.env;
  const ledgerRoot = resolveProviderLedgerRoot(ambientEnv, input.ledgerRoot);
  try {
    return readProviderRuntimeContract({ ledgerRoot, capability: input.capability });
  } catch (error) {
    throw normalizeManifestError(error);
  }
}

export function resolveProviderLedgerValueBag(input: ResolveProviderLedgerValueBagInput): ProviderLedgerValueBag {
  const ambientEnv = input.ambientEnv ?? process.env;
  const ledgerRoot = resolveProviderLedgerRoot(ambientEnv, input.ledgerRoot);
  const manifest = readManifest(ledgerRoot);
  const provider = manifest.providers.find((entry) => entry.id === input.capability);
  if (!provider) {
    throw new ProviderLedgerContractError("LEDGER_CAPABILITY_NOT_FOUND", `Provider capability is not registered: ${safeLabel(input.capability)}`);
  }

  const declared = new Set(provider.env_vars);
  let resolved: ReturnType<typeof resolveProviderLedgerValueSource>;
  try {
    resolved = resolveProviderLedgerValueSource({
      ambientEnv,
      capability: input.capability,
      explicitLedgerRoot: Boolean(input.ledgerRoot?.trim() || ambientEnv.SHANHAI_PROVIDER_LEDGER_ROOT?.trim()),
      ledgerRoot,
    });
  } catch (error) {
    throw normalizeManifestError(error);
  }
  const assertDeclared = (key: string) => {
    if (!declared.has(key)) {
      throw new ProviderLedgerContractError("LEDGER_ENV_NOT_DECLARED", `Provider ledger variable is not declared: ${safeLabel(key)}`);
    }
  };
  const get = (key: string) => {
    assertDeclared(key);
    return trimOptional(resolved.values[key]);
  };

  return Object.freeze({
    capability: input.capability,
    source: resolved.source,
    has: (key: string) => declared.has(key),
    get,
    require: (key: string) => {
      const value = get(key);
      if (!value) {
        throw new ProviderLedgerContractError("LEDGER_VALUE_MISSING", `Provider ledger value is missing for ${safeLabel(key)}`);
      }
      return value;
    },
  });
}

export function tryResolveProviderLedgerValueBag(input: ResolveProviderLedgerValueBagInput): ProviderLedgerValueBag | null {
  try {
    return resolveProviderLedgerValueBag(input);
  } catch (error) {
    if (error instanceof ProviderLedgerContractError) return null;
    throw error;
  }
}

export function tryResolveProviderLedgerConfig(input: ResolveProviderLedgerConfigInput): ProviderLedgerConfig | null {
  try {
    return resolveProviderLedgerConfig(input);
  } catch (error) {
    if (error instanceof ProviderLedgerContractError) return null;
    throw error;
  }
}

export function tryResolveSelectedProviderLedgerConfig(
  input: Omit<ResolveProviderLedgerConfigInput, "purpose">,
): ProviderLedgerConfig | null {
  try {
    return resolveSelectedProviderLedgerConfig(input);
  } catch (error) {
    if (error instanceof ProviderLedgerContractError) return null;
    throw error;
  }
}

export async function writeProviderAdapterEvidence(input: ProviderAdapterEvidenceInput): Promise<{ path: string }> {
  const ledgerRoot = resolveProviderLedgerRoot(process.env, input.ledgerRoot);
  const manifest = readManifest(ledgerRoot);
  if (!manifest.providers.some((provider) => provider.id === input.providerId)) {
    throw new ProviderLedgerContractError("LEDGER_PROVIDER_NOT_FOUND", `Evidence provider is not registered: ${safeLabel(input.providerId)}`);
  }
  if (input.capability !== input.providerId) {
    throw new ProviderLedgerContractError("EVIDENCE_CAPABILITY_MISMATCH", "Evidence capability must match the registered provider id.");
  }
  assertEvidenceInput(input);

  const evidenceDirectory = path.resolve(ledgerRoot, "evidence", "provider-adapter-tests");
  assertWithinLedger(ledgerRoot, evidenceDirectory);
  const ledgerEvidenceRoot = path.dirname(evidenceDirectory);
  if (!existsSync(ledgerEvidenceRoot)) {
    throw new ProviderLedgerContractError("LEDGER_EVIDENCE_BOUNDARY_MISSING", "Provider ledger evidence boundary is unavailable.");
  }
  await mkdir(evidenceDirectory, { recursive: true });
  const targetPath = path.join(evidenceDirectory, `${input.evidenceId}.json`);
  assertWithinLedger(ledgerRoot, targetPath);

  const record = {
    schemaVersion: "provider-adapter-evidence.v1",
    evidenceId: input.evidenceId,
    providerId: input.providerId,
    capability: input.capability,
    purpose: input.purpose,
    model: input.model,
    endpointCategory: input.endpointCategory,
    status: input.status,
    testedAt: input.testedAt,
    errorCategory: input.errorCategory,
    requestCount: input.requestCount,
    retryCount: input.retryCount,
  };

  try {
    await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new ProviderLedgerContractError("EVIDENCE_ALREADY_EXISTS", `Provider evidence already exists: ${input.evidenceId}`);
    }
    throw error;
  }
  return { path: targetPath };
}

function readManifest(ledgerRoot: string): ProviderLedgerManifest {
  try {
    const manifest = readProviderLedgerManifest({ ledgerRoot });
    return {
      version: manifest.version,
      providers: manifest.providers.map((entry) => ({ id: entry.id, env_vars: [...entry.envVars] })),
    };
  } catch (error) {
    throw normalizeManifestError(error);
  }
}

function assertEvidenceInput(input: ProviderAdapterEvidenceInput) {
  for (const [label, value] of [
    ["evidenceId", input.evidenceId],
    ["providerId", input.providerId],
    ["capability", input.capability],
  ] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
      throw new ProviderLedgerContractError("EVIDENCE_FIELD_INVALID", `Evidence ${label} is invalid.`);
    }
  }
  if (!input.model.trim() || input.model.includes("://") || input.model.length > 160) {
    throw new ProviderLedgerContractError("EVIDENCE_FIELD_INVALID", "Evidence model is invalid.");
  }
  if (!Number.isInteger(input.requestCount) || input.requestCount < 0 || !Number.isInteger(input.retryCount) || input.retryCount < 0 || input.retryCount > input.requestCount) {
    throw new ProviderLedgerContractError("EVIDENCE_COUNT_INVALID", "Evidence request and retry counts are invalid.");
  }
  if (!Number.isFinite(Date.parse(input.testedAt))) {
    throw new ProviderLedgerContractError("EVIDENCE_TIME_INVALID", "Evidence testedAt is invalid.");
  }
}

function assertWithinLedger(ledgerRoot: string, target: string) {
  const relative = path.relative(path.resolve(ledgerRoot), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProviderLedgerContractError("LEDGER_PATH_ESCAPE", "Provider ledger path escapes the configured root.");
  }
}

function parseReasoningEffort(
  value: string | undefined,
  runtimeContract: AgentBrainRuntimeContract,
): ProviderLedgerConfig["reasoningEffort"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return runtimeContract.reasoning.default;
  if (runtimeContract.reasoning.allowed.includes(normalized as ProviderLedgerConfig["reasoningEffort"])) {
    return normalized as ProviderLedgerConfig["reasoningEffort"];
  }
  throw new ProviderLedgerContractError("LEDGER_REASONING_UNKNOWN", "Provider reasoning effort is not allowed by the runtime contract.");
}

function resolveAgentBrainRuntimeContract(input: {
  ledgerRoot?: string;
  capability: string;
  ambientEnv?: ProviderLedgerEnv;
}): AgentBrainRuntimeContract {
  const contract = resolveProviderLedgerRuntimeContract(input);
  if (contract.kind !== "agent_brain_responses") {
    throw new ProviderLedgerContractError("LEDGER_RUNTIME_CONTRACT_KIND_MISMATCH", "Provider runtime contract is not an Agent Brain contract.");
  }
  return contract;
}

function normalizeManifestError(error: unknown): ProviderLedgerContractError {
  if (error instanceof ProviderLedgerContractError) return error;
  if (error instanceof ProviderLedgerManifestContractError) {
    return new ProviderLedgerContractError(error.code, error.message);
  }
  return new ProviderLedgerContractError("LEDGER_MANIFEST_INVALID", "Provider ledger manifest could not be read.");
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isProviderLedgerChannel(value: string | undefined): value is ProviderLedgerChannel {
  return value === "primary" || value === "third" || value === "fallback";
}
