import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createOpenAICompatibleConfigDigest,
  pickOpenAICompatibleConfig,
} from "@/server/openai-compatible-config";
import {
  ProviderLedgerContractError,
  resolveProviderLedgerConfig,
  resolveProviderLedgerRuntimeContract,
  resolveSelectedProviderLedgerConfig,
} from "@/server/provider-ledger/provider-ledger-adapter";
import {
  validateV1_9AgentBrainHealthEvidence,
} from "@/server/provider-ledger/v1-9-agent-brain-health-evidence";

const fixtureRoot = path.resolve("tests", "fixtures", "provider-ledger");
const temporaryRoot = path.resolve(".tmp", "provider-ledger-identity-contract");

describe("A20 Provider identity contract", () => {
  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("changes the config digest when only the credential rotates without serializing secret material", () => {
    const first = pickOpenAICompatibleConfig(modelGatewayEnv("credential-version-one"));
    const second = pickOpenAICompatibleConfig(modelGatewayEnv("credential-version-two"));

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(createOpenAICompatibleConfigDigest(first!)).not.toBe(createOpenAICompatibleConfigDigest(second!));
    expect(Object.keys(first!)).not.toContain("credential");
    expect(JSON.stringify(first)).not.toContain("credential-version-one");
    expect(JSON.stringify(first)).not.toMatch(/credentialFingerprint|credential_fingerprint/);
  });

  it("resolves purpose-to-channel and env names from the manifest contract", async () => {
    await mkdir(temporaryRoot, { recursive: true });
    await writeFile(path.join(temporaryRoot, "manifest.json"), JSON.stringify({
      version: 1,
      providers: [{
        id: "agent_brain",
        env_vars: [
          "AGENT_BRAIN_CHANNEL",
          "ALT_API_KEY",
          "ALT_BASE_URL",
          "ALT_MODEL",
          "ALT_REASONING",
        ],
        runtime_contract: {
          schema_version: "provider-runtime-contract.v1",
          kind: "agent_brain_responses",
          endpoint_category: "openai_compatible_responses",
          selected_channel_env: "AGENT_BRAIN_CHANNEL",
          purpose_channels: {
            main_agent_responses: {
              channel: "fallback",
              credential_env: "ALT_API_KEY",
              base_url_env: "ALT_BASE_URL",
              model_env: "ALT_MODEL",
            },
            critic_responses: {
              channel: "third",
              credential_env: "ALT_API_KEY",
              base_url_env: "ALT_BASE_URL",
              model_env: "ALT_MODEL",
            },
            fallback_responses: {
              channel: "primary",
              credential_env: "ALT_API_KEY",
              base_url_env: "ALT_BASE_URL",
              model_env: "ALT_MODEL",
            },
          },
          reasoning: {
            env: "ALT_REASONING",
            default: "xhigh",
            allowed: ["low", "medium", "high", "xhigh"],
          },
        },
      }],
    }), "utf8");

    const config = resolveProviderLedgerConfig({
      ledgerRoot: temporaryRoot,
      capability: "agent_brain",
      purpose: "main_agent_responses",
      ambientEnv: {
        SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
        ALT_API_KEY: "alternate-private-value",
        ALT_BASE_URL: "https://alternate.invalid/v1",
        ALT_MODEL: "alternate-model",
      },
    });

    expect(config).toMatchObject({
      channel: "fallback",
      baseURL: "https://alternate.invalid/v1",
      model: "alternate-model",
      reasoningEffort: "xhigh",
    });
  });

  it("fails closed when the Agent Brain runtime contract is absent", async () => {
    await mkdir(temporaryRoot, { recursive: true });
    await writeFile(path.join(temporaryRoot, "manifest.json"), JSON.stringify({
      version: 1,
      providers: [{
        id: "agent_brain",
        env_vars: ["AGENT_BRAIN_API_KEY", "AGENT_BRAIN_BASE_URL", "AGENT_BRAIN_MODEL"],
      }],
    }), "utf8");

    expect(() => resolveProviderLedgerConfig({
      ledgerRoot: temporaryRoot,
      capability: "agent_brain",
      purpose: "main_agent_responses",
      ambientEnv: agentBrainEnv("private-value"),
    })).toThrowError(expect.objectContaining<Partial<ProviderLedgerContractError>>({
      code: "LEDGER_RUNTIME_CONTRACT_MISSING",
    }));
  });

  it.each([undefined, "", "unknown-channel"])(
    "fails closed when the selected Agent Brain channel is not explicitly declared: %s",
    (selectedChannel) => {
      const env: Omit<ReturnType<typeof agentBrainEnv>, "AGENT_BRAIN_CHANNEL"> & { AGENT_BRAIN_CHANNEL?: string } = agentBrainEnv("private-value");
      if (selectedChannel === undefined) delete env.AGENT_BRAIN_CHANNEL;
      else env.AGENT_BRAIN_CHANNEL = selectedChannel;

      expect(() => resolveSelectedProviderLedgerConfig({
        ledgerRoot: fixtureRoot,
        capability: "agent_brain",
        ambientEnv: env,
      })).toThrowError(expect.objectContaining<Partial<ProviderLedgerContractError>>({
        code: "LEDGER_CHANNEL_UNKNOWN",
      }));
    },
  );

  it("fails closed when an explicit Provider ledger credential source is unknown", () => {
    expect(() => resolveSelectedProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      ambientEnv: {
        ...agentBrainEnv("private-value"),
        SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "unknown-source" as "deployment_secret",
      },
    })).toThrowError(expect.objectContaining<Partial<ProviderLedgerContractError>>({
      code: "LEDGER_SECRET_SOURCE_UNKNOWN",
    }));
  });

  it("validates health evidence purpose against the manifest mapping instead of a built-in channel table", async () => {
    await writeRemappedAgentBrainManifest();
    const runtimeContract = resolveProviderLedgerRuntimeContract({
      ledgerRoot: temporaryRoot,
      capability: "agent_brain",
    });
    if (runtimeContract.kind !== "agent_brain_responses") throw new Error("fixture contract kind mismatch");
    const providerLock = {
      channel: "primary" as const,
      model: "alternate-model",
      endpointCategory: "openai_compatible_responses" as const,
      reasoningEffort: "xhigh" as const,
      credentialSource: "deployment_secret" as const,
      configDigest: "a".repeat(64),
    };

    expect(() => validateV1_9AgentBrainHealthEvidence({
      value: {
        schemaVersion: "v1-9-agent-brain-health.v2",
        evidenceId: "agent-brain-health-remapped-purpose",
        providerId: "agent_brain",
        capability: "agent_brain",
        purpose: "fallback_responses",
        channel: "primary",
        model: "alternate-model",
        endpointCategory: "openai_compatible_responses",
        reasoningEffort: "xhigh",
        credentialSource: "deployment_secret",
        configDigest: "a".repeat(64),
        probe: "single_strict_structured_text",
        result: "succeeded",
        testedAt: "2026-07-15T05:00:00.000Z",
        providerRequestCount: 1,
        maxRetries: 0,
        retryCount: 0,
        errorCategory: "none",
      },
      evidenceId: "agent-brain-health-remapped-purpose",
      providerLock,
      runtimeContract,
    })).not.toThrow();
  });

  it("selects the purpose mapped to the chosen channel by the manifest", async () => {
    await writeRemappedAgentBrainManifest();
    const selected = resolveSelectedProviderLedgerConfig({
      ledgerRoot: temporaryRoot,
      capability: "agent_brain",
      ambientEnv: {
        SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
        AGENT_BRAIN_CHANNEL: "primary",
        ALT_API_KEY: "alternate-private-value",
        ALT_BASE_URL: "https://alternate.invalid/v1",
        ALT_MODEL: "alternate-model",
      },
    });

    expect(selected).toMatchObject({
      purpose: "fallback_responses",
      channel: "primary",
      model: "alternate-model",
    });
  });
});

async function writeRemappedAgentBrainManifest() {
  await mkdir(temporaryRoot, { recursive: true });
  await writeFile(path.join(temporaryRoot, "manifest.json"), JSON.stringify({
    version: 1,
    providers: [{
      id: "agent_brain",
      env_vars: [
        "AGENT_BRAIN_CHANNEL",
        "ALT_API_KEY",
        "ALT_BASE_URL",
        "ALT_MODEL",
        "ALT_REASONING",
      ],
      runtime_contract: {
        schema_version: "provider-runtime-contract.v1",
        kind: "agent_brain_responses",
        endpoint_category: "openai_compatible_responses",
        selected_channel_env: "AGENT_BRAIN_CHANNEL",
        purpose_channels: {
          main_agent_responses: {
            channel: "fallback",
            credential_env: "ALT_API_KEY",
            base_url_env: "ALT_BASE_URL",
            model_env: "ALT_MODEL",
          },
          critic_responses: {
            channel: "third",
            credential_env: "ALT_API_KEY",
            base_url_env: "ALT_BASE_URL",
            model_env: "ALT_MODEL",
          },
          fallback_responses: {
            channel: "primary",
            credential_env: "ALT_API_KEY",
            base_url_env: "ALT_BASE_URL",
            model_env: "ALT_MODEL",
          },
        },
        reasoning: {
          env: "ALT_REASONING",
          default: "xhigh",
          allowed: ["low", "medium", "high", "xhigh"],
        },
      },
    }],
  }), "utf8");
}

function agentBrainEnv(credential: string) {
  return {
    SHANHAI_PROVIDER_LEDGER_ROOT: fixtureRoot,
    SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret" as const,
    AGENT_BRAIN_CHANNEL: "primary",
    AGENT_BRAIN_API_KEY: credential,
    AGENT_BRAIN_BASE_URL: "https://primary.invalid/v1",
    AGENT_BRAIN_MODEL: "gpt-fixture",
  };
}

function modelGatewayEnv(credential: string) {
  return {
    MODEL_GATEWAY_API_KEY: credential,
    MODEL_GATEWAY_BASE_URL: "https://gateway.invalid/v1",
    MODEL_GATEWAY_AGENT_MODEL: "gpt-fixture",
  };
}
