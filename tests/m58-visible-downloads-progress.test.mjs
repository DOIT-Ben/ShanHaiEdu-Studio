import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("M58 exposes one shared teacher-facing download action group across artifact surfaces", () => {
  const actionsPath = path.join(root, "src/components/artifacts/ArtifactDownloadActions.tsx");
  assert.equal(existsSync(actionsPath), true, "ArtifactDownloadActions.tsx should exist");

  const source = readSource("src/components/artifacts/ArtifactDownloadActions.tsx");
  assert.match(source, /useArtifactMarkdownDownload/);
  assert.match(source, /useArtifactPptxDownload/);
  assert.match(source, /useArtifactRealAssetDownload/);
  assert.match(source, /useFinalPackageDownload/);
  assert.match(source, /下载 Markdown/);
  assert.match(source, /downloadPptxLabel/);
  assert.match(source, /downloadRealAssetLabel/);
  assert.match(source, /downloadPackageLabel/);
});

test("M58 renders download actions in chat cards and full reading surfaces", () => {
  const chatSource = readSource("src/components/conversation/ChatTranscript.tsx");
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const previewSource = readSource("src/components/artifacts/ArtifactPreviewCard.tsx");
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");
  const mediaSource = readSource("src/components/layout/MediaWorkbench.tsx");
  const railSource = readSource("src/components/artifacts/ArtifactRail.tsx");

  assert.match(chatSource, /projectId: string/);
  assert.match(chatSource, /<ArtifactDownloadActions[\s\S]*variant="inline"/);
  assert.match(sidePanelSource, /projectId: string/);
  assert.match(sidePanelSource, /<ArtifactDownloadActions[\s\S]*variant="compact"/);
  assert.match(previewSource, /打开阅读/);
  assert.doesNotMatch(previewSource, /<ArtifactDownloadActions/);
  assert.match(detailSource, /<ArtifactDownloadActions[\s\S]*variant="default"/);
  assert.match(mediaSource, /projectId=\{controller\.activeProjectId\}/);
  assert.doesNotMatch(railSource, /projectId=\{projectId\}/);
});

test("M58 derives top progress from artifacts and execution feedback", () => {
  const { deriveWorkbenchStageIndex } = loadWorkbenchProgressModule();

  assert.equal(
    deriveWorkbenchStageIndex({
      project: { currentStep: "确定目标" },
      artifacts: [{ nodeKey: "lesson_plan", kind: "lesson_plan", status: "approved" }],
      executionFeedback: null,
    }),
    1,
  );

  assert.equal(
    deriveWorkbenchStageIndex({
      project: { currentStep: "教学设计" },
      artifacts: [{ nodeKey: "ppt_draft", kind: "ppt_draft", status: "approved" }],
      executionFeedback: null,
    }),
    2,
  );

  assert.equal(
    deriveWorkbenchStageIndex({
      project: { currentStep: "资源生成" },
      artifacts: [{ nodeKey: "final_delivery", kind: "final_delivery", status: "approved" }],
      executionFeedback: null,
    }),
    4,
  );

  assert.equal(
    deriveWorkbenchStageIndex({
      project: { currentStep: "确定目标" },
      artifacts: [],
      executionFeedback: { stageIndex: 3, label: "正在保存成果" },
    }),
    3,
  );
});

test("M58 shows teacher-readable execution feedback while sending", () => {
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const indicatorSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");

  assert.match(controllerSource, /executionFeedback/);
  assert.match(controllerSource, /正在理解你的备课要求/);
  assert.match(controllerSource, /正在组织教案、课件和素材任务/);
  assert.match(controllerSource, /正在保存本轮成果/);
  assert.match(conversationSource, /executionFeedback/);
  assert.match(conversationSource, /deriveWorkbenchStageIndex/);
  assert.match(indicatorSource, /label \?\? getTeacherGeneratingLabel\(state\)/);
});

function loadWorkbenchProgressModule() {
  const sourcePath = path.join(root, "src", "lib", "workbench-progress.ts");
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
      throw new Error("Unexpected import in workbench progress test");
    },
  });
  return module.exports;
}
