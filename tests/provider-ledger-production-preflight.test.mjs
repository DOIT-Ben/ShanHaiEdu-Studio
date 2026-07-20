import assert from "node:assert/strict";
import { test } from "node:test";
import { runProductionPreflight } from "../scripts/production-preflight.mjs";

test("production preflight accepts only the unified model gateway", async () => {
  const result = await providerChecks({
    MODEL_GATEWAY_BASE_URL: "https://gateway.invalid/v1",
    MODEL_GATEWAY_API_KEY: "gateway-private-value",
    MODEL_GATEWAY_AGENT_MODEL: "gpt-5.6",
    MODEL_GATEWAY_IMAGE_MODEL: "image-2",
    MODEL_GATEWAY_VIDEO_MODEL: "video-grok",
    MODEL_GATEWAY_TTS_MODEL: "speech-2.8-hd",
  });
  assert.equal(check(result, "provider-openai").ok, true);
  assert.equal(check(result, "provider-image").ok, true);
  assert.equal(check(result, "provider-video").ok, true);
  assert.equal(check(result, "provider-tts").ok, true);
  assert.equal(check(result, "provider-image").source, "model_gateway");
  assert.doesNotMatch(JSON.stringify(result), /gateway-private-value/);
});

test("production preflight fails closed when gateway fields are incomplete", async () => {
  const result = await providerChecks({ MODEL_GATEWAY_API_KEY: "gateway-key" });
  assert.equal(check(result, "provider-openai").ok, false);
  assert.equal(check(result, "provider-image").ok, false);
  assert.equal(check(result, "provider-video").ok, false);
  assert.equal(check(result, "provider-tts").ok, false);
});

async function providerChecks(overrides) {
  return runProductionPreflight({ cwd: process.cwd(), env: { SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1", SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "unknown-source", ...overrides } });
}

function check(result, id) {
  const value = result.checks.find((item) => item.id === id);
  assert.ok(value, `missing preflight check: ${id}`);
  return value;
}
