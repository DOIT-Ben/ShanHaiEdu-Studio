import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("message route asks for teacher confirmation before generating requirement artifacts", () => {
  const source = readSource("src/app/api/workbench/projects/[projectId]/messages/route.ts");

  assert.match(source, /isTeacherConfirmation/);
  assert.match(source, /formatRequirementConfirmation/);
  assert.match(source, /备课任务确认/);
  assert.match(source, /if \(!isTeacherConfirmation\(teacherContent\)\)/);
  assert.match(source, /runtime\.run/);
  assert.match(source, /saveArtifact/);

  const confirmationBranch = source.slice(source.indexOf("if (!isTeacherConfirmation(teacherContent))"));
  assert.match(confirmationBranch, /return NextResponse\.json\(\{ message, assistantMessage \}/);
  assert.doesNotMatch(confirmationBranch.split(/const result = await runtime\.run/)[0], /saveArtifact/);
});

test("conversation inline artifact is a teacher-facing result card without backend labels", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /TeacherArtifactCard/);
  assert.match(source, /data-teacher-artifact-card/);
  assert.match(source, /展开查看/);
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
});
