import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputDir = path.join(root, ".tmp", "coze-ppt-smoke");

if (process.env.SHANHAI_COZE_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

export function extractCozePptResult(payload) {
  const content = findLastContent(payload);
  const parsed = parsePossibleFencedJson(content);
  const pptxUrl = parsed.pptx_url || parsed.pptxUrl || parsed.download_url || parsed.downloadUrl;

  if (!pptxUrl || typeof pptxUrl !== "string") {
    throw new Error("missing_pptx_url");
  }

  return {
    status: parsed.status || "unknown",
    pptxUrl,
    fileName: sanitizePptxFileName(parsed.file_name || parsed.fileName || "coze-ppt-smoke.pptx"),
  };
}

export async function validatePptxBuffer(buffer) {
  const hasZipHeader = buffer.subarray(0, 2).toString("ascii") === "PK";
  if (!hasZipHeader) {
    return { valid: false, hasZipHeader, hasPresentationXml: false };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const hasPresentationXml = Boolean(zip.file("ppt/presentation.xml"));
    return {
      valid: hasPresentationXml,
      hasZipHeader,
      hasPresentationXml,
    };
  } catch {
    return { valid: false, hasZipHeader, hasPresentationXml: false };
  }
}

function findLastContent(payload) {
  const messages = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload?.data?.messages)
      ? payload.data.messages
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  for (const message of [...messages].reverse()) {
    if (typeof message?.content === "string" && message.content.trim()) {
      return message.content;
    }
  }

  if (typeof payload?.content === "string") {
    return payload.content;
  }

  if (typeof payload?.output === "string") {
    return payload.output;
  }

  throw new Error("missing_coze_answer_content");
}

function parsePossibleFencedJson(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function sanitizePptxFileName(fileName) {
  const cleaned = String(fileName).replace(/[\\/:*?"<>|]+/g, "-").trim();
  const withExtension = cleaned.toLowerCase().endsWith(".pptx") ? cleaned : `${cleaned}.pptx`;
  return withExtension || "coze-ppt-smoke.pptx";
}

function buildSmokePrompt() {
  const promptPath = path.join(root, "fixtures", "ppt", "template-a1-original-visual-strategy.md");
  const manifestPath = path.join(root, "fixtures", "ppt-sample-manifest.json");
  const promptTemplate = readFileSync(promptPath, "utf8").slice(0, 1600);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const textbook = manifest.fixtures.find((fixture) => fixture.id === "sujiao-grade6-percentage-textbook");

  return [
    "请基于 ShanHaiEdu 本地真实 MVP 的固定测试样本，生成一份 1 页小学数学 PPTX。",
    "主题：苏教版小学六年级数学《百分数》导入课。",
    "年级：六年级。",
    "学科：数学。",
    "页数：1 页。",
    "要求：纯白背景、完全原创视觉策略、避免堆字、只给一个核心视觉和一句课堂问题。",
    `教材样本：${textbook?.id ?? "sujiao-grade6-percentage-textbook"}，sha256=${textbook?.sha256 ?? "unknown"}。`,
    "请返回 JSON，字段必须包含 status、pptx_url、file_name。",
    "不要返回解释文字，不要返回 Markdown 正文。",
    "提示词模板节选：",
    promptTemplate,
  ].join("\n");
}

function requiredConfig(env) {
  const runUrl = env.COZE_PPT_RUN_URL?.trim();
  const token = env.COZE_API_TOKEN?.trim();
  if (!runUrl || !token) {
    return null;
  }

  return {
    runUrl,
    token,
    timeoutMs: Number.parseInt(env.COZE_PPT_SMOKE_TIMEOUT_MS || "360000", 10),
    deadlineSeconds: Number.parseInt(env.COZE_PPT_DEADLINE_SECONDS || "300", 10),
  };
}

async function runCozePptSmoke() {
  const config = requiredConfig(process.env);
  if (!config) {
    console.log(
      JSON.stringify({
        ok: false,
        code: "missing_COZE_PPT_RUN_ENV",
        missing: ["COZE_PPT_RUN_URL", "COZE_API_TOKEN"],
        message: "Set COZE_PPT_RUN_URL and COZE_API_TOKEN to run a real Coze PPT smoke.",
      }),
    );
    process.exit(2);
  }

  const response = await fetch(config.runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-deadline-sec": String(config.deadlineSeconds),
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: buildSmokePrompt(),
        },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`coze_run_http_${response.status}`);
  }

  const payload = await response.json();
  const result = extractCozePptResult(payload);
  const pptxBuffer = await downloadPptx(result.pptxUrl, config.timeoutMs);
  const validation = await validatePptxBuffer(pptxBuffer);

  if (!validation.valid) {
    throw new Error("invalid_pptx_download");
  }

  mkdirSync(defaultOutputDir, { recursive: true });
  const outputName = `m16-${Date.now()}-${result.fileName}`;
  const outputPath = path.join(defaultOutputDir, outputName);
  writeFileSync(outputPath, pptxBuffer);

  console.log(
    JSON.stringify({
      ok: true,
      provider: "coze_ppt",
      channel: "run",
      fileName: result.fileName,
      localOutput: path.relative(root, outputPath).replaceAll("\\", "/"),
      bytes: pptxBuffer.length,
      sha256: createHash("sha256").update(pptxBuffer).digest("hex"),
      pptxValid: true,
      hasPresentationXml: validation.hasPresentationXml,
    }),
  );
}

async function downloadPptx(url, timeoutMs) {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`pptx_download_http_${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    await runCozePptSmoke();
  } catch {
    console.log(
      JSON.stringify({
        ok: false,
        code: "coze_ppt_smoke_failed",
        provider: "coze_ppt",
        channel: "run",
        message: "Coze PPT smoke failed; check credentials, channel status, output contract, and download validity.",
      }),
    );
    process.exit(1);
  }
}
