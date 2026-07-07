import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const sourcePath = path.join(root, "src", "server", "package", "artifact-package.ts");

const finalDeliveryArtifact = {
  id: "final-delivery-v1",
  key: "final-delivery-v1",
  nodeKey: "final_delivery",
  kind: "final_delivery",
  title: "最终交付清单",
  summary: "汇总本节公开课已形成材料和待确认事项。",
  markdownContent: [
    "# 最终交付清单",
    "",
    "## 已形成材料",
    "- 需求规格说明书",
    "- 公开课教案",
    "- PPT 大纲与逐页脚本",
    "- PPT 大纲可下载最小 PPTX 文件",
    "",
    "## 待确认事项",
    "- 图片文件、视频成片、动画和视觉精修仍待生成或完善。",
  ].join("\n"),
  updatedAt: "2026-07-07T13:40:00.000Z",
};

const pptxDownload = {
  filename: "shanhai-ppt-outline-20260707.pptx",
  buffer: Buffer.from("PK fake pptx payload"),
};

const videoDownload = {
  filename: "percentage-intro.mp4",
  buffer: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(24)]),
};

test("builds a real final material ZIP package", async () => {
  const { buildFinalMaterialPackageDownload } = loadArtifactPackageModule();
  const download = await buildFinalMaterialPackageDownload({
    finalDelivery: finalDeliveryArtifact,
    pptx: pptxDownload,
  });

  assert.match(download.filename, /^shanhai-final-delivery-v1-.+\.zip$/);
  assert.doesNotMatch(download.filename, /[<>:"/\\|?*\u0000-\u001F]/);
  assert.equal(Buffer.isBuffer(download.buffer), true);
  assert.equal(download.buffer.subarray(0, 2).toString("utf8"), "PK");

  const entries = unzipEntries(download.buffer);
  assert.equal(entries.has("README.md"), true);
  assert.equal(entries.has("final-delivery.md"), true);
  assert.equal(entries.has("ppt-outline.pptx"), true);

  const readme = entries.get("README.md").toString("utf8");
  const finalDelivery = entries.get("final-delivery.md").toString("utf8");
  const pptx = entries.get("ppt-outline.pptx");

  assert.match(readme, /本材料包包含最终交付清单和最小 PPTX 文件/);
  assert.match(readme, /图片文件、视频成片、动画和视觉精修仍待生成或完善/);
  assert.match(finalDelivery, /# 最终交付清单/);
  assert.match(finalDelivery, /PPT 大纲可下载最小 PPTX 文件/);
  assert.equal(pptx.subarray(0, 2).toString("utf8"), "PK");
  assert.doesNotMatch(`${readme}\n${finalDelivery}`, /PPTX 文件已生成|图片文件已生成|视频成片已生成/);
});

test("includes an existing intro video asset in the final material ZIP package", async () => {
  const { buildFinalMaterialPackageDownload } = loadArtifactPackageModule();
  const download = await buildFinalMaterialPackageDownload({
    finalDelivery: finalDeliveryArtifact,
    pptx: pptxDownload,
    video: videoDownload,
  });

  const entries = unzipEntries(download.buffer);
  assert.equal(entries.has("README.md"), true);
  assert.equal(entries.has("intro-video.mp4"), true);

  const readme = entries.get("README.md").toString("utf8");
  const video = entries.get("intro-video.mp4");

  assert.match(readme, /已包含导入视频文件/);
  assert.match(readme, /核对视频质量、节奏和课堂锚点/);
  assert.equal(video.equals(videoDownload.buffer), true);
  assert.equal(video.subarray(4, 8).toString("utf8"), "ftyp");
  assert.doesNotMatch(readme, /视频成片已生成/);
});

test("refuses to package non-final-delivery artifacts", async () => {
  const { buildFinalMaterialPackageDownload } = loadArtifactPackageModule();
  await assert.rejects(
    () =>
      buildFinalMaterialPackageDownload({
        finalDelivery: { ...finalDeliveryArtifact, nodeKey: "ppt_draft", kind: "ppt_draft" },
        pptx: pptxDownload,
      }),
    /Only final delivery artifacts can be exported as material packages/,
  );
});

function loadArtifactPackageModule() {
  assert.equal(existsSync(sourcePath), true, "src/server/package/artifact-package.ts should exist");
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
      entries.set(fileName, content);
    }

    offset = dataEnd;
  }
  return entries;
}
