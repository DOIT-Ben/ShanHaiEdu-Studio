import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readOptionalSource(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

test("conversation inline artifact is a teacher-facing result card without backend labels", () => {
  const source = readSource("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(source, /ArtifactRefPart/);
  assert.match(source, /data-message-part="artifact-ref"/);
  assert.match(source, /打开成果/);
  assert.doesNotMatch(source, /GeneratedArtifactInline/);
  assert.doesNotMatch(source, /生成内容已进入产物链/);
  assert.doesNotMatch(source, /上游来源/);
  assert.doesNotMatch(source, /line-clamp-4/);
});

test("artifact reading preview keeps markdown rendering but removes backend section titles", () => {
  const source = readSource("src/components/artifacts/MarkdownPreview.tsx");

  assert.match(source, /function renderMarkdownBlocks/);
  assert.match(source, /MarkdownBlockView/);
  assert.match(source, /readableContentEntries/);
  assert.doesNotMatch(source, /关键字段/);
  assert.doesNotMatch(source, /正文预览/);
  assert.doesNotMatch(source, /上游来源/);
  assert.doesNotMatch(source, />\{title\}<|<h3[^>]*>\{title\}<\/h3>/);
});

test("artifact detail and side panel use reading language instead of engineering surfaces", () => {
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const nodeCardSource = readSource("src/components/artifacts/ArtifactNodeCard.tsx");
  const resizableSource = readSource("src/components/artifacts/ResizableHandle.tsx");

  assert.match(detailSource, /成果阅读|备课成果/);
  assert.match(sidePanelSource, /成果阅读|备课成果/);
  assert.doesNotMatch(sidePanelSource, /产物预览/);
  assert.doesNotMatch(nodeCardSource, /提示词/);
  assert.doesNotMatch(resizableSource, /产物预览/);

  for (const forbidden of ["生成来源", "页面脚本", "提示词", "缩略预览", "上游产物"]) {
    assert.doesNotMatch(detailSource, new RegExp(forbidden));
  }
});

test("workbench mappers do not expose Markdown or status as visible artifact labels", () => {
  const source = readSource("src/lib/workbench-mappers.ts");

  assert.match(source, /content\.正文|content\["正文"\]|content\["备课内容"\]/);
  assert.doesNotMatch(source, /content\.Markdown|content\["Markdown"\]/);
  assert.doesNotMatch(source, /label: "状态"/);
  assert.doesNotMatch(source, /content: \{ 说明: "还没有生成内容。"\ }/);
  assert.match(source, /capability.*id/);
  assert.match(source, /runtime.*kind/);
  assert.match(source, /provider.*status/);
});

test("assistant-ui thread wraps long continuous teacher-facing text on narrow screens", () => {
  const source = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const partSource = readSource("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(source, /break-words rounded-2xl bg/);
  assert.match(source, /whitespace-pre-wrap/);
  assert.match(source, /space-y-3 break-words/);
  assert.match(partSource, /break-words text-sm/);
});

test("assistant feedback actions persist a message-specific reaction", () => {
  const source = readOptionalSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(source, /onOpenFeedback/);
  assert.match(source, /onSetReaction/);
  assert.match(source, /reaction === "helpful"/);
  assert.match(source, /reaction === "unhelpful"/);
  assert.match(source, /const nextReaction = previousReaction === value \? null : value/);
  assert.match(source, /await onSetReaction\(messageId, nextReaction\)/);
  assert.match(source, /if \(nextReaction\) onOpenFeedback/);
  assert.doesNotMatch(source, /反馈入口暂未开放/);

  for (const forbidden of ["backend", "API", "debug", "provider", "schema", "manifest", "node_id", "storage"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }
});

test("generating indicator keeps waiting text understandable for teachers", () => {
  const generatingSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");

  assert.match(generatingSource, /aria-label="小酷正在回复"/);
  assert.match(generatingSource, /已运行 \{elapsedSeconds\} 秒/);
  assert.match(generatingSource, /getGeneratingLabel/);
  assert.doesNotMatch(generatingSource, /正在理解|正在选择|正在组织/);
  assert.doesNotMatch(generatingSource, /debug|provider|schema|manifest|node_id|storage/i);
});

test("persisted plan parts use teacher-facing step labels without backend fields", () => {
  const source = readSource("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(source, /function PlanPart/);
  assert.match(source, /data-message-part="plan"/);
  assert.match(source, /StatusLabel status=\{step\.status\}/);
  assert.doesNotMatch(source, /capabilityId|artifactKind|schema|manifest|provider|node_id|storage|API|debug|local path/i);
});

test("composer auto resize uses measured text height before hiding overflow", () => {
  const source = readSource("src/components/conversation/composer/useAutoResizeTextarea.ts");

  assert.match(source, /element\.scrollHeight/);
  assert.match(source, /Math\.min\(maxHeight, measuredHeight\)/);
  assert.match(source, /measuredHeight > maxHeight \? "auto" : "hidden"/);
});
