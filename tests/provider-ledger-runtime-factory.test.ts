import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const openAIOptions: Record<string, unknown>[] = [];
const fixtureRoot = path.resolve(".tmp", "provider-ledger-runtime-factory-tests");

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function OpenAIMock(options: Record<string, unknown>) {
    openAIOptions.push(options);
    return { responses: { create: vi.fn() } };
  }),
}));

describe("provider-ledger Runtime Factory boundary", () => {
  beforeEach(async () => {
    openAIOptions.length = 0;
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "manifest.json"), JSON.stringify({
      version: 1,
      providers: [{
        id: "agent_brain",
        name: "Agent Brain",
        status: "candidate",
        doc: "providers/agent-brain.md",
        capabilities: ["capabilities/llm-agent-models.md"],
        env_vars: [
          "AGENT_BRAIN_CHANNEL",
          "AGENT_BRAIN_API_KEY",
          "AGENT_BRAIN_BASE_URL",
          "AGENT_BRAIN_MODEL",
          "AGENT_BRAIN_THIRD_API_KEY",
          "AGENT_BRAIN_THIRD_BASE_URL",
          "AGENT_BRAIN_THIRD_MODEL",
          "AGENT_BRAIN_FALLBACK_API_KEY",
          "AGENT_BRAIN_FALLBACK_BASE_URL",
          "AGENT_BRAIN_FALLBACK_MODEL",
          "AGENT_BRAIN_REASONING_EFFORT",
        ],
        runtime_contract: {
          schema_version: "provider-runtime-contract.v1",
          kind: "agent_brain_responses",
          endpoint_category: "openai_compatible_responses",
          selected_channel_env: "AGENT_BRAIN_CHANNEL",
          purpose_channels: {
            main_agent_responses: {
              channel: "primary",
              credential_env: "AGENT_BRAIN_API_KEY",
              base_url_env: "AGENT_BRAIN_BASE_URL",
              model_env: "AGENT_BRAIN_MODEL",
            },
            critic_responses: {
              channel: "third",
              credential_env: "AGENT_BRAIN_THIRD_API_KEY",
              base_url_env: "AGENT_BRAIN_THIRD_BASE_URL",
              model_env: "AGENT_BRAIN_THIRD_MODEL",
            },
            fallback_responses: {
              channel: "fallback",
              credential_env: "AGENT_BRAIN_FALLBACK_API_KEY",
              base_url_env: "AGENT_BRAIN_FALLBACK_BASE_URL",
              model_env: "AGENT_BRAIN_FALLBACK_MODEL",
            },
          },
          reasoning: {
            env: "AGENT_BRAIN_REASONING_EFFORT",
            default: "medium",
            allowed: ["low", "medium", "high", "xhigh"],
          },
        },
        evidence: [],
      }],
    }), "utf8");
    await writeFile(
      path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
      "AGENT_BRAIN_CHANNEL=primary\nAGENT_BRAIN_API_KEY=runtime-fixture-value\nAGENT_BRAIN_BASE_URL=https://runtime.invalid/v1\nAGENT_BRAIN_MODEL=runtime-fixture-model\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("constructs the real Agent Runtime from the ledger and ignores generic OpenAI credentials", async () => {
    const { createAgentRuntimeFromEnv } = await import("@/server/agent-runtime/runtime-factory");

    await createAgentRuntimeFromEnv({
      NODE_ENV: "production",
      SHANHAI_PROVIDER_MIGRATION_MODE: "legacy-compat",
      SHANHAI_PROVIDER_LEDGER_ROOT: fixtureRoot,
      OPENAI_API_KEY: "generic-must-not-win",
      OPENAI_BASE_URL: "https://generic.invalid/v1",
      OPENAI_MODEL: "generic-model",
    });

    expect(openAIOptions).toHaveLength(1);
    expect(openAIOptions[0]).toMatchObject({
      apiKey: "runtime-fixture-value",
      baseURL: "https://runtime.invalid/v1",
      maxRetries: 0,
    });
    expect(openAIOptions[0]).not.toContain({ apiKey: "generic-must-not-win" });
  });

  it("uses one normalized config digest for the product Runtime and V1-9 Provider lock", async () => {
    const { createOpenAICompatibleConfigDigest, pickOpenAICompatibleConfig } = await import("@/server/openai-compatible-config");
    const config = pickOpenAICompatibleConfig({
      SHANHAI_PROVIDER_LEDGER_ROOT: fixtureRoot,
      SHANHAI_PROVIDER_MIGRATION_MODE: "legacy-compat",
      AGENT_BRAIN_CHANNEL: "primary",
    });
    expect(config).not.toBeNull();
    const credentialFingerprint = createHash("sha256")
      .update("shanhai.provider-credential-fingerprint.v1\0", "utf8")
      .update("runtime-fixture-value", "utf8")
      .digest();
    const expected = createHash("sha256")
      .update("shanhai.openai-compatible-config-digest.v2\0", "utf8")
      .update(JSON.stringify({
      channel: "primary",
      baseURL: "https://runtime.invalid/v1",
      model: "runtime-fixture-model",
      reasoningEffort: "medium",
      credentialSource: "ledger_private_env",
      endpointCategory: "openai_compatible_responses",
    }), "utf8")
      .update("\0credential-fingerprint\0", "utf8")
      .update(credentialFingerprint)
      .digest("hex");

    expect(createOpenAICompatibleConfigDigest(config!)).toBe(expected);
  });
});
