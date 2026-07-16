import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("OpenAI smoke refuses to masquerade as real when the API key is missing", () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.OPENAI_BASE_URL;
  delete env.AGENT_BRAIN_API_KEY;
  delete env.AGENT_BRAIN_MODEL;
  delete env.AGENT_BRAIN_BASE_URL;
  delete env.AGENT_BRAIN_CHANNEL;
  delete env.AGENT_BRAIN_THIRD_API_KEY;
  delete env.AGENT_BRAIN_THIRD_MODEL;
  delete env.AGENT_BRAIN_THIRD_BASE_URL;
  delete env.AGENT_BRAIN_FALLBACK_API_KEY;
  delete env.AGENT_BRAIN_FALLBACK_MODEL;
  delete env.AGENT_BRAIN_FALLBACK_BASE_URL;
  env.SHANHAI_SMOKE_SKIP_DOTENV = "1";

  const result = spawnSync(process.execPath, ["scripts/openai-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_OPENAI_COMPATIBLE_CREDENTIAL/);
  assert.doesNotMatch(result.stdout, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(result.stderr, /sk-[A-Za-z0-9_-]{20,}/);
});

test("OpenAI smoke can read the fixed ledger agent brain env without leaking it", () => {
  const env = {
    ...process.env,
    AGENT_BRAIN_API_KEY: "test-ledger-key-do-not-print",
    AGENT_BRAIN_BASE_URL: "https://ledger-smoke.invalid/v1",
    AGENT_BRAIN_MODEL: "ledger-smoke-model",
    OPENAI_SMOKE_TIMEOUT_MS: "1000",
    SHANHAI_SMOKE_SKIP_DOTENV: "1",
  };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.OPENAI_BASE_URL;

  const result = spawnSync(process.execPath, ["scripts/openai-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /agent_brain_ledger_env/);
  assert.match(result.stdout, /openai_smoke_failed/);
  assert.doesNotMatch(result.stdout, /test-ledger-key-do-not-print/);
  assert.doesNotMatch(result.stderr, /test-ledger-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /ledger-smoke\.invalid/);
  assert.doesNotMatch(result.stderr, /ledger-smoke\.invalid/);
});

test("OpenAI smoke can select the fixed fallback ledger channel", () => {
  const env = {
    ...process.env,
    OPENAI_API_KEY: "test-generic-key-do-not-print",
    OPENAI_BASE_URL: "https://generic-smoke.invalid/v1",
    OPENAI_MODEL: "generic-smoke-model",
    AGENT_BRAIN_CHANNEL: "fallback",
    AGENT_BRAIN_API_KEY: "test-primary-key-do-not-print",
    AGENT_BRAIN_BASE_URL: "https://primary-smoke.invalid/v1",
    AGENT_BRAIN_MODEL: "primary-smoke-model",
    AGENT_BRAIN_FALLBACK_API_KEY: "test-fallback-key-do-not-print",
    AGENT_BRAIN_FALLBACK_BASE_URL: "https://fallback-smoke.invalid/v1",
    AGENT_BRAIN_FALLBACK_MODEL: "fallback-smoke-model",
    OPENAI_SMOKE_TIMEOUT_MS: "1000",
    SHANHAI_SMOKE_SKIP_DOTENV: "1",
  };
  const result = spawnSync(process.execPath, ["scripts/openai-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /agent_brain_fallback_ledger_env/);
  assert.match(result.stdout, /fallback-smoke-model/);
  assert.doesNotMatch(result.stdout, /generic-smoke-model/);
  assert.doesNotMatch(result.stdout, /test-generic-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /test-primary-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /test-fallback-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /primary-smoke\.invalid/);
  assert.doesNotMatch(result.stdout, /fallback-smoke\.invalid/);
});

test("OpenAI smoke fails closed for an unknown selected Agent Brain channel", () => {
  const env = {
    ...process.env,
    AGENT_BRAIN_CHANNEL: "fallback-typo",
    OPENAI_API_KEY: "test-generic-key-do-not-print",
    OPENAI_BASE_URL: "https://generic-smoke.invalid/v1",
    OPENAI_MODEL: "generic-smoke-model",
    SHANHAI_SMOKE_SKIP_DOTENV: "1",
  };

  const result = spawnSync(process.execPath, ["scripts/openai-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /invalid_AGENT_BRAIN_CHANNEL/);
  assert.doesNotMatch(result.stdout, /test-generic-key-do-not-print/);
  assert.doesNotMatch(result.stderr, /test-generic-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /generic-smoke\.invalid/);
  assert.doesNotMatch(result.stderr, /generic-smoke\.invalid/);
});
