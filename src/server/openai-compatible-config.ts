import { createHash } from "node:crypto";
import { resolveModelGatewayConfig } from "@/server/model-gateway-config";
import { tryResolveSelectedProviderLedgerConfig } from "@/server/provider-ledger/provider-ledger-adapter";

export type OpenAICompatibleEnv = Record<string, string | undefined> & {
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
  | "model_gateway_env"
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
  let gatewayConfig: ReturnType<typeof resolveModelGatewayConfig>;
  try {
    gatewayConfig = resolveModelGatewayConfig("agent", env);
  } catch {
    if (env.NODE_ENV !== "test" && env.SHANHAI_PROVIDER_MIGRATION_MODE !== "legacy-compat") return null;
    if (!env.SHANHAI_PROVIDER_LEDGER_ROOT) return null;
    const legacy = tryResolveSelectedProviderLedgerConfig({ capability: "agent_brain", ambientEnv: env });
    if (!legacy) return null;
    const legacyConfig = {
      credentialSource: legacy.credentialSource === "ledger_private_env"
        ? "provider_ledger_private_env" as const
        : "provider_ledger_deployment_secret" as const,
      baseURL: legacy.baseURL,
      model: legacy.model,
      reasoningEffort: legacy.reasoningEffort,
      channel: legacy.channel,
      endpointCategory: legacy.endpointCategory,
    } as OpenAICompatibleConfig;
    Object.defineProperty(legacyConfig, "credential", { value: legacy.credential, enumerable: false });
    return Object.freeze(legacyConfig);
  }
  const config = {
    credentialSource: "model_gateway_env" as const,
    baseURL: gatewayConfig.baseUrl,
    model: gatewayConfig.model,
    reasoningEffort: normalizeReasoningEffort(env.AGENT_BRAIN_REASONING_EFFORT),
    channel: "primary" as const,
    endpointCategory: "openai_compatible_responses" as const,
  } as OpenAICompatibleConfig;
  Object.defineProperty(config, "credential", {
    value: gatewayConfig.apiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(config);
}

function normalizeReasoningEffort(value: string | undefined): OpenAIReasoningEffort {
  return value === "low" || value === "high" || value === "xhigh" ? value : "medium";
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
  if (source === "model_gateway_env") return "deployment_secret" as const;
  if (source === "provider_ledger_private_env") return "ledger_private_env" as const;
  if (source === "provider_ledger_deployment_secret") return "deployment_secret" as const;
  return source;
}
