import {
  tryResolveSelectedProviderLedgerConfig,
  type ProviderLedgerEnv,
} from "@/server/provider-ledger/provider-ledger-adapter";
import { createHash } from "node:crypto";

export type OpenAICompatibleEnv = ProviderLedgerEnv & {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  AGENT_BRAIN_CHANNEL?: string;
  AGENT_BRAIN_API_KEY?: string;
  AGENT_BRAIN_BASE_URL?: string;
  AGENT_BRAIN_MODEL?: string;
  AGENT_BRAIN_THIRD_API_KEY?: string;
  AGENT_BRAIN_THIRD_BASE_URL?: string;
  AGENT_BRAIN_THIRD_MODEL?: string;
  AGENT_BRAIN_FALLBACK_API_KEY?: string;
  AGENT_BRAIN_FALLBACK_BASE_URL?: string;
  AGENT_BRAIN_FALLBACK_MODEL?: string;
  AGENT_BRAIN_REASONING_EFFORT?: string;
};

export type OpenAIReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type OpenAICompatibleCredentialSource =
  | "provider_ledger_private_env"
  | "provider_ledger_deployment_secret";

export type OpenAICompatibleDigestCredentialSource =
  | OpenAICompatibleCredentialSource
  | "ledger_private_env"
  | "deployment_secret";

export type OpenAICompatibleConfig = {
  credential: string;
  credentialSource: OpenAICompatibleCredentialSource;
  baseURL?: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  channel: AgentBrainChannel;
  endpointCategory: "openai_compatible_responses";
};

export type AgentBrainChannel = "primary" | "third" | "fallback";

export function pickOpenAICompatibleConfig(env: OpenAICompatibleEnv = process.env): OpenAICompatibleConfig | null {
  const ledgerConfig = tryResolveSelectedProviderLedgerConfig({
    capability: "agent_brain",
    ambientEnv: env,
  });
  if (!ledgerConfig) return null;
  const config = {
    credentialSource: ledgerConfig.credentialSource === "ledger_private_env"
      ? "provider_ledger_private_env"
      : "provider_ledger_deployment_secret",
    baseURL: ledgerConfig.baseURL,
    model: ledgerConfig.model,
    reasoningEffort: ledgerConfig.reasoningEffort,
    channel: ledgerConfig.channel,
    endpointCategory: ledgerConfig.endpointCategory,
  } as OpenAICompatibleConfig;
  Object.defineProperty(config, "credential", {
    value: ledgerConfig.credential,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(config);
}

export function createOpenAICompatibleConfigDigest(config: Omit<OpenAICompatibleConfig, "credentialSource"> & {
  credentialSource: OpenAICompatibleDigestCredentialSource;
}): string {
  const credentialFingerprint = createHash("sha256")
    .update("shanhai.provider-credential-fingerprint.v1\0", "utf8")
    .update(config.credential, "utf8")
    .digest();
  return createHash("sha256")
    .update("shanhai.openai-compatible-config-digest.v2\0", "utf8")
    .update(JSON.stringify({
      channel: config.channel,
      baseURL: config.baseURL ?? null,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      credentialSource: normalizeDigestCredentialSource(config.credentialSource),
      endpointCategory: config.endpointCategory,
    }), "utf8")
    .update("\0credential-fingerprint\0", "utf8")
    .update(credentialFingerprint)
    .digest("hex");
}

export function normalizeDigestCredentialSource(source: OpenAICompatibleDigestCredentialSource) {
  if (source === "provider_ledger_private_env") return "ledger_private_env" as const;
  if (source === "provider_ledger_deployment_secret") return "deployment_secret" as const;
  return source;
}
