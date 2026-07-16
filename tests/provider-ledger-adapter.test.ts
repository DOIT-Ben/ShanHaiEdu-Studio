import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ProviderLedgerContractError,
  resolveProviderLedgerConfig,
  resolveSelectedProviderLedgerConfig,
  writeProviderAdapterEvidence,
} from "@/server/provider-ledger/provider-ledger-adapter";
import {
  readV1_9AgentBrainHealthEvidence,
  writeV1_9AgentBrainHealthEvidence,
} from "@/server/provider-ledger/v1-9-agent-brain-health-evidence";
import { resolveProviderLedgerValueSource } from "@/server/provider-ledger/provider-ledger-contract.mjs";

const fixtureRoot = path.resolve(".tmp", "provider-ledger-adapter-tests");

describe("provider ledger adapter", () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await writeLedgerFixture(fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("resolves the Main Agent Responses channel from the authoritative ledger instead of generic OpenAI env", async () => {
    const config = await resolveProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      purpose: "main_agent_responses",
      ambientEnv: {
        OPENAI_API_KEY: "generic-value-must-not-win",
        OPENAI_BASE_URL: "https://generic.invalid/v1",
        OPENAI_MODEL: "generic-model",
      },
    });

    expect(config).toMatchObject({
      providerId: "agent_brain",
      purpose: "main_agent_responses",
      channel: "primary",
      credential: "fixture-primary-value",
      baseURL: "https://primary.invalid/v1",
      model: "fixture-primary-model",
      endpointCategory: "openai_compatible_responses",
      credentialSource: "ledger_private_env",
    });
    expect(JSON.stringify(config)).not.toContain("generic-value-must-not-win");
    expect(JSON.stringify(config)).not.toContain("fixture-primary-value");
  });

  it("selects the review and fallback channels by explicit purpose without inventing another provider registry", async () => {
    const review = await resolveProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      purpose: "critic_responses",
    });
    const fallback = await resolveProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      purpose: "fallback_responses",
    });

    expect(review).toMatchObject({ channel: "third", model: "fixture-third-model" });
    expect(fallback).toMatchObject({ channel: "fallback", model: "fixture-fallback-model" });
  });

  it("reads channel selection and credentials from the same private ledger source", () => {
    const selected = resolveSelectedProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      ambientEnv: {
        AGENT_BRAIN_CHANNEL: "primary",
        AGENT_BRAIN_API_KEY: "wrong-ambient-value",
      },
    });

    expect(selected).toMatchObject({
      purpose: "fallback_responses",
      channel: "fallback",
      model: "fixture-fallback-model",
      credentialSource: "ledger_private_env",
    });
    expect(selected.credential).toBe("fixture-fallback-value");
  });

  it("keeps production env clones on the private ledger source when private values exist", () => {
    const valueSource = resolveProviderLedgerValueSource({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      ambientEnv: { NODE_ENV: "production" },
      explicitLedgerRoot: false,
    });

    expect(valueSource.source).toBe("ledger_private_env");
    expect(valueSource.values.AGENT_BRAIN_CHANNEL).toBe("fallback");
    expect(valueSource.values.AGENT_BRAIN_FALLBACK_MODEL).toBe("fixture-fallback-model");
  });

  it("fails closed when a requested capability or required ledger value is absent", async () => {
    expect(() => resolveProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "image_generation",
      purpose: "main_agent_responses",
    })).toThrow(ProviderLedgerContractError);

    await writeFile(
      path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
      "AGENT_BRAIN_BASE_URL=https://primary.invalid/v1\nAGENT_BRAIN_MODEL=fixture-primary-model\n",
      "utf8",
    );
    expect(() => resolveProviderLedgerConfig({
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      purpose: "main_agent_responses",
    })).toThrow(expect.objectContaining({ code: "LEDGER_VALUE_MISSING" }));
  });

  it("writes an immutable redacted Provider adapter result into the ledger evidence boundary", async () => {
    const written = await writeProviderAdapterEvidence({
      ledgerRoot: fixtureRoot,
      evidenceId: "r5-desktop-main-agent-001",
      providerId: "agent_brain",
      capability: "agent_brain",
      purpose: "main_agent_responses",
      model: "fixture-primary-model",
      endpointCategory: "openai_compatible_responses",
      status: "failed",
      testedAt: "2026-07-14T16:00:00.000Z",
      errorCategory: "authorization",
      requestCount: 1,
      retryCount: 0,
    });
    const raw = await readFile(written.path, "utf8");
    const record = JSON.parse(raw);

    expect(record).toEqual({
      schemaVersion: "provider-adapter-evidence.v1",
      evidenceId: "r5-desktop-main-agent-001",
      providerId: "agent_brain",
      capability: "agent_brain",
      purpose: "main_agent_responses",
      model: "fixture-primary-model",
      endpointCategory: "openai_compatible_responses",
      status: "failed",
      testedAt: "2026-07-14T16:00:00.000Z",
      errorCategory: "authorization",
      requestCount: 1,
      retryCount: 0,
    });
    expect(written.path).toContain(path.join("evidence", "provider-adapter-tests"));
    expect(raw).not.toMatch(/api[_-]?key|authorization:\s*bearer|https?:\/\//i);

    await expect(writeProviderAdapterEvidence({
      ledgerRoot: fixtureRoot,
      evidenceId: "r5-desktop-main-agent-001",
      providerId: "agent_brain",
      capability: "agent_brain",
      purpose: "main_agent_responses",
      model: "changed-model",
      endpointCategory: "openai_compatible_responses",
      status: "passed",
      testedAt: "2026-07-14T16:01:00.000Z",
      errorCategory: "none",
      requestCount: 1,
      retryCount: 0,
    })).rejects.toMatchObject({ code: "EVIDENCE_ALREADY_EXISTS" });
  });

  it("writes and reads immutable V1-9 health evidence without endpoint or credential disclosure", async () => {
    const evidence = {
      schemaVersion: "v1-9-agent-brain-health.v2" as const,
      evidenceId: "agent-brain-health-fixture-001",
      providerId: "agent_brain" as const,
      capability: "agent_brain" as const,
      purpose: "main_agent_responses" as const,
      channel: "primary" as const,
      model: "fixture-primary-model",
      endpointCategory: "openai_compatible_responses" as const,
      reasoningEffort: "medium" as const,
      credentialSource: "ledger_private_env" as const,
      configDigest: "a".repeat(64),
      probe: "single_strict_structured_text" as const,
      result: "succeeded" as const,
      testedAt: "2026-07-15T03:00:00.000Z",
      providerRequestCount: 1 as const,
      maxRetries: 0 as const,
      retryCount: 0 as const,
      errorCategory: "none" as const,
    };
    const written = await writeV1_9AgentBrainHealthEvidence({ ledgerRoot: fixtureRoot, evidence });
    const raw = await readFile(written.path, "utf8");

    expect(readV1_9AgentBrainHealthEvidence({ ledgerRoot: fixtureRoot, evidenceId: evidence.evidenceId })).toEqual(evidence);
    expect(raw).not.toMatch(/fixture-primary-value|primary\.invalid|api[_-]?key/i);
    await expect(writeV1_9AgentBrainHealthEvidence({ ledgerRoot: fixtureRoot, evidence })).rejects.toThrow("v1_9_agent_brain_health_evidence_exists");
  });
});

async function writeLedgerFixture(root: string) {
  await mkdir(path.join(root, "PRIVATE-LOCAL-SECRETS", "apps-api"), { recursive: true });
  await mkdir(path.join(root, "evidence"), { recursive: true });
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({
    version: 1,
    providers: [
      {
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
      },
    ],
  }, null, 2), "utf8");
  await writeFile(
    path.join(root, "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
    [
      "AGENT_BRAIN_CHANNEL=fallback",
      "AGENT_BRAIN_API_KEY=fixture-primary-value",
      "AGENT_BRAIN_BASE_URL=https://primary.invalid/v1",
      "AGENT_BRAIN_MODEL=fixture-primary-model",
      "AGENT_BRAIN_THIRD_API_KEY=fixture-third-value",
      "AGENT_BRAIN_THIRD_BASE_URL=https://third.invalid/v1",
      "AGENT_BRAIN_THIRD_MODEL=fixture-third-model",
      "AGENT_BRAIN_FALLBACK_API_KEY=fixture-fallback-value",
      "AGENT_BRAIN_FALLBACK_BASE_URL=https://fallback.invalid/v1",
      "AGENT_BRAIN_FALLBACK_MODEL=fixture-fallback-model",
      "AGENT_BRAIN_REASONING_EFFORT=medium",
      "",
    ].join("\n"),
    "utf8",
  );
}
