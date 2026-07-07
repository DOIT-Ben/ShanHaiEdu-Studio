import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("OpenAI smoke refuses to masquerade as real when the API key is missing", () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.OPENAI_BASE_URL;

  const result = spawnSync(process.execPath, ["scripts/openai-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_OPENAI_API_KEY/);
  assert.doesNotMatch(result.stdout, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(result.stderr, /sk-[A-Za-z0-9_-]{20,}/);
});
