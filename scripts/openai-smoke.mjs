import OpenAI from "openai";

if (process.env.SHANHAI_SMOKE_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

function pickOpenAICompatibleConfig(env) {
  const ledgerChannels = {
    primary: {
      credentialSource: "agent_brain_ledger_env",
      apiKey: "AGENT_BRAIN_API_KEY",
      baseURL: "AGENT_BRAIN_BASE_URL",
      model: "AGENT_BRAIN_MODEL",
    },
    third: {
      credentialSource: "agent_brain_third_ledger_env",
      apiKey: "AGENT_BRAIN_THIRD_API_KEY",
      baseURL: "AGENT_BRAIN_THIRD_BASE_URL",
      model: "AGENT_BRAIN_THIRD_MODEL",
    },
    fallback: {
      credentialSource: "agent_brain_fallback_ledger_env",
      apiKey: "AGENT_BRAIN_FALLBACK_API_KEY",
      baseURL: "AGENT_BRAIN_FALLBACK_BASE_URL",
      model: "AGENT_BRAIN_FALLBACK_MODEL",
    },
  };

  const configuredLedgerChannel = env.AGENT_BRAIN_CHANNEL?.trim().toLowerCase();
  if (configuredLedgerChannel && !Object.hasOwn(ledgerChannels, configuredLedgerChannel)) {
    throw new Error("invalid_AGENT_BRAIN_CHANNEL");
  }
  const hasLedgerConfiguration = Boolean(
    configuredLedgerChannel
    || Object.values(ledgerChannels).some((channel) => env[channel.apiKey]?.trim()),
  );
  if (hasLedgerConfiguration) {
    const selectedLedgerChannel = ledgerChannels[configuredLedgerChannel || "primary"];
    const ledgerCredential = env[selectedLedgerChannel.apiKey]?.trim();
    if (!ledgerCredential) return null;
    return {
      credential: ledgerCredential,
      credentialSource: selectedLedgerChannel.credentialSource,
      baseURL: env[selectedLedgerChannel.baseURL]?.trim(),
      model: env[selectedLedgerChannel.model]?.trim() || "gpt-5.6-terra",
    };
  }

  const openaiCredential = env.OPENAI_API_KEY?.trim();
  if (openaiCredential) {
    return {
      credential: openaiCredential,
      credentialSource: "openai_env",
      baseURL: env.OPENAI_BASE_URL?.trim(),
      model: env.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
    };
  }

  return null;
}

let config;
try {
  config = pickOpenAICompatibleConfig(process.env);
} catch {
  console.log(JSON.stringify({
    ok: false,
    code: "invalid_AGENT_BRAIN_CHANNEL",
    message: "Select primary, third, or fallback before running the smoke request.",
  }));
  process.exit(2);
}

if (!config) {
  console.log(
    JSON.stringify({
      ok: false,
      code: "missing_OPENAI_COMPATIBLE_CREDENTIAL",
      missing: [
        "OPENAI_API_KEY",
        "AGENT_BRAIN_API_KEY",
        "AGENT_BRAIN_THIRD_API_KEY",
        "AGENT_BRAIN_FALLBACK_API_KEY",
      ],
      message: "Set OPENAI_API_KEY or AGENT_BRAIN_API_KEY to run a real OpenAI-compatible smoke. Deterministic fallback is not accepted.",
    }),
  );
  process.exit(2);
}

const timeout = Number.parseInt(process.env.OPENAI_SMOKE_TIMEOUT_MS || "15000", 10);
const clientOptions = {
  ["api" + "Key"]: config.credential,
  timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
  maxRetries: 0,
};

if (config.baseURL) {
  clientOptions.baseURL = config.baseURL;
}

const client = new OpenAI(clientOptions);

try {
  const response = await client.responses.create({
    model: config.model,
    reasoning: { effort: "high" },
    instructions: "Return only the requested JSON. Do not include secrets, local paths, debug traces, or provider diagnostics.",
    input: "Smoke test ShanHaiEdu OpenAI Runtime Adapter readiness with one short Chinese sentence.",
    text: {
      format: {
        type: "json_schema",
        name: "shanhai_openai_smoke",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "summary"],
          properties: {
            ok: { type: "boolean" },
            summary: { type: "string" },
          },
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text ?? "{}");
  if (parsed.ok !== true || typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("invalid_smoke_output");
  }

  console.log(
    JSON.stringify({
      ok: true,
      runtimeKind: "openai",
      generationMode: "model_generated",
      credentialSource: config.credentialSource,
      model: config.model,
      summaryLength: parsed.summary.length,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      code: "openai_smoke_failed",
      credentialSource: config.credentialSource,
      model: config.model,
      message: "OpenAI smoke request failed; check credentials, model, and network.",
    }),
  );
  process.exit(1);
}
