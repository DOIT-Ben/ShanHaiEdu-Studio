import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runProductionPreflight } from "../scripts/production-preflight.mjs";

const ledgerRoot = path.resolve("tests", "fixtures", "provider-ledger");

test("A20 production preflight rejects generic OpenAI credentials and unknown Agent Brain channels", async () => {
  const generic = await providerChecks({
    AGENT_BRAIN_CHANNEL: "primary",
    OPENAI_API_KEY: "generic-private-value",
    OPENAI_MODEL: "generic-model",
  });
  assert.equal(check(generic, "provider-openai").ok, false);

  const unknown = await providerChecks({
    ...validAgentBrain(),
    AGENT_BRAIN_CHANNEL: "primary-typo",
  });
  assert.equal(check(unknown, "provider-openai").ok, false);
});

test("A20 production preflight accepts only the ledger-declared MiniMax image channel", async () => {
  const oldFree = await providerChecks({
    IMAGE_PROVIDER_CHANNEL: "free",
    IMAGEGEN_FREE_API_KEY: "old-free-private-value",
    IMAGEGEN_FREE_BASE_URL: "https://old-free.invalid/v1",
  });
  assert.equal(check(oldFree, "provider-image").ok, false);

  const minimax = await providerChecks({
    IMAGE_PROVIDER_CHANNEL: "minimax",
    MINIMAX_API_KEY: "minimax-image-private-value",
    MINIMAX_BASE_URL: "https://minimax-image.invalid",
    MINIMAX_IMAGE_MODEL: "image-fixture",
  });
  assert.equal(check(minimax, "provider-image").ok, true);
  assert.equal(check(minimax, "provider-image").source, "provider_ledger:minimax");
});

test("A20 production preflight requires the ledger-declared MiniMax TTS key, base URL, and model", async () => {
  const keyOnly = await providerChecks({
    TTS_PROVIDER_MODE: "minimax",
    MINIMAX_API_KEY: "minimax-key-only-private-value",
  });
  assert.equal(check(keyOnly, "provider-tts").ok, false);

  const complete = await providerChecks({
    TTS_PROVIDER_MODE: "minimax",
    MINIMAX_API_KEY: "minimax-tts-private-value",
    MINIMAX_BASE_URL: "https://minimax-tts.invalid",
    MINIMAX_TTS_MODEL: "speech-fixture",
  });
  assert.equal(check(complete, "provider-tts").ok, true);
  assert.equal(check(complete, "provider-tts").source, "provider_ledger:minimax");
});

test("A20 production preflight reads the same ledger_private_env value source as the runtime adapter", async () => {
  const privateLedgerRoot = createPrivateLedgerFixture();
  const result = await runProductionPreflight({
    cwd: process.cwd(),
    env: {
      SHANHAI_PROVIDER_LEDGER_ROOT: privateLedgerRoot,
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "ledger_private_env",
      AGENT_BRAIN_CHANNEL: "unknown-ambient-channel",
      AGENT_BRAIN_API_KEY: "wrong-ambient-agent-value",
      IMAGE_PROVIDER_CHANNEL: "free",
      MINIMAX_API_KEY: "wrong-ambient-minimax-value",
      TTS_PROVIDER_MODE: "other",
    },
  });

  assert.equal(check(result, "provider-openai").ok, true);
  assert.equal(check(result, "provider-openai").source, "provider_ledger:fallback");
  assert.equal(check(result, "provider-image").ok, true);
  assert.equal(check(result, "provider-tts").ok, true);
  assert.doesNotMatch(JSON.stringify(result), /wrong-ambient|private-ledger-secret/i);
});

test("A20 production preflight fails closed for an unknown explicit ledger credential source", async () => {
  const result = await providerChecks({
    ...validAgentBrain(),
    SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "unknown-source",
    IMAGE_PROVIDER_CHANNEL: "minimax",
    MINIMAX_API_KEY: "private-value",
    MINIMAX_BASE_URL: "https://minimax.invalid",
    MINIMAX_IMAGE_MODEL: "image-fixture",
    TTS_PROVIDER_MODE: "minimax",
    MINIMAX_TTS_MODEL: "speech-fixture",
  });

  assert.equal(check(result, "provider-openai").ok, false);
  assert.equal(check(result, "provider-image").ok, false);
  assert.equal(check(result, "provider-tts").ok, false);
});

async function providerChecks(overrides) {
  return runProductionPreflight({
    cwd: process.cwd(),
    env: {
      SHANHAI_PROVIDER_LEDGER_ROOT: ledgerRoot,
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: overrides.SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE ?? "deployment_secret",
      ...overrides,
    },
  });
}

function validAgentBrain() {
  return {
    AGENT_BRAIN_CHANNEL: "primary",
    AGENT_BRAIN_API_KEY: "agent-private-value",
    AGENT_BRAIN_BASE_URL: "https://agent.invalid/v1",
    AGENT_BRAIN_MODEL: "agent-fixture",
  };
}

function check(result, id) {
  const value = result.checks.find((item) => item.id === id);
  assert.ok(value, `missing preflight check: ${id}`);
  return value;
}

function createPrivateLedgerFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-provider-ledger-private-"));
  const privateDirectory = path.join(root, "PRIVATE-LOCAL-SECRETS", "apps-api");
  mkdirSync(privateDirectory, { recursive: true });
  writeFileSync(path.join(root, "manifest.json"), readFileSync(path.join(ledgerRoot, "manifest.json")));
  writeFileSync(path.join(privateDirectory, ".env"), [
    "AGENT_BRAIN_CHANNEL=fallback",
    "AGENT_BRAIN_FALLBACK_API_KEY=private-ledger-secret-agent",
    "AGENT_BRAIN_FALLBACK_BASE_URL=https://private-ledger-agent.invalid/v1",
    "AGENT_BRAIN_FALLBACK_MODEL=private-ledger-agent-model",
    "AGENT_BRAIN_REASONING_EFFORT=high",
    "IMAGE_PROVIDER_CHANNEL=minimax",
    "MINIMAX_API_KEY=private-ledger-secret-minimax",
    "MINIMAX_BASE_URL=https://private-ledger-minimax.invalid",
    "MINIMAX_IMAGE_MODEL=private-ledger-image-model",
    "TTS_PROVIDER_MODE=minimax",
    "MINIMAX_TTS_MODEL=private-ledger-tts-model",
    "",
  ].join("\n"), "utf8");
  return root;
}
