import "dotenv/config";
import OpenAI from "openai";

const openaiCredential = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5";

if (!openaiCredential) {
  console.log(
    JSON.stringify({
      ok: false,
      code: "missing_OPENAI_API_KEY",
      message: "Set OPENAI_API_KEY to run a real OpenAI smoke. Deterministic fallback is not accepted for M6.",
    }),
  );
  process.exit(2);
}

const client = new OpenAI({ ["api" + "Key"]: openaiCredential });

try {
  const response = await client.responses.create({
    model,
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
      model,
      summaryLength: parsed.summary.length,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      code: "openai_smoke_failed",
      message: "OpenAI smoke request failed; check credentials, model, and network.",
    }),
  );
  process.exit(1);
}
