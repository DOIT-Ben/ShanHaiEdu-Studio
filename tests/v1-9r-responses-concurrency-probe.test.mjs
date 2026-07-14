import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tempRoots = [];

after(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("concurrency probe fails closed without credentials and does not leak secrets", async () => {
  const env = cleanProbeEnv();
  env.SHANHAI_RESPONSES_CONCURRENCY_PROBE_SKIP_DOTENV = "1";

  const result = await runProbe(env);

  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /missing_OPENAI_COMPATIBLE_CREDENTIAL/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sk-[A-Za-z0-9_-]{20,}/);
});

test("concurrency probe runs two simultaneous function-call and continuation phases", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "v1-9r-concurrency-probe-"));
  tempRoots.push(tempRoot);
  const evidencePath = path.join(tempRoot, "evidence.json");
  const requests = [];
  let active = 0;
  let maxActive = 0;
  let firstPhaseWaiting = 0;
  let continuePhaseWaiting = 0;
  let releaseFirstPhase;
  let releaseContinuePhase;
  const firstPhaseBarrier = new Promise((resolve) => { releaseFirstPhase = resolve; });
  const continuePhaseBarrier = new Promise((resolve) => { releaseContinuePhase = resolve; });
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const input = Array.isArray(payload.input) ? payload.input : [];
    const continuation = input.some((item) => item?.type === "function_call_output");
    requests.push({ continuation, inputCount: input.length });
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (continuation) {
      continuePhaseWaiting += 1;
      if (continuePhaseWaiting === 2) releaseContinuePhase();
      await continuePhaseBarrier;
    } else {
      firstPhaseWaiting += 1;
      if (firstPhaseWaiting === 2) releaseFirstPhase();
      await firstPhaseBarrier;
    }
    const trackId = continuation ? input.find((item) => item?.type === "function_call_output")?.call_id?.slice(-1) : requests.length;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(continuation ? {
      id: `response-final-${trackId}`,
      output_text: JSON.stringify({ ok: true, summary: `track-${trackId}-complete` }),
      output: [{ type: "message", role: "assistant", status: "completed", content: [] }],
    } : {
      id: `response-call-${trackId}`,
      output_text: "",
      output: [{
        id: `fc-${trackId}`,
        type: "function_call",
        status: "completed",
        call_id: `call-${trackId}`,
        name: "inspect_task",
        arguments: JSON.stringify({ task: `track-${trackId}` }),
      }],
    }));
    active -= 1;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const env = cleanProbeEnv();
    Object.assign(env, {
      AGENT_BRAIN_API_KEY: "test-concurrency-key-do-not-print",
      AGENT_BRAIN_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      AGENT_BRAIN_MODEL: "test-concurrency-model",
      AGENT_BRAIN_CHANNEL: "primary",
      SHANHAI_RESPONSES_CONCURRENCY_PROBE_SKIP_DOTENV: "1",
      V1_9R_RESPONSES_CONCURRENCY_EVIDENCE_PATH: evidencePath,
      V1_9R_RESPONSES_CONCURRENCY_TIMEOUT_MS: "5000",
    });

    const result = await runProbe(env);
    const evidenceText = await readFile(evidencePath, "utf8");
    const evidence = JSON.parse(evidenceText);
    assert.equal(result.code, 0, `${result.stderr || result.stdout}\n${evidenceText}`);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.trajectories.length, 2);
    assert.ok(evidence.trajectories.every((entry) => entry.phases.map((phase) => phase.name).join(",") === "function_call,observation_continuation"));
    assert.equal(requests.filter((entry) => !entry.continuation).length, 2);
    assert.equal(requests.filter((entry) => entry.continuation).length, 2);
    assert.ok(maxActive >= 2);
    assert.doesNotMatch(evidenceText, /test-concurrency-key-do-not-print/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-concurrency-key-do-not-print/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function cleanProbeEnv() {
  const env = { ...process.env };
  for (const key of [
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
    "AGENT_BRAIN_API_KEY", "AGENT_BRAIN_BASE_URL", "AGENT_BRAIN_MODEL",
    "AGENT_BRAIN_THIRD_API_KEY", "AGENT_BRAIN_THIRD_BASE_URL", "AGENT_BRAIN_THIRD_MODEL",
    "AGENT_BRAIN_FALLBACK_API_KEY", "AGENT_BRAIN_FALLBACK_BASE_URL", "AGENT_BRAIN_FALLBACK_MODEL",
  ]) delete env[key];
  return env;
}

function runProbe(env) {
  const child = spawn(process.execPath, ["scripts/run-v1-9r-responses-concurrency-probe.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.once("close", (code) => resolve({ code, stdout, stderr })));
}
