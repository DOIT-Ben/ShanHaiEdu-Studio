import { describe, expect, it } from "vitest";

import { syncAgentBrainLedgerEnvText } from "../scripts/sync-agent-brain-ledger-env";

describe("Agent Brain ledger private env sync", () => {
  it("updates only selected primary and fallback channel fields while preserving third and unrelated providers", () => {
    const source = [
      "AGENT_BRAIN_API_KEY=new-primary-secret",
      "AGENT_BRAIN_BASE_URL=https://new-primary.invalid/v1",
      "AGENT_BRAIN_MODEL=gpt-new-primary",
      "AGENT_BRAIN_TIER=pro",
      "AGENT_BRAIN_FALLBACK_API_KEY=new-fallback-secret",
      "AGENT_BRAIN_FALLBACK_BASE_URL=https://new-fallback.invalid/v1",
      "AGENT_BRAIN_FALLBACK_MODEL=gpt-new-fallback",
      "AGENT_BRAIN_FALLBACK_TIER=plus",
    ].join("\n");
    const target = [
      "# ledger",
      "AGENT_BRAIN_API_KEY=old-primary-secret",
      "AGENT_BRAIN_BASE_URL=https://old-primary.invalid/v1",
      "AGENT_BRAIN_MODEL=gpt-old-primary",
      "AGENT_BRAIN_TIER=pro",
      "AGENT_BRAIN_THIRD_API_KEY=keep-third-secret",
      "AGENT_BRAIN_THIRD_BASE_URL=https://keep-third.invalid/v1",
      "AGENT_BRAIN_THIRD_MODEL=gpt-keep-third",
      "AGENT_BRAIN_FALLBACK_API_KEY=old-fallback-secret",
      "AGENT_BRAIN_FALLBACK_BASE_URL=https://old-fallback.invalid/v1",
      "AGENT_BRAIN_FALLBACK_MODEL=gpt-old-fallback",
      "IMAGE_PROVIDER_KEY=keep-image-secret",
      "",
    ].join("\n");

    const result = syncAgentBrainLedgerEnvText({ source, target, channels: ["primary", "fallback"] });

    expect(result.updatedText).toContain("AGENT_BRAIN_API_KEY=new-primary-secret");
    expect(result.updatedText).toContain("AGENT_BRAIN_FALLBACK_API_KEY=new-fallback-secret");
    expect(result.updatedText).toContain("AGENT_BRAIN_THIRD_API_KEY=keep-third-secret");
    expect(result.updatedText).toContain("IMAGE_PROVIDER_KEY=keep-image-secret");
    expect(result.report).toEqual({ channels: ["primary", "fallback"], changedFieldCount: 7 });
    expect(JSON.stringify(result.report)).not.toMatch(/secret|invalid\/v1/i);
  });

  it("fails closed when a selected channel source tuple is incomplete", () => {
    expect(() => syncAgentBrainLedgerEnvText({
      source: "AGENT_BRAIN_API_KEY=only-key",
      target: "AGENT_BRAIN_API_KEY=old\nAGENT_BRAIN_BASE_URL=https://old.invalid/v1\nAGENT_BRAIN_MODEL=old",
      channels: ["primary"],
    })).toThrow("agent_brain_sync_source_incomplete");
  });
});
