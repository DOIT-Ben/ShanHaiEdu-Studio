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
};

export type OpenAIReasoningEffort = "low" | "medium" | "high";

export const DEFAULT_MAIN_AGENT_MODEL = "gpt-5.6-terra";
export const DEFAULT_MAIN_AGENT_REASONING_EFFORT: OpenAIReasoningEffort = "high";

export type OpenAICompatibleCredentialSource =
  | "openai_env"
  | "agent_brain_ledger_env"
  | "agent_brain_third_ledger_env"
  | "agent_brain_fallback_ledger_env";

export type OpenAICompatibleConfig = {
  credential: string;
  credentialSource: OpenAICompatibleCredentialSource;
  baseURL?: string;
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
};

type LedgerChannelConfig = {
  credentialSource: OpenAICompatibleCredentialSource;
  apiKey: keyof OpenAICompatibleEnv;
  baseURL: keyof OpenAICompatibleEnv;
  model: keyof OpenAICompatibleEnv;
};

const ledgerChannels: Record<string, LedgerChannelConfig> = {
  primary: {
    credentialSource: "agent_brain_ledger_env",
    apiKey: "AGENT_BRAIN_API_KEY",
    baseURL: "AGENT_BRAIN_BASE_URL",
    model: "AGENT_BRAIN_MODEL",
  },
  third: {
    credentialSource: "agent_brain_third_ledger_env",
    apiKey: "AGENT_BRAIN_THIRD_API_KEY",
    baseURL: "AGENT_BRAIN_THIRD_BASE_URL",
    model: "AGENT_BRAIN_THIRD_MODEL",
  },
  fallback: {
    credentialSource: "agent_brain_fallback_ledger_env",
    apiKey: "AGENT_BRAIN_FALLBACK_API_KEY",
    baseURL: "AGENT_BRAIN_FALLBACK_BASE_URL",
    model: "AGENT_BRAIN_FALLBACK_MODEL",
  },
};

export function pickOpenAICompatibleConfig(env: OpenAICompatibleEnv = process.env): OpenAICompatibleConfig | null {
  const openaiCredential = env.OPENAI_API_KEY?.trim();
  if (openaiCredential) {
    return {
      credential: openaiCredential,
      credentialSource: "openai_env",
      baseURL: trimOptional(env.OPENAI_BASE_URL),
      model: env.OPENAI_MODEL?.trim() || DEFAULT_MAIN_AGENT_MODEL,
      reasoningEffort: DEFAULT_MAIN_AGENT_REASONING_EFFORT,
    };
  }

  const ledgerChannel = (env.AGENT_BRAIN_CHANNEL?.trim() || "primary").toLowerCase();
  const selectedLedgerChannel = ledgerChannels[ledgerChannel] ?? ledgerChannels.primary;
  const ledgerCredential = env[selectedLedgerChannel.apiKey]?.trim();
  if (!ledgerCredential) {
    return null;
  }

  return {
    credential: ledgerCredential,
    credentialSource: selectedLedgerChannel.credentialSource,
    baseURL: trimOptional(env[selectedLedgerChannel.baseURL]),
    model: env[selectedLedgerChannel.model]?.trim() || DEFAULT_MAIN_AGENT_MODEL,
    reasoningEffort: DEFAULT_MAIN_AGENT_REASONING_EFFORT,
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
