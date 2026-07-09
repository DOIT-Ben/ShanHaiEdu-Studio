import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

await import("dotenv/config");

const root = process.cwd();
const port = process.env.M59_PORT || "3137";
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.join(root, ".tmp", "m59-real-coze-pptx-10pages");
mkdirSync(outputDir, { recursive: true });

let cookie = "";
let currentStage = "init";

const projectInput = {
  title: "M59真实验收-五年级百分数10页PPTX",
  grade: "五年级",
  subject: "数学",
  lessonTopic: "百分数的认识",
};

const pptDesignDraft = [
  "# 五年级数学《百分数的认识》10页逐页四层PPT设计稿",
  "",
  "页数：10页",
  "课型：公开课 / 新授课 / 40分钟",
  "整体风格：白底、低噪、生活化数学场景；用蓝绿色作为主色，橙色只用于关键百分数；每页一个核心问题，避免堆字。",
  "字体建议：标题 30-36pt，核心数字 44-60pt，正文 18-24pt；所有文字必须可编辑。",
  "交付要求：生成可编辑 PPTX，不要输出说明文档；严格按每页的底图、元素、文字、排版执行。",
  "",
  "## 第1页：封面：今天你见过百分数吗？",
  "- 底图：纯白背景，右下角淡蓝绿色圆角区域，放置商场折扣牌、运动命中率、电量图标的浅色线稿组合。",
  "- 元素：一个大号百分号图形；三个小标签：85折、命中率60%、电量35%。",
  "- 文字：标题《百分数的认识》；副标题：从生活里的百分号开始；课堂问题：这些“%”都在表示什么？",
  "- 排版：左侧标题区占60%，右侧图形区占40%；标题左对齐，课堂问题放在底部横条中。",
  "",
  "## 第2页：生活搜寻：百分数藏在哪里？",
  "- 底图：白底加浅灰网格，像课堂观察板。",
  "- 元素：四张圆角卡片：果汁含量30%、投篮命中率75%、空气湿度58%、班级到校率100%。",
  "- 文字：标题：生活中的百分数；提示：先读一读，再说一说它和谁比。",
  "- 排版：2×2卡片布局；每张卡片数字最大，解释文字较小；底部留一行学生发言提示。",
  "",
  "## 第3页：核心问题：为什么都和100有关？",
  "- 底图：白底，中央一张淡绿色100格方阵。",
  "- 元素：100个小格中高亮37格；旁边有箭头从“37格”指向“37%”。",
  "- 文字：标题：把整体平均分成100份；核心句：37% 表示其中的37份；追问：如果高亮50格、100格呢？",
  "- 排版：左侧100格图占55%，右侧解释区占45%；核心句用橙色强调37%。",
  "",
  "## 第4页：定义建构：什么是百分数？",
  "- 底图：纯白背景，顶部一条浅蓝标题栏。",
  "- 元素：概念公式卡片：一个数是另一个数的百分之几；下方放“比较关系”小图标。",
  "- 文字：标题：百分数表示两个量之间的关系；定义：表示一个数是另一个数的百分之几的数，叫作百分数。",
  "- 排版：定义居中大卡片，关键词“一个数”“另一个数”“百分之几”分色标注；右侧留教师批注位。",
  "",
  "## 第5页：读写训练：百分号怎么读、怎么写？",
  "- 底图：白底，仿练习本横线淡纹。",
  "- 元素：三组示例：25%、60%、100%；每组包含读法、写法和一句生活语境。",
  "- 文字：标题：读作“百分之……”；示例：25% 读作百分之二十五。",
  "- 排版：三列并排，每列顶部是大号百分数，中部读法，底部情境；整体留足空白。",
  "",
  "## 第6页：关系辨析：百分数不是具体数量",
  "- 底图：白底，左右对比板。",
  "- 元素：左侧“30%”关系标签，右侧“30千克”具体数量标签，中间用对比箭头连接。",
  "- 文字：标题：百分数通常不带单位；辨析句：30% 表示比较关系，30千克表示具体数量。",
  "- 排版：左右分栏；左栏用百分号视觉，右栏用称重图标；底部放判断题：一袋米重80%千克，对吗？",
  "",
  "## 第7页：小组活动：把班级数据说成百分数",
  "- 底图：浅绿色课堂活动板，白色中心区域。",
  "- 元素：活动任务卡、计时器图标、小组汇报气泡；示例数据：40人中32人完成预习。",
  "- 文字：标题：我会用百分数表达关系；任务：先找总数，再找部分，最后说“占百分之几”。",
  "- 排版：左侧活动步骤1-2-3，右侧示例数据表；底部放汇报句式：……占……的……%。",
  "",
  "## 第8页：即时练习：判断与解释",
  "- 底图：白底，顶部淡蓝进度条。",
  "- 元素：三道练习卡片：读写题、意义解释题、单位辨析题；每题右下角有“说理由”标签。",
  "- 文字：标题：不只会算，更要会解释；题1：45%读作？题2：女生人数占全班52%是什么意思？题3：一根绳长70%米对吗？",
  "- 排版：三张卡片横向排列；题干清晰，答案区留空，适合课堂互动。",
  "",
  "## 第9页：课堂总结：百分数是一种比较语言",
  "- 底图：白底，中央浅色思维导图。",
  "- 元素：中心节点“百分数”，三条分支：表示关系、分母看作100、通常不带单位。",
  "- 文字：标题：今天我们认识了百分数；总结句：百分数帮助我们更清楚地比较两个量。",
  "- 排版：标题居上，思维导图居中，底部一句学生自评：我能解释生活中的一个百分数。",
  "",
  "## 第10页：课后任务：继续寻找生活中的百分数",
  "- 底图：纯白背景，右侧浅色相机/记录本插画。",
  "- 元素：任务清单3条：拍一拍、记一记、说一说；一个“生活百分数记录卡”小表格。",
  "- 文字：标题：把数学带回生活；任务：找到3个百分数，写清它表示谁是谁的百分之几。",
  "- 排版：左侧任务清单，右侧记录卡；结尾语：下节课分享你的发现。",
].join("\n");

async function api(pathname, options = {}) {
  currentStage = `api:${pathname}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${pathname} failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return response;
}

async function apiJson(pathname, body) {
  const response = await api(pathname, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response.json();
}

function resolveLocalOutput(localOutput) {
  if (localOutput?.startsWith(".tmp/")) return path.join(root, ...localOutput.split("/"));
  if (localOutput?.startsWith("artifact-storage/")) {
    const configuredRoot = process.env.ARTIFACT_STORAGE_ROOT?.trim();
    return path.join(configuredRoot || path.join(root, ".tmp"), ...localOutput.split("/").slice(1));
  }
  throw new Error(`unsupported localOutput: ${localOutput}`);
}

async function inspectPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] ?? 0) - Number(b.match(/slide(\d+)/)?.[1] ?? 0));
  const combinedSlideXml = (await Promise.all(slideNames.map((name) => zip.file(name).async("string")))).join("\n");
  return {
    hasPresentationXml: Boolean(zip.file("ppt/presentation.xml")),
    slideCount: slideNames.length,
    containsFallbackText: /根据文本大纲生成的最小 PPTX|PPT 文件说明|交付边界|当前 PPT 大纲/.test(combinedSlideXml),
    containsEditableTextRuns: /<a:t>/.test(combinedSlideXml),
  };
}

async function main() {
  const project = await apiJson("/api/workbench/projects", projectInput);
  const projectId = project.project.id;

  const sourceArtifact = await apiJson(`/api/workbench/projects/${projectId}/artifacts`, {
    nodeKey: "ppt_design_draft",
    kind: "ppt_design_draft",
    title: "五年级百分数10页逐页四层PPT设计稿",
    status: "needs_review",
    summary: "真实 Coze PPTX 生成验收用设计稿，10页，每页包含底图、元素、文字、排版。",
    markdownContent: pptDesignDraft,
    structuredContent: {
      课题: "百分数的认识",
      页数: "10页",
      设计层级: ["底图", "元素", "文字", "排版"],
      用途: "公开课真实PPTX生成验收",
    },
  });

  const coze = await generateCozePptxDirectly(project.project, sourceArtifact.artifact);
  const generatedResponse = await apiJson(`/api/workbench/projects/${projectId}/artifacts`, {
    nodeKey: "pptx_artifact",
    kind: "pptx_artifact",
    title: "真实 PPTX 文件",
    status: "needs_review",
    summary: "已基于当前逐页四层 PPT 设计稿生成真实 PPTX 文件，请下载后核对页面内容。",
    markdownContent: [
      "# 真实 PPTX 文件",
      "",
      "已基于当前逐页四层 PPT 设计稿生成真实 PPTX 文件。",
      "",
      "正式授课前请核对教材、页码、例题、页面顺序和课堂节奏。",
    ].join("\n"),
    structuredContent: {
      storage: {
        cozePptx: {
          localOutput: coze.localOutput,
          fileName: coze.fileName,
          bytes: coze.bytes,
          sha256: coze.sha256,
          generationMode: "coze_generated",
          sourceArtifactId: sourceArtifact.artifact.id,
        },
      },
      文件状态: "真实 PPTX 已生成",
      文件大小: `${coze.bytes} bytes`,
    },
  });
  const generated = generatedResponse.artifact;
  if (generated.nodeKey !== "pptx_artifact" || generated.kind !== "pptx_artifact") {
    throw new Error(`unexpected artifact type: ${generated.nodeKey}/${generated.kind}`);
  }

  const storage = generated.structuredContent?.storage?.cozePptx;
  const storedPath = resolveLocalOutput(storage?.localOutput);
  const storedBuffer = readFileSync(storedPath);
  const downloadedResponse = await api(`/api/workbench/projects/${projectId}/artifacts/${generated.id}/pptx`, { method: "GET" });
  const downloadedBuffer = Buffer.from(await downloadedResponse.arrayBuffer());
  const inspection = await inspectPptx(downloadedBuffer);

  if (downloadedBuffer.subarray(0, 2).toString("ascii") !== "PK") throw new Error("downloaded file is not a pptx zip");
  if (!inspection.hasPresentationXml) throw new Error("downloaded pptx is missing ppt/presentation.xml");
  if (inspection.slideCount !== 10) throw new Error(`expected 10 slides, got ${inspection.slideCount}`);
  if (inspection.containsFallbackText) throw new Error("downloaded pptx contains legacy fallback text");
  if (!inspection.containsEditableTextRuns) throw new Error("downloaded pptx does not contain editable text runs");
  if (createHash("sha256").update(storedBuffer).digest("hex") !== createHash("sha256").update(downloadedBuffer).digest("hex")) {
    throw new Error("downloaded PPTX does not match stored Coze artifact");
  }

  const outputPath = path.join(outputDir, `m59-${projectId}-coze-10pages.pptx`);
  const designPath = path.join(outputDir, `m59-${projectId}-ppt-design-draft.md`);
  const reportPath = path.join(outputDir, `m59-${projectId}-coze-10pages-report.json`);
  writeFileSync(outputPath, downloadedBuffer);
  writeFileSync(designPath, pptDesignDraft, "utf8");

  const report = {
    ok: true,
    projectId,
    sourceArtifact: {
      id: sourceArtifact.artifact.id,
      nodeKey: sourceArtifact.artifact.nodeKey,
      kind: sourceArtifact.artifact.kind,
      title: sourceArtifact.artifact.title,
    },
    generatedArtifact: {
      id: generated.id,
      nodeKey: generated.nodeKey,
      kind: generated.kind,
      title: generated.title,
    },
    pptx: {
      outputPath: path.relative(root, outputPath).replaceAll("\\", "/"),
      storedLocalOutput: storage.localOutput,
      fileName: storage.fileName,
      bytes: downloadedBuffer.length,
      sha256: createHash("sha256").update(downloadedBuffer).digest("hex"),
      slideCount: inspection.slideCount,
      hasPresentationXml: inspection.hasPresentationXml,
      containsFallbackText: inspection.containsFallbackText,
      containsEditableTextRuns: inspection.containsEditableTextRuns,
    },
    designPath: path.relative(root, designPath).replaceAll("\\", "/"),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, reportPath: path.relative(root, reportPath).replaceAll("\\", "/") }, null, 2));
}

async function generateCozePptxDirectly(project, sourceArtifact) {
  currentStage = "coze:generate";
  const config = readCozeConfig();
  const result = config.localPptxPath
    ? readLocalCozePptx(config.localPptxPath)
    : await generateRemoteCozePptx(config, buildCozePrompt(project, sourceArtifact));
  const pptxBuffer = result.buffer;
  const inspection = await inspectPptx(pptxBuffer);
  if (!inspection.hasPresentationXml) throw new Error("coze pptx missing presentation.xml");
  if (inspection.slideCount !== 10) throw new Error(`coze pptx expected 10 slides, got ${inspection.slideCount}`);
  if (inspection.containsFallbackText) throw new Error("coze pptx contains legacy fallback text");
  if (!inspection.containsEditableTextRuns) throw new Error("coze pptx does not contain editable text runs");

  const fileName = safePptxFileName(`${project.id}-${Date.now()}-${result.fileName}`);
  const localOutput = `.tmp/coze-ppt-artifacts/${fileName}`;
  const absolutePath = path.join(root, ".tmp", "coze-ppt-artifacts", fileName);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, pptxBuffer);
  return {
    fileName: result.fileName,
    localOutput,
    bytes: pptxBuffer.length,
    sha256: createHash("sha256").update(pptxBuffer).digest("hex"),
  };
}

async function generateRemoteCozePptx(config, prompt) {
  const result = config.botId ? await runCozeOpenApi(config, prompt) : await runCozePublishedEndpoint(config, prompt);
  return {
    fileName: result.fileName,
    buffer: await downloadExternalPptx(result.pptxUrl, config.timeoutMs),
  };
}

function readLocalCozePptx(localPptxPath) {
  currentStage = "coze:local-pptx-read";
  const absolutePath = path.isAbsolute(localPptxPath) ? localPptxPath : path.join(root, localPptxPath);
  return {
    fileName: path.basename(absolutePath),
    buffer: readFileSync(absolutePath),
  };
}

function readCozeConfig() {
  const token = process.env.COZE_API_TOKEN?.trim();
  const botId = process.env.COZE_PPT_BOT_ID?.trim();
  const runUrl = process.env.COZE_PPT_RUN_URL?.trim();
  if (!token || (!botId && !runUrl)) throw new Error("missing Coze config");
  return {
    token,
    botId,
    runUrl,
    localPptxPath: process.env.M59_COZE_LOCAL_PPTX_PATH?.trim(),
    apiBase: (process.env.COZE_API_BASE || "https://api.coze.cn").replace(/\/$/, ""),
    timeoutMs: Number.parseInt(process.env.COZE_PPT_SMOKE_TIMEOUT_MS || "360000", 10),
    pollIntervalMs: Number.parseInt(process.env.COZE_PPT_POLL_INTERVAL_SECONDS || "1", 10) * 1000,
    maxPollAttempts: Number.parseInt(process.env.COZE_PPT_MAX_POLL_ATTEMPTS || "300", 10),
  };
}

function buildCozePrompt(project, sourceArtifact) {
  return [
    "请基于下面这份逐页四层 PPT 设计稿生成一份小学数学 PPTX。",
    "必须生成 10 页，不能只生成封面或说明页。",
    `课题：${project.lessonTopic || "百分数的认识"}`,
    `年级：${project.grade || "五年级"}`,
    `学科：${project.subject || "数学"}`,
    "页数：10 页。",
    "硬性要求：每一页都必须落实设计稿中的底图、元素、文字、排版四层；必须生成可编辑 PPTX；不要返回 Markdown；不要把设计稿改写成说明文档。",
    "输出只返回 JSON，字段必须包含 status、pptx_url、file_name。",
    "当前逐页四层 PPT 设计稿：",
    sourceArtifact.markdownContent,
  ].join("\n");
}

async function runCozePublishedEndpoint(config, prompt) {
  currentStage = "coze:run-submit";
  const response = await fetch(config.runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-deadline-sec": "300",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`coze run http ${response.status}`);
  return extractCozePptResult(await response.json());
}

async function runCozeOpenApi(config, prompt) {
  currentStage = "coze:openapi-submit";
  const submitResponse = await fetch(`${config.apiBase}/v3/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      bot_id: config.botId,
      user_id: "shanhai-m59-real-pptx",
      stream: false,
      auto_save_history: true,
      additional_messages: [{ role: "user", type: "question", content_type: "text", content: prompt }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!submitResponse.ok) throw new Error(`coze openapi submit http ${submitResponse.status}`);
  const submitted = await submitResponse.json();
  const conversationId = readStringPath(submitted, ["data", "conversation_id"]);
  const chatId = readStringPath(submitted, ["data", "id"]);
  if (!conversationId || !chatId) throw new Error("coze openapi missing ids");

  for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    currentStage = "coze:openapi-retrieve";
    const retrieveResponse = await fetch(`${config.apiBase}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!retrieveResponse.ok) throw new Error(`coze openapi retrieve http ${retrieveResponse.status}`);
    const retrieved = await retrieveResponse.json();
    const status = readStringPath(retrieved, ["data", "status"]);
    if (status === "completed") break;
    if (status === "failed" || status === "canceled") throw new Error(`coze openapi ${status}`);
    if (attempt === config.maxPollAttempts - 1) throw new Error("coze openapi timeout");
  }

  currentStage = "coze:openapi-messages";
  const messagesResponse = await fetch(`${config.apiBase}/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!messagesResponse.ok) throw new Error(`coze openapi messages http ${messagesResponse.status}`);
  return extractCozePptResult(await messagesResponse.json());
}

function extractCozePptResult(payload) {
  const content = findAnswerContent(payload);
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed = JSON.parse(fenced ? fenced[1].trim() : trimmed);
  const pptxUrl = parsed.pptx_url || parsed.pptxUrl || parsed.download_url || parsed.downloadUrl;
  if (!pptxUrl || typeof pptxUrl !== "string") throw new Error("missing pptx url from Coze answer");
  return { pptxUrl, fileName: safePptxFileName(parsed.file_name || parsed.fileName || "coze-ppt-artifact.pptx") };
}

function findAnswerContent(payload) {
  const data = payload?.data;
  const messages = Array.isArray(payload?.messages) ? payload.messages : Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
  const answerMessages = messages.filter((message) => message?.type === "answer");
  for (const message of [...(answerMessages.length ? answerMessages : messages)].reverse()) {
    if (typeof message?.content === "string" && message.content.trim()) return message.content;
  }
  if (typeof payload?.content === "string") return payload.content;
  if (typeof payload?.output === "string") return payload.output;
  throw new Error("missing Coze answer content");
}

function readStringPath(value, pathSegments) {
  let cursor = value;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = cursor[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : null;
}

async function downloadExternalPptx(url, timeoutMs) {
  currentStage = "coze:pptx-download";
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const safeUrl = safeUrlSummary(url);
    throw new Error(`pptx download http ${response.status}; host=${safeUrl.host}; pathname=${safeUrl.pathname}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeUrlSummary(value) {
  try {
    const url = new URL(value);
    return { host: url.host, pathname: url.pathname.slice(0, 80) };
  } catch {
    return { host: "invalid", pathname: "invalid" };
  }
}

function safePptxFileName(value) {
  const cleaned = String(value).replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").trim();
  return cleaned.toLowerCase().endsWith(".pptx") ? cleaned : `${cleaned || "coze-ppt"}.pptx`;
}

try {
  await main();
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        stage: currentStage,
        message: error instanceof Error ? error.message : "M59 real Coze PPTX check failed",
        cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
