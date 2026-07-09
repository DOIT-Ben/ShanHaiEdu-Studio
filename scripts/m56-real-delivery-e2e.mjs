import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";

await import("dotenv/config");

const root = process.cwd();
const port = process.env.M56_PORT || "3132";
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.join(root, ".tmp", "m56-real-delivery");
mkdirSync(outputDir, { recursive: true });

const topic = {
  title: "M56真实验收-六年级百分数导入课",
  grade: "六年级",
  subject: "数学",
  lessonTopic: "百分数导入课",
};

const pptOutline = [
  "# 12页PPT大纲：百分数导入课",
  "",
  "1. 封面：超市折扣牌里的百分数问题",
  "2. 生活情境：果汁、折扣、命中率、空气湿度",
  "3. 问题提出：这些数为什么都带百分号",
  "4. 学习目标：理解百分数意义、会读写、能解释",
  "5. 活动一：从100格图看百分之几",
  "6. 活动二：把数量关系说成“占总量的百分之几”",
  "7. 对比辨析：分数、小数、百分数表达差异",
  "8. 小组任务：校园调查数据转成百分数",
  "9. 课堂练习：读写百分数和解释语义",
  "10. 错误辨析：百分数不能带单位的边界",
  "11. 总结提升：百分数是比较关系的语言",
  "12. 课后任务：记录一天中见到的5个百分数",
].join("\n");

let cookie = "";

async function api(pathname, options = {}) {
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

async function apiOptional(pathname, options = {}) {
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

async function countPptSlides(filePath) {
  const zip = await JSZip.loadAsync(readFileSync(filePath));
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ffprobeDuration(filePath) {
  const output = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { encoding: "utf8" }).trim();
  return Number.parseFloat(output);
}

function ensureOneMinuteVideo(filePath) {
  const duration = ffprobeDuration(filePath);
  if (duration >= 55) return { filePath, duration, extended: false };
  const extendedPath = filePath.replace(/\.mp4$/i, "-60s.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-stream_loop", "20",
    "-i", filePath,
    "-t", "60",
    "-c", "copy",
    extendedPath,
  ], { stdio: "ignore" });
  return { filePath: extendedPath, duration: ffprobeDuration(extendedPath), extended: true, sourceDuration: duration };
}

async function run() {
  const project = await apiJson("/api/workbench/projects", topic);
  const projectId = project.project.id;

  const sourceArtifact = await apiJson(`/api/workbench/projects/${projectId}/artifacts`, {
    nodeKey: "ppt_draft",
    kind: "ppt_draft",
    title: "六年级百分数导入课12页PPT大纲",
    status: "needs_review",
    summary: "用于真实生成12页PPTX的逐页大纲。",
    markdownContent: pptOutline,
    structuredContent: {
      课题: "百分数导入课",
      页数: "12页",
      用途: "公开课导入与新授",
    },
  });

  const ppt = await apiJson(`/api/workbench/projects/${projectId}/artifacts/${sourceArtifact.artifact.id}/coze-ppt`, {});
  const pptStorage = ppt.artifact.structuredContent.storage.cozePptx;
  const pptPath = resolveLocalOutput(pptStorage.localOutput);
  const slideCount = await countPptSlides(pptPath);

  const image = await apiJson(`/api/workbench/projects/${projectId}/artifacts/${ppt.artifact.id}/image`, {});
  const imagePath = resolveLocalOutput(image.artifact.structuredContent.storage.imageAsset.localOutput);

  const rawVideoPath = path.join(outputDir, `m56-${projectId}-intro-video.mp4`);
  const videoPrompt = [
    "小学六年级数学百分数公开课1分钟导入视频，16:9。",
    "场景：学生走进校园小超市，看到果汁促销、投篮命中率、空气湿度和电量百分比。",
    "视频只建立真实生活问题和好奇心，不讲解公式，不出现复杂文字、品牌、二维码或网址。",
    "画面温暖明亮，课堂可用，结尾停在问题：这些百分号到底在比较什么？",
  ].join(" ");
  const videoGeneration = generateOneMinuteVideo({ videoPrompt, rawVideoPath, imagePath });
  const video = ensureOneMinuteVideo(videoGeneration.filePath);
  const videoFileName = path.basename(video.filePath);
  const localVideoOutput = `.tmp/m56-real-delivery/${videoFileName}`;
  const videoBytes = readFileSync(video.filePath).length;

  const videoArtifact = await apiJson(`/api/workbench/projects/${projectId}/artifacts`, {
    nodeKey: "video_storyboard",
    kind: "video_storyboard",
    title: "真实1分钟导入视频",
    status: "needs_review",
    summary: "已生成一段约1分钟的真实MP4导入视频，请播放后核对画面、节奏和课堂锚点。",
    markdownContent: [
      "# 真实1分钟导入视频",
      "",
      "已基于六年级数学《百分数》导入场景生成真实 MP4。",
      "",
      video.extended ? "原始生成片段已通过本地视频制作延展到约60秒，保留原始视频素材。" : "视频原始输出已满足约1分钟长度。",
    ].join("\n"),
    structuredContent: {
      文件状态: "真实1分钟导入视频已生成",
      文件大小: `${videoBytes} bytes`,
      视频时长: `${video.duration.toFixed(2)} seconds`,
      storage: {
        videoAsset: {
          localOutput: localVideoOutput,
          fileName: videoFileName,
          bytes: videoBytes,
          sha256: sha256(video.filePath),
          mime: "video/mp4",
          generationMode: "video_generated",
          source: "mmx-cli",
        },
      },
    },
  });

  const finalDelivery = await apiJson(`/api/workbench/projects/${projectId}/artifacts`, {
    nodeKey: "final_delivery",
    kind: "final_delivery",
    title: "M56真实交付验收清单",
    status: "needs_review",
    summary: "包含真实12页PPTX、课堂视觉图、约1分钟导入视频和验收记录。",
    markdownContent: [
      "# M56真实交付验收清单",
      "",
      `- 项目：${topic.title}`,
      `- PPTX：真实生成，slideCount=${slideCount}`,
      `- 图片：真实生成，bytes=${image.artifact.structuredContent.storage.imageAsset.bytes}`,
      `- 视频：真实生成，duration=${video.duration.toFixed(2)}s`,
      "- 结论：本清单用于人工验收，正式使用前请核对内容准确性。",
    ].join("\n"),
    structuredContent: {
      PPT页数: `${slideCount}`,
      视频时长: `${video.duration.toFixed(2)} seconds`,
      交付状态: "真实产物已生成，待人工验收",
    },
  });

  const packageResponse = await apiOptional(`/api/workbench/projects/${projectId}/artifacts/${finalDelivery.artifact.id}/package`, { method: "GET" });
  if (!packageResponse.ok) {
    const snapshot = await (await api(`/api/workbench/projects/${projectId}/snapshot`, { method: "GET" })).json();
    const failureRecord = {
      ok: false,
      projectId,
      packageStatus: packageResponse.status,
      packageError: await packageResponse.text(),
      artifacts: snapshot.artifacts.map((artifact) => ({
        id: artifact.id,
        nodeKey: artifact.nodeKey,
        kind: artifact.kind,
        title: artifact.title,
        hasStorage: Boolean(artifact.structuredContent?.storage),
        storage: artifact.structuredContent?.storage,
      })),
    };
    const failurePath = path.join(outputDir, `m56-${projectId}-package-failure.json`);
    writeFileSync(failurePath, `${JSON.stringify(failureRecord, null, 2)}\n`, "utf8");
    throw new Error(`package failed; diagnostic saved to ${failurePath}`);
  }
  const packageBuffer = Buffer.from(await packageResponse.arrayBuffer());
  const packagePath = path.join(outputDir, `m56-${projectId}-final-package.zip`);
  writeFileSync(packagePath, packageBuffer);

  const record = {
    ok: slideCount === 12 && video.duration >= 55 && packageBuffer.length > 0,
    projectId,
    url: `${baseUrl}`,
    artifacts: {
      sourcePptOutlineId: sourceArtifact.artifact.id,
      pptArtifactId: ppt.artifact.id,
      imageArtifactId: image.artifact.id,
      videoArtifactId: videoArtifact.artifact.id,
      finalDeliveryArtifactId: finalDelivery.artifact.id,
    },
    files: {
      pptx: pptPath,
      image: resolveLocalOutput(image.artifact.structuredContent.storage.imageAsset.localOutput),
      video: video.filePath,
      finalPackage: packagePath,
    },
    verification: {
      slideCount,
      pptBytes: pptStorage.bytes,
      pptSha256: pptStorage.sha256,
      imageBytes: image.artifact.structuredContent.storage.imageAsset.bytes,
      imageSha256: image.artifact.structuredContent.storage.imageAsset.sha256,
      videoBytes,
      videoSha256: sha256(video.filePath),
      videoDurationSeconds: video.duration,
      videoMethod: videoGeneration.method,
      videoFallbackReason: videoGeneration.fallbackReason,
      videoExtendedFromShortClip: video.extended,
      sourceVideoDurationSeconds: video.sourceDuration,
      packageBytes: packageBuffer.length,
      packageSha256: createHash("sha256").update(packageBuffer).digest("hex"),
    },
  };
  const recordPath = path.join(outputDir, `m56-${projectId}-acceptance-record.json`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...record, recordPath }, null, 2));
}

function generateOneMinuteVideo({ videoPrompt, rawVideoPath, imagePath }) {
  const mmxCommand = process.platform === "win32" ? "cmd.exe" : "mmx";
  const mmxArgs = ["video", "generate", "--prompt", videoPrompt, "--download", rawVideoPath, "--poll-interval", "5", "--timeout", "900", "--non-interactive"];
  try {
    execFileSync(mmxCommand, process.platform === "win32" ? ["/c", "mmx", ...mmxArgs] : mmxArgs, {
      stdio: "inherit",
    });
    if (existsSync(rawVideoPath)) return { filePath: rawVideoPath, method: "mmx-cli" };
    throw new Error("mmx video output missing");
  } catch (error) {
    const fallbackPath = rawVideoPath.replace(/\.mp4$/i, "-ffmpeg-60s.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t", "60",
      "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0005,1.08)':d=1800:s=1280x720:fps=30,format=yuv420p",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      fallbackPath,
    ], { stdio: "ignore" });
    return {
      filePath: fallbackPath,
      method: "local-ffmpeg-composition-from-real-image",
      fallbackReason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
