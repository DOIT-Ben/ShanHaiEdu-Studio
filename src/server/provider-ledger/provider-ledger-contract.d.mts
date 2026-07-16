export const PROVIDER_RUNTIME_CONTRACT_VERSION: "provider-runtime-contract.v1";

export class ProviderLedgerManifestContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export type AgentBrainRuntimeContract = {
  schemaVersion: typeof PROVIDER_RUNTIME_CONTRACT_VERSION;
  kind: "agent_brain_responses";
  endpointCategory: "openai_compatible_responses";
  selectedChannelEnv: string;
  purposeChannels: Readonly<Record<
    "main_agent_responses" | "critic_responses" | "fallback_responses",
    Readonly<{
      channel: "primary" | "third" | "fallback";
      credentialEnv: string;
      baseUrlEnv: string;
      modelEnv: string;
    }>
  >>;
  reasoning: Readonly<{
    env: string;
    default: "low" | "medium" | "high" | "xhigh";
    allowed: readonly ("low" | "medium" | "high" | "xhigh")[];
  }>;
};

export type MiniMaxImageRuntimeContract = {
  schemaVersion: typeof PROVIDER_RUNTIME_CONTRACT_VERSION;
  kind: "minimax_image";
  selectedChannelEnv: string;
  requiredChannel: "minimax";
  credentialEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
};

export type MiniMaxTtsRuntimeContract = {
  schemaVersion: typeof PROVIDER_RUNTIME_CONTRACT_VERSION;
  kind: "minimax_tts";
  selectedModeEnv: string;
  requiredMode: "minimax";
  credentialEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
};

export type ProviderRuntimeContract =
  | AgentBrainRuntimeContract
  | MiniMaxImageRuntimeContract
  | MiniMaxTtsRuntimeContract;

export function resolveProviderLedgerManifestRoot(input?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  explicitRoot?: string;
}): string;

export function readProviderLedgerManifest(input: { ledgerRoot: string }): Readonly<{
  version: number;
  providers: readonly Readonly<{
    id: string;
    envVars: readonly string[];
    runtimeContract: unknown;
  }>[];
}>;

export function resolveProviderRuntimeContract(input: {
  ledgerRoot: string;
  capability: string;
}): ProviderRuntimeContract;

export function resolveProviderLedgerValueSource(input: {
  ledgerRoot: string;
  capability: string;
  ambientEnv?: Record<string, string | undefined>;
  explicitLedgerRoot?: boolean;
}): Readonly<{
  capability: string;
  source: "ledger_private_env" | "deployment_secret";
  declaredEnvNames: readonly string[];
  values: Readonly<Record<string, string>>;
}>;

export function resolveAgentBrainPurposeForChannel(
  contract: AgentBrainRuntimeContract,
  channel: "primary" | "third" | "fallback",
): "main_agent_responses" | "critic_responses" | "fallback_responses";
