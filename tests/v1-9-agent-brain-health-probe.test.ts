import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { runV1_9AgentBrainHealthProbe } from "../scripts/v1-9-agent-brain-health-probe";
import { createOpenAICompatibleConfigDigest } from "../src/server/openai-compatible-config";

const config = {
  credential: "private-do-not-print",
  credentialSource: "provider_ledger_private_env" as const,
  baseURL: "https://provider.invalid/v1",
  model: "gpt-fixture",
  reasoningEffort: "high" as const,
  channel: "primary" as const,
  endpointCategory: "openai_compatible_responses" as const,
};

describe("V1-9 Agent Brain health probe", () => {
  it("loads through the same tsx CLI boundary without reaching a Provider when the ledger is unavailable", () => {
    const result = spawnSync(process.execPath, [
      path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
      path.resolve("scripts", "v1-9-agent-brain-health-probe.ts"),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHANHAI_PROVIDER_LEDGER_ROOT: path.resolve(".tmp", "missing-provider-ledger-for-health-probe"),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(/Transform failed|Top-level await/i);
  });

  it("makes zero Provider requests when the selected ledger config does not match the frozen run", async () => {
    const dependencies = fixtureDependencies({ manifestConfigDigest: "f".repeat(64) });

    const report = await runV1_9AgentBrainHealthProbe({
      cwd: "E:\\fixture",
      env: {},
      dependencies,
    });

    expect(report).toMatchObject({
      ok: false,
      providerRequestCount: 0,
      reasonCode: "v1_9_provider_lock_mismatch",
    });
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(dependencies.writeEvidence).not.toHaveBeenCalled();
  });

  it("invalidates the frozen Provider lock after credential rotation before making a request", async () => {
    const previousDigest = createOpenAICompatibleConfigDigest(config);
    const rotatedConfig = { ...config, credential: "rotated-private-do-not-print" };
    const dependencies = fixtureDependencies({ manifestConfigDigest: previousDigest });
    dependencies.resolveConfig.mockReturnValue(rotatedConfig);
    dependencies.createConfigDigest.mockReturnValue(createOpenAICompatibleConfigDigest(rotatedConfig));

    const report = await runV1_9AgentBrainHealthProbe({
      cwd: "E:\\fixture",
      env: {},
      dependencies,
    });

    expect(report).toMatchObject({
      ok: false,
      providerRequestCount: 0,
      reasonCode: "v1_9_provider_lock_mismatch",
    });
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(dependencies.writeEvidence).not.toHaveBeenCalled();
  });

  it("submits exactly one strict Responses request with SDK retries disabled and writes immutable ledger evidence", async () => {
    const dependencies = fixtureDependencies();

    const report = await runV1_9AgentBrainHealthProbe({
      cwd: "E:\\fixture",
      env: {},
      dependencies,
    });

    expect(report).toMatchObject({
      ok: true,
      providerRequestCount: 1,
      retryCount: 0,
      channel: "primary",
      model: "gpt-fixture",
    });
    expect(dependencies.createClient).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    expect(dependencies.responsesCreate).toHaveBeenCalledTimes(1);
    expect(dependencies.responsesCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-fixture",
      text: { format: expect.objectContaining({ type: "json_schema", strict: true }) },
    }));
    expect(dependencies.writeEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "agent_brain",
      channel: "primary",
      configDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerRequestCount: 1,
      maxRetries: 0,
      retryCount: 0,
      result: "succeeded",
    }), expect.any(Object));
    expect(JSON.stringify(report)).not.toMatch(/private-do-not-print|provider\.invalid/i);
  });

  it("uses the manifest-derived purpose when a channel mapping is remapped", async () => {
    const dependencies = fixtureDependencies();
    dependencies.resolvePurpose.mockReturnValue("fallback_responses");

    const report = await runV1_9AgentBrainHealthProbe({
      cwd: "E:\\fixture",
      env: {},
      dependencies,
    });

    expect(report.ok).toBe(true);
    expect(dependencies.resolvePurpose).toHaveBeenCalledWith({ env: {}, channel: "primary" });
    expect(dependencies.writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "fallback_responses", channel: "primary" }),
      expect.any(Object),
    );
  });
});

function fixtureDependencies(overrides: { manifestConfigDigest?: string } = {}) {
  const responsesCreate = vi.fn(async () => ({ output_text: JSON.stringify({ ok: true, summary: "通道可用" }) }));
  const configDigest = "a".repeat(64);
  return {
    resolveConfig: vi.fn(() => config),
    createConfigDigest: vi.fn(() => configDigest),
    resolvePurpose: vi.fn((): "main_agent_responses" | "critic_responses" | "fallback_responses" => "main_agent_responses"),
    readActiveRun: vi.fn(async () => ({
      manifestPath: "E:\\fixture\\test-results\\v1-9-run\\run-manifest.json",
      manifest: {
        schemaVersion: "v1-9-run-manifest.v1" as const,
        status: "paused_recovery",
        providerLock: {
          schemaVersion: "v1-9-provider-lock.v1" as const,
          channel: "primary",
          model: "gpt-fixture",
          endpointCategory: "openai_compatible_responses",
          reasoningEffort: "high",
          credentialSource: "ledger_private_env",
          configDigest: overrides.manifestConfigDigest ?? configDigest,
        },
      },
    })),
    createClient: vi.fn(() => ({ responses: { create: responsesCreate } })),
    responsesCreate,
    writeEvidence: vi.fn(async (input) => ({ path: "E:\\fixture\\API台账系统\\evidence\\provider-adapter-tests\\evidence.json", record: input })),
    writeRunCopy: vi.fn(async () => undefined),
    now: vi.fn(() => new Date("2026-07-15T03:00:00.000Z")),
    randomId: vi.fn(() => "fixture-id"),
  };
}
