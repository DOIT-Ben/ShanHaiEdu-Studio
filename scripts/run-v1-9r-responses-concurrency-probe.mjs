import OpenAI from "openai";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const inspectTaskTool = {
  type: "function",
  name: "inspect_task",
  description: "Inspect one independent text-only task before returning a structured finish.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: { task: { type: "string" } },
  },
};

if (process.env.SHANHAI_RESPONSES_CONCURRENCY_PROBE_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

const config = pickOpenAICompatibleConfig(process.env);
if (!config) {
  console.log(JSON.stringify({
    ok: false,
    code: "missing_OPENAI_COMPATIBLE_CREDENTIAL",
    message: "A configured OpenAI-compatible Responses channel is required; no fallback result will be generated.",
  }));
  process.exit(2);
}

const timeoutMs = positiveInteger(process.env.V1_9R_RESPONSES_CONCURRENCY_TIMEOUT_MS, 180_000);
const evidencePath = path.resolve(
  process.env.V1_9R_RESPONSES_CONCURRENCY_EVIDENCE_PATH
    || "test-results/v1-9r-responses-concurrency-health.json",
);
const client = new OpenAI({
  apiKey: config.credential,
  baseURL: config.baseURL,
  timeout: timeoutMs,
  maxRetries: 0,
});
const startedAt = Date.now();
const tracks = ["track-a", "track-b"];
const firstPhaseStartedAt = Date.now();
const firstPhase = await Promise.all(tracks.map((trackId) => runFunctionCall(trackId)));
const firstPhaseCompletedAt = Date.now();
const firstPhaseByTrack = new Map(firstPhase.map((entry) => [entry.trackId, entry]));
const canContinueConcurrently = firstPhase.every((entry) => entry.ok);
const continuationStartedAt = canContinueConcurrently ? Date.now() : null;
const continuations = canContinueConcurrently
  ? await Promise.all(firstPhase.map((entry) => runContinuation(entry)))
  : [];
const continuationCompletedAt = continuationStartedAt === null ? null : Date.now();
const continuationByTrack = new Map(continuations.map((entry) => [entry.trackId, entry]));
const trajectories = tracks.map((trackId) => {
  const first = firstPhaseByTrack.get(trackId);
  const continuation = continuationByTrack.get(trackId);
  return {
    trackId,
    ok: first?.ok === true && continuation?.ok === true,
    phases: [first?.evidence, continuation?.evidence].filter(Boolean),
  };
});
const ok = trajectories.every((entry) => entry.ok);
const evidence = {
  capturedAt: new Date().toISOString(),
  channel: config.channel,
  credentialSource: config.credentialSource,
  model: sanitize(config.model),
  configFingerprint: createHash("sha256")
    .update(JSON.stringify({ channel: config.channel, credentialSource: config.credentialSource, baseURL: config.baseURL, model: config.model }))
    .digest("hex")
    .slice(0, 12),
  maxRetries: 0,
  timeoutMs,
  concurrency: tracks.length,
  windows: {
    functionCall: {
      startedOffsetMs: firstPhaseStartedAt - startedAt,
      durationMs: firstPhaseCompletedAt - firstPhaseStartedAt,
      simultaneousLaunch: true,
    },
    observationContinuation: continuationStartedAt === null ? null : {
      startedOffsetMs: continuationStartedAt - startedAt,
      durationMs: continuationCompletedAt - continuationStartedAt,
      simultaneousLaunch: true,
    },
  },
  trajectories,
  ok,
  doesNotProve: [
    "real-main-agent-browser-flow",
    "R5-complete",
    "business-tool-runtime-health",
    "production-artifact",
  ],
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok,
  code: ok ? "responses_concurrency_probe_passed" : "responses_concurrency_probe_failed",
  channel: config.channel,
  model: sanitize(config.model),
  trajectoryCount: trajectories.length,
  evidenceFile: path.basename(evidencePath),
}));
if (!ok) process.exitCode = 1;

async function runFunctionCall(trackId) {
  const phaseStartedAt = Date.now();
  try {
    const response = await client.responses.create({
      model: config.model,
      reasoning: { effort: "medium" },
      instructions: [
        "This is a ShanHaiEdu text control-plane health check.",
        "First call inspect_task exactly once. After its observation, return only the requested JSON.",
        "Do not include secrets, URLs, local paths, provider diagnostics, or user data.",
      ].join("\n"),
      input: [originalInputItem(trackId)],
      tools: [inspectTaskTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    const calls = functionCalls(response);
    if (calls.length !== 1 || calls[0].name !== "inspect_task" || typeof calls[0].call_id !== "string") {
      return failedPhase(trackId, "function_call", phaseStartedAt, "function_call_contract_failed", outputTypes(response));
    }
    return {
      ok: true,
      trackId,
      response,
      call: calls[0],
      evidence: {
        name: "function_call",
        ok: true,
        durationMs: Date.now() - phaseStartedAt,
        outputTypes: outputTypes(response),
        selectedToolName: "inspect_task",
        reasonCode: "function_call_received",
      },
    };
  } catch (error) {
    return failedPhase(trackId, "function_call", phaseStartedAt, classifyError(error), [], error);
  }
}

async function runContinuation(firstPhaseResult) {
  const phaseStartedAt = Date.now();
  try {
    const response = await client.responses.create({
      model: config.model,
      reasoning: { effort: "medium" },
      instructions: [
        "This is a ShanHaiEdu text control-plane health check.",
        "The inspect_task observation is authoritative. Return only the requested JSON and do not call the tool again.",
        "Do not include secrets, URLs, local paths, provider diagnostics, or user data.",
      ].join("\n"),
      input: [
        originalInputItem(firstPhaseResult.trackId),
        ...firstPhaseResult.response.output,
        {
          type: "function_call_output",
          call_id: firstPhaseResult.call.call_id,
          output: JSON.stringify({
            status: "succeeded",
            observation: { taskAccepted: true, trackId: firstPhaseResult.trackId },
          }),
        },
      ],
      tools: [inspectTaskTool],
      tool_choice: "auto",
      parallel_tool_calls: false,
      text: {
        format: {
          type: "json_schema",
          name: "shanhai_concurrent_responses_finish",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok", "summary"],
            properties: {
              ok: { type: "boolean", const: true },
              summary: { type: "string" },
            },
          },
        },
      },
    });
    if (functionCalls(response).length > 0) {
      return failedPhase(firstPhaseResult.trackId, "observation_continuation", phaseStartedAt, "unexpected_repeated_tool_call", outputTypes(response));
    }
    const parsed = JSON.parse(response.output_text || "{}");
    if (parsed.ok !== true || typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      return failedPhase(firstPhaseResult.trackId, "observation_continuation", phaseStartedAt, "structured_finish_contract_failed", outputTypes(response));
    }
    return {
      ok: true,
      trackId: firstPhaseResult.trackId,
      evidence: {
        name: "observation_continuation",
        ok: true,
        durationMs: Date.now() - phaseStartedAt,
        outputTypes: outputTypes(response),
        reasonCode: "structured_finish_received",
        observationConsumed: true,
      },
    };
  } catch (error) {
    return failedPhase(firstPhaseResult.trackId, "observation_continuation", phaseStartedAt, classifyError(error), [], error);
  }
}

function failedPhase(trackId, name, startedAt, reasonCode, types, error) {
  return {
    ok: false,
    trackId,
    evidence: {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      outputTypes: types,
      reasonCode,
      observation: sanitize(errorMessage(error) || reasonCode),
      recoveryEntry: name === "function_call"
        ? "retry both concurrent function-call tracks only after channel health changes"
        : "retry both concurrent observation continuations only after channel health changes",
    },
  };
}

function pickOpenAICompatibleConfig(env) {
  const openaiCredential = env.OPENAI_API_KEY?.trim();
  if (openaiCredential) {
    return {
      credential: openaiCredential,
      credentialSource: "openai_env",
      channel: "openai",
      baseURL: trimOptional(env.OPENAI_BASE_URL),
      model: env.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
    };
  }
  const selected = (env.AGENT_BRAIN_CHANNEL?.trim() || "primary").toLowerCase();
  const channel = selected === "fallback" ? "fallback" : selected === "third" ? "third" : "primary";
  const prefix = channel === "fallback" ? "AGENT_BRAIN_FALLBACK_" : channel === "third" ? "AGENT_BRAIN_THIRD_" : "AGENT_BRAIN_";
  const credential = env[`${prefix}API_KEY`]?.trim();
  if (!credential) return null;
  return {
    credential,
    credentialSource: channel === "fallback" ? "agent_brain_fallback_ledger_env" : channel === "third" ? "agent_brain_third_ledger_env" : "agent_brain_ledger_env",
    channel,
    baseURL: trimOptional(env[`${prefix}BASE_URL`]),
    model: env[`${prefix}MODEL`]?.trim() || "gpt-5.6-terra",
  };
}

function originalInputItem(trackId) {
  return {
    role: "user",
    content: [{ type: "input_text", text: `Inspect ${trackId} as an independent text-only task, then consume its observation.` }],
  };
}

function functionCalls(response) {
  return Array.isArray(response?.output) ? response.output.filter((item) => item?.type === "function_call") : [];
}

function outputTypes(response) {
  return Array.isArray(response?.output)
    ? response.output.map((item) => sanitize(item?.type || "unknown"))
    : [];
}

function classifyError(error) {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("timed out") || message.includes("timeout")) return "provider_timeout";
  const status = Number(error?.status);
  if (status === 401 || status === 403) return "provider_access_denied";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_upstream_failed";
  return "provider_request_failed";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(api[_-]?key|credential|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s,;)]+/gi, "[redacted-url]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s,;)]+/g, "[redacted-path]")
    .slice(0, 600);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimOptional(value) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
