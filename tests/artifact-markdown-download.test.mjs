import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const sourcePath = path.join(root, "src", "lib", "artifact-markdown-download.ts");

const finalDeliveryArtifact = {
  key: "final-delivery",
  title: "最终交付清单",
  summary: "汇总本节公开课已形成材料和待确认事项。",
  updatedAt: "07-07 12:30",
  sourceTitles: ["需求规格说明书", "公开课教案", "PPT 大纲与逐页脚本", "导入视频方案"],
  previewFields: [
    { label: "已形成材料", value: "需求规格、教案、PPT 大纲、导入视频方案" },
    { label: "待确认事项", value: "PPTX、图片文件和视频成片如果未真实生成，交付时必须标记为待生成。" },
  ],
  content: {
    已形成材料: ["需求规格说明书", "公开课教案", "PPT 大纲与逐页脚本", "导入视频方案"],
    待确认事项: "PPTX、图片文件和视频成片如果未真实生成，交付时必须标记为待生成。",
  },
};

test("builds a safe Markdown download for the final delivery artifact", () => {
  const { buildArtifactMarkdownDownload } = loadArtifactMarkdownDownloadModule();
  const download = buildArtifactMarkdownDownload(finalDeliveryArtifact);

  assert.match(download.filename, /^shanhai-final-delivery-.+\.md$/);
  assert.doesNotMatch(download.filename, /[<>:"/\\|?*\u0000-\u001F]/);
  assert.match(download.markdown, /^# 最终交付清单/m);
  assert.match(download.markdown, /汇总本节公开课已形成材料和待确认事项。/);
  assert.match(download.markdown, /## 关键字段/);
  assert.match(download.markdown, /- 已形成材料：需求规格、教案、PPT 大纲、导入视频方案/);
  assert.match(download.markdown, /## 正文/);
  assert.match(download.markdown, /### 已形成材料/);
  assert.match(download.markdown, /- 需求规格说明书/);
  assert.match(download.markdown, /### 待确认事项/);
  assert.match(download.markdown, /## 上游来源/);
  assert.match(download.markdown, /需求规格说明书、公开课教案、PPT 大纲与逐页脚本、导入视频方案/);
  assert.match(download.markdown, /更新时间：07-07 12:30/);
  assert.doesNotMatch(download.markdown, /PPTX 文件已生成|图片文件已生成|视频成片已生成/);
});

function loadArtifactMarkdownDownloadModule() {
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
    require: () => {
      throw new Error("Unexpected import in artifact markdown download test");
    },
    Date,
  });
  return module.exports;
}
