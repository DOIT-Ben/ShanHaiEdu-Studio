import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { resolvePptDesignPageCount, validatePptDesignDraftForCoze } from "@/server/ppt-design/ppt-design-validation";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

export { resolvePptDesignPageCount, validatePptDesignDraftForCoze } from "@/server/ppt-design/ppt-design-validation";

export type CozePptGenerationResult = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  requestedPageCount: number;
  slideCount: number;
  pptxValid: true;
  hasPresentationXml: true;
};

type CozePptConfig = {
  timeoutMs: number;
  deadlineSeconds: number;
} & (
  | {
      mode: "cli";
      sessionId?: string;
      messageTimeoutMs: number;
      watchTimeoutMs: number;
    }
  | {
      mode: "openapi";
      token: string;
      apiBase: string;
      botId: string;
      pollIntervalMs: number;
      maxPollAttempts: number;
    }
  | {
      mode: "run";
      token: string;
      runUrl: string;
    }
);

type CozePptDownloadedResult = {
  fileName: string;
  buffer: Buffer;
};

export async function generateCozePptFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
}): Promise<CozePptGenerationResult> {
  if (input.artifact.kind !== "ppt_design_draft" || input.artifact.nodeKey !== "ppt_design_draft") {
    throw new Error("missing_ppt_design_draft");
  }

  const designValidation = validatePptDesignDraftForCoze(input.artifact.markdownContent);
  if (!designValidation.valid) {
    throw new Error(designValidation.message);
  }

  const config = readConfig(process.env);
  const requestedPageCount = designValidation.pageCount;
  const result = await generateCozePptxBuffer(config, input.project, input.artifact);
  const pptxBuffer = result.buffer;
  const validation = await validatePptxBuffer(pptxBuffer);
  if (!validation.valid) {
    throw new Error("invalid_coze_pptx");
  }
  if (validation.slideCount !== requestedPageCount) {
    throw new Error(`coze_ppt_slide_count_mismatch_${validation.slideCount}_of_${requestedPageCount}`);
  }

  const outputName = `${input.project.id}-${Date.now()}-${result.fileName}`;
  const stored = writeLocalArtifact({
    category: "coze-ppt-artifacts",
    fileName: outputName,
    buffer: pptxBuffer,
  });

  return {
    fileName: result.fileName,
    localOutput: stored.localOutput,
    bytes: pptxBuffer.length,
    sha256: createHash("sha256").update(pptxBuffer).digest("hex"),
    requestedPageCount,
    slideCount: validation.slideCount,
    pptxValid: true,
    hasPresentationXml: true,
  };
}

async function generateCozePptxBuffer(config: CozePptConfig, project: ProjectRecord, artifact: ArtifactRecord): Promise<CozePptDownloadedResult> {
  if (config.mode === "cli") {
    return runCozeCliPpt(config, buildCliPrompt(project, artifact));
  }

  const prompt = buildPrompt(project, artifact);
  const result = config.mode === "openapi" ? await runCozeOpenApi(config, prompt) : await runCozePublishedEndpoint(config, prompt);
  return {
    fileName: result.fileName,
    buffer: await downloadPptx(result.pptxUrl, config.timeoutMs),
  };
}

async function runCozePublishedEndpoint(config: Extract<CozePptConfig, { mode: "run" }>, prompt: string) {
  const response = await fetch(config.runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-deadline-sec": String(config.deadlineSeconds),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error("coze_ppt_request_failed");
  }

  const payload = await response.json();
  return extractCozePptResult(payload);
}

async function runCozeOpenApi(config: Extract<CozePptConfig, { mode: "openapi" }>, prompt: string) {
  const submitResponse = await fetch(`${config.apiBase}/v3/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bot_id: config.botId,
      user_id: "shanhai-m59-real-pptx",
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "user",
          type: "question",
          content_type: "text",
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!submitResponse.ok) throw new Error("coze_openapi_submit_failed");
  const submitted = await submitResponse.json();
  const conversationId = readStringPath(submitted, ["data", "conversation_id"]) ?? readStringPath(submitted, ["conversation_id"]);
  const chatId = readStringPath(submitted, ["data", "id"]) ?? readStringPath(submitted, ["id"]) ?? readStringPath(submitted, ["data", "chat_id"]);
  if (!conversationId || !chatId) throw new Error("coze_openapi_missing_chat_ids");

  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    await delay(config.pollIntervalMs);
    const retrieveUrl = `${config.apiBase}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`;
    const retrieveResponse = await fetch(retrieveUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!retrieveResponse.ok) throw new Error("coze_openapi_retrieve_failed");
    const retrieved = await retrieveResponse.json();
    const status = readStringPath(retrieved, ["data", "status"]) ?? readStringPath(retrieved, ["status"]);
    if (status === "completed") break;
    if (status === "failed" || status === "canceled") throw new Error("coze_openapi_chat_failed");
    if (attempt === config.maxPollAttempts - 1) throw new Error("coze_openapi_chat_timeout");
  }

  const messagesUrl = `${config.apiBase}/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`;
  const messagesResponse = await fetch(messagesUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!messagesResponse.ok) throw new Error("coze_openapi_message_list_failed");
  const messages = await messagesResponse.json();
  return extractCozePptResult(messages);
}

export function extractCozePptResult(payload: unknown) {
  const content = findLastContent(payload);
  const parsed = parsePossibleFencedJson(content);
  const pptxUrl = parsed.pptx_url || parsed.pptxUrl || parsed.download_url || parsed.downloadUrl;
  if (!pptxUrl || typeof pptxUrl !== "string") {
    throw new Error("missing_pptx_url");
  }

  return {
    status: typeof parsed.status === "string" ? parsed.status : "unknown",
    pptxUrl,
    fileName: sanitizePptxFileName(parsed.file_name || parsed.fileName || "coze-ppt-artifact.pptx"),
  };
}

export async function validatePptxBuffer(buffer: Buffer) {
  const hasZipHeader = buffer.subarray(0, 2).toString("ascii") === "PK";
  if (!hasZipHeader) {
    return { valid: false, hasZipHeader, hasPresentationXml: false, slideCount: 0 };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const hasPresentationXml = Boolean(zip.file("ppt/presentation.xml"));
    const slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
    return { valid: hasPresentationXml && slideCount > 0, hasZipHeader, hasPresentationXml, slideCount };
  } catch {
    return { valid: false, hasZipHeader, hasPresentationXml: false, slideCount: 0 };
  }
}

function readConfig(env: NodeJS.ProcessEnv): CozePptConfig {
  const timeoutMs = Number.parseInt(env.COZE_PPT_SMOKE_TIMEOUT_MS || "360000", 10);
  const deadlineSeconds = Number.parseInt(env.COZE_PPT_DEADLINE_SECONDS || "300", 10);
  const channel = env.COZE_PPT_CHANNEL?.trim().toLowerCase();
  if (channel === "cli" || env.COZE_PPT_USE_CLI === "1") {
    return {
      mode: "cli",
      sessionId: env.COZE_CLI_SESSION_ID?.trim() || undefined,
      timeoutMs,
      deadlineSeconds,
      messageTimeoutMs: Number.parseInt(env.COZE_PPT_CLI_MESSAGE_TIMEOUT_MS || "180000", 10),
      watchTimeoutMs: Number.parseInt(env.COZE_PPT_CLI_WATCH_TIMEOUT_MS || "180000", 10),
    };
  }

  const runUrl = env.COZE_PPT_RUN_URL?.trim();
  const token = env.COZE_API_TOKEN?.trim();
  const botId = env.COZE_PPT_BOT_ID?.trim();
  if (!token || (!botId && !runUrl)) {
    throw new Error("missing_COZE_PPT_RUN_ENV");
  }

  if (botId) {
    return {
      mode: "openapi",
      apiBase: (env.COZE_API_BASE?.trim() || "https://api.coze.cn").replace(/\/$/, ""),
      botId,
      token,
      timeoutMs,
      deadlineSeconds,
      pollIntervalMs: Number.parseInt(env.COZE_PPT_POLL_INTERVAL_SECONDS || "1", 10) * 1000,
      maxPollAttempts: Number.parseInt(env.COZE_PPT_MAX_POLL_ATTEMPTS || "300", 10),
    };
  }

  return {
    mode: "run",
    runUrl: runUrl!,
    token,
    timeoutMs,
    deadlineSeconds,
  };
}

async function runCozeCliPpt(config: Extract<CozePptConfig, { mode: "cli" }>, prompt: string): Promise<CozePptDownloadedResult> {
  const sessionId = config.sessionId ?? (await readCurrentCozeSessionId());
  const messageOutput = await runCozeCommand(["session", "message", "-s", sessionId, "--wait", "--timeout", String(config.messageTimeoutMs), "--format", "json"], prompt, config.messageTimeoutMs + 30_000);
  const messageEvents = parseCozeJsonOutput(messageOutput);
  const messageId = findReplyTargetMessageId(messageEvents);
  let pptFile = findPptFile(messageEvents);

  if (!pptFile) {
    const watchOutput = await runCozeCommand(["session", "watch", "-s", sessionId, "--timeout", String(config.watchTimeoutMs), "--format", "json"], undefined, config.watchTimeoutMs + 30_000);
    pptFile = findPptFile(parseCozeJsonOutput(watchOutput));
  }

  if (!pptFile && messageId) {
    const repliesOutput = await runCozeCommand(["session", "replies", messageId, "-s", sessionId, "--format", "json"], undefined, 60_000);
    pptFile = findPptFile(parseCozeJsonOutput(repliesOutput));
  }

  if (!pptFile?.fileUrl) {
    throw new Error("coze_cli_missing_pptx_file_url");
  }

  return {
    fileName: sanitizePptxFileName(pptFile.fileName || "coze-session-ppt.pptx"),
    buffer: await downloadPptx(pptFile.fileUrl, config.timeoutMs),
  };
}

async function readCurrentCozeSessionId() {
  const output = await runCozeCommand(["session", "current", "--format", "json"], undefined, 30_000);
  const parsed = JSON.parse(output) as { session_id?: unknown };
  if (typeof parsed.session_id !== "string" || !parsed.session_id.trim()) {
    throw new Error("coze_cli_missing_current_session");
  }
  return parsed.session_id;
}

function runCozeCommand(args: string[], input: string | undefined, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const command = process.platform === "win32" ? "cmd.exe" : "coze";
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "coze", ...args] : args;
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("coze_cli_timeout"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8");
      if (code === 0) {
        resolve(text);
        return;
      }
      reject(new Error(`coze_cli_failed_${code ?? "unknown"}`));
    });

    if (input) child.stdin.end(input, "utf8");
    else child.stdin.end();
  });
}

function parseCozeJsonOutput(output: string): unknown[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  }
}

function findReplyTargetMessageId(events: unknown[]) {
  for (const event of events) {
    const value = event as { reply_to_message_id?: unknown; message_id?: unknown };
    if (typeof value.reply_to_message_id === "string" && value.reply_to_message_id.trim()) return value.reply_to_message_id;
    if (typeof value.message_id === "string" && value.message_id.trim()) return value.message_id;
  }
  return null;
}

function findPptFile(events: unknown[]) {
  const files = events.flatMap((event) => collectCozeFiles(event));
  return files.find((file) => typeof file.fileUrl === "string" && file.fileUrl && file.fileName.toLowerCase().endsWith(".pptx") && isTrustedCozeFileUrl(file.fileUrl));
}

function collectCozeFiles(value: unknown, found: Array<{ fileName: string; fileUrl: string }> = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectCozeFiles(item, found);
    return found;
  }

  const record = value as Record<string, unknown>;
  const fileName = record.file_name ?? record.fileName;
  const fileUrl = record.file_url ?? record.fileUrl;
  if (typeof fileUrl === "string") {
    found.push({ fileName: typeof fileName === "string" ? fileName : "coze-session-ppt.pptx", fileUrl });
  }

  for (const child of Object.values(record)) collectCozeFiles(child, found);
  return found;
}

function buildCliPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  const pageCount = resolvePptDesignPageCount(artifact.markdownContent);
  return [
    `@PPT 请基于下面这份逐页四层 PPT 设计稿生成一份小学数学 PPTX。`,
    `课题：${project.lessonTopic || "百分数导入课"}`,
    `年级：${project.grade || "六年级"}`,
    `学科：${project.subject || "数学"}`,
    `硬性要求：必须生成 ${pageCount} 页，不能只生成封面或说明页；每页必须落实底图、元素、文字、排版四层；生成可下载 PPTX 文件。`,
    "请直接生成 PPTX 产物，不要只返回 Markdown 或说明文字。",
    "当前逐页四层 PPT 设计稿：",
    artifact.markdownContent,
  ].join("\n");
}

function readStringPath(value: unknown, pathSegments: string[]) {
  let cursor = value;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  const promptTemplate = safeReadText(path.join(process.cwd(), "fixtures", "ppt", "template-a1-original-visual-strategy.md")).slice(0, 1600);
  const manifest = readFixtureManifest();
  const textbook = manifest.fixtures.find((fixture) => fixture.id === "sujiao-grade6-percentage-textbook");
  const pageCount = resolvePptDesignPageCount(artifact.markdownContent);

  return [
    "请基于 ShanHaiEdu 本地真实 MVP 的逐页四层 PPT 设计稿，生成一份小学数学 PPTX。",
    `课题：${project.lessonTopic || "百分数导入课"}`,
    `年级：${project.grade || "六年级"}`,
    `学科：${project.subject || "数学"}`,
    `页数：${pageCount} 页。`,
    `要求：严格按设计稿生成，不自行改写成说明文档；每页必须落实底图、元素、文字、排版四层，形成可直接用于公开课的完整 ${pageCount} 页课件。`,
    `教材样本：${textbook?.id ?? "sujiao-grade6-percentage-textbook"}，sha256=${textbook?.sha256 ?? "unknown"}。`,
    "请返回 JSON，字段必须包含 status、pptx_url、file_name。",
    "不要返回解释文字，不要返回 Markdown 正文。",
    "当前逐页四层 PPT 设计稿：",
    artifact.markdownContent,
    "提示词模板节选：",
    promptTemplate,
  ].join("\n");
}

function readFixtureManifest(): { fixtures: Array<{ id: string; sha256?: string }> } {
  return JSON.parse(safeReadText(path.join(process.cwd(), "fixtures", "ppt-sample-manifest.json")));
}

function safeReadText(filePath: string) {
  return readFileSync(filePath, "utf8");
}

function isTrustedCozeFileUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "static.coze.site" || url.hostname.endsWith(".coze.site") || url.hostname === "www.coze.cn");
  } catch {
    return false;
  }
}

function findLastContent(payload: unknown): string {
  const value = payload as {
    messages?: Array<{ content?: unknown }>;
    data?: unknown;
    content?: unknown;
    output?: unknown;
  };
  const data = value?.data as { messages?: Array<{ content?: unknown }> } | Array<{ content?: unknown }> | undefined;
  const messages = Array.isArray(value?.messages)
    ? value.messages
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.messages)
        ? data.messages
        : [];

  const answerMessages = messages.filter((message) => (message as { type?: unknown })?.type === "answer");
  for (const message of [...(answerMessages.length ? answerMessages : messages)].reverse()) {
    if (typeof message?.content === "string" && message.content.trim()) {
      return message.content;
    }
  }

  if (typeof value?.content === "string") return value.content;
  if (typeof value?.output === "string") return value.output;
  throw new Error("missing_coze_answer_content");
}

function parsePossibleFencedJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_coze_answer_json");
  }
  return parsed as Record<string, unknown>;
}

function sanitizePptxFileName(fileName: unknown) {
  const cleaned = String(fileName).replace(/[\\/:*?"<>|]+/g, "-").trim();
  const baseName = cleaned || "coze-ppt-artifact";
  return baseName.toLowerCase().endsWith(".pptx") ? baseName : `${baseName}.pptx`;
}

async function downloadPptx(url: string, timeoutMs: number) {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error("coze_ppt_download_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}
