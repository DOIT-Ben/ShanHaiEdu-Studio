import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const sourcePath = path.join(root, "src", "server", "pptx", "artifact-pptx.ts");

const pptArtifact = {
  key: "ppt-artifact-v1",
  artifactId: "ppt-artifact-v1",
  nodeKey: "ppt_draft",
  kind: "ppt_draft",
  title: "PPT 大纲与逐页脚本",
  summary: "已规划页面结构、每页教学目标、课堂活动和视觉需求。",
  updatedAt: "07-07 12:30",
  sourceTitles: ["公开课教案"],
  previewFields: [
    { label: "页面结构", value: "12 页左右" },
    { label: "主视觉需求", value: "生活化数学场景" },
  ],
  content: {
    页面结构: ["第 1 页：课题与课堂情境。", "第 2-3 页：导入问题与学生观察。"],
    逐页脚本原则: "每页只服务一个教学动作。",
    主视觉需求: "主视觉使用真实课堂可理解的生活情境。",
  },
};

test("builds a real PPTX download package for a PPT outline artifact", async () => {
  const { buildArtifactPptxDownload } = loadArtifactPptxModule();
  const download = await buildArtifactPptxDownload(pptArtifact);

  assert.match(download.filename, /^shanhai-ppt-artifact-v1-.+\.pptx$/);
  assert.doesNotMatch(download.filename, /[<>:"/\\|?*\u0000-\u001F]/);
  assert.equal(Buffer.isBuffer(download.buffer), true);
  assert.equal(download.buffer.subarray(0, 2).toString("utf8"), "PK");

  const entries = unzipEntries(download.buffer);
  assert.equal(entries.has("[Content_Types].xml"), true);
  assert.equal(entries.has("ppt/presentation.xml"), true);
  assert.equal(entries.has("ppt/slides/slide1.xml"), true);

  const slideText = [...entries.entries()]
    .filter(([name]) => name.startsWith("ppt/slides/slide"))
    .map(([, value]) => value)
    .join("\n");
  assert.match(slideText, /PPT 大纲与逐页脚本/);
  assert.match(slideText, /页面结构/);
  assert.match(slideText, /逐页脚本原则/);
  assert.match(slideText, /主视觉需求/);
  assert.doesNotMatch(slideText, /视频成片已生成|图片文件已生成/);
});

test("refuses to build PPTX for non-PPT artifacts", async () => {
  const { buildArtifactPptxDownload } = loadArtifactPptxModule();
  await assert.rejects(
    () => buildArtifactPptxDownload({ ...pptArtifact, nodeKey: "final_delivery", kind: "final_delivery" }),
    /Only PPT outline artifacts can be exported as PPTX/,
  );
});

function loadArtifactPptxModule() {
  assert.equal(existsSync(sourcePath), true, "src/server/pptx/artifact-pptx.ts should exist");
  const ts = require("typescript");
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require,
    Buffer,
    console,
  });
  return module.exports;
}

function unzipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    const dataStart = offset + 30 + fileNameLength + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.subarray(dataStart, dataEnd);

    if (!fileName.endsWith("/")) {
      let content;
      if (compressionMethod === 0) {
        content = compressed;
      } else if (compressionMethod === 8) {
        content = inflateRawSync(compressed, { finishFlush: 2 });
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }
      assert.equal(content.length, uncompressedSize);
      entries.set(fileName, content.toString("utf8"));
    }

    offset = dataEnd;
  }
  return entries;
}
