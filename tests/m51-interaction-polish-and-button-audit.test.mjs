import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ProjectSidebar provides a real searchable project input", () => {
  const source = readSource("src/components/layout/ProjectSidebar.tsx");

  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(""\)/);
  assert.match(source, /placeholder="搜索课题"/);
  assert.match(source, /value=\{searchQuery\}/);
  assert.match(source, /onChange=\{\(event\) => setSearchQuery\(event\.target\.value\)\}/);
  assert.match(source, /filteredProjects/);
  assert.match(source, /project\.title|project\.currentStep|project\.meta/);
  assert.match(source, /没有找到匹配项目/);
});

test("ChatTranscript inline artifacts can expand and use the generated logo asset", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /data-inline-artifact-toggle/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /data-inline-artifact-expanded/);
  assert.match(source, /展开查看/);
  assert.match(source, /收起/);
  assert.match(source, /\/brand\/shanhai-ai-logo-256\.png/);
  assert.equal(existsSync(path.join(root, "public/brand/shanhai-ai-logo-256.png")), true);
});

test("Artifact side panel disables width animation while dragging", () => {
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const handleSource = readSource("src/components/artifacts/ResizableHandle.tsx");

  assert.doesNotMatch(sidePanelSource, /transition-\[width\]/);
  assert.match(sidePanelSource, /const \[width, setWidth\] = useState\(360\)/);
  assert.match(sidePanelSource, /onChange=\{setWidth\}/);
  assert.match(handleSource, /onPointerDown=\{startResize\}/);
  assert.match(handleSource, /onMouseDown=\{startResize\}/);
  assert.match(handleSource, /onResizeStart\?: \(\) => void/);
  assert.match(handleSource, /onResizeEnd\?: \(\) => void/);
  assert.match(handleSource, /onResizeStart\?\.\(\)/);
  assert.match(handleSource, /onResizeEnd\?\.\(\)/);
});

test("Conversation layout compresses when the artifact side panel is open", () => {
  const mediaSource = readSource("src/components/layout/MediaWorkbench.tsx");
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const topbarSource = readSource("src/components/conversation/WorkbenchTopbar.tsx");
  const stageSource = readSource("src/components/conversation/StageProgress.tsx");

  assert.match(mediaSource, /compact=\{controller\.sidePanelOpen\}/);
  assert.match(conversationSource, /compact: boolean/);
  assert.match(conversationSource, /<WorkbenchTopbar[\s\S]*compact=\{compact\}/);
  assert.match(conversationSource, /<StageProgress[\s\S]*compact=\{compact\}/);
  assert.match(topbarSource, /compact = false/);
  assert.match(topbarSource, /data-workbench-topbar-compact/);
  assert.match(stageSource, /compact = false/);
  assert.match(stageSource, /data-stage-progress-compact/);
});

test("Unavailable sidebar and topbar buttons are not fake enabled controls", () => {
  const sidebarSource = readSource("src/components/layout/ProjectSidebar.tsx");
  const topbarSource = readSource("src/components/conversation/WorkbenchTopbar.tsx");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");

  assert.match(sidebarSource, /disabled[\s\S]*回收站/);
  assert.match(sidebarSource, /title="回收站稍后开放"/);
  assert.match(topbarSource, /disabled[\s\S]*协作/);
  assert.match(topbarSource, /title="协作稍后开放"/);
  assert.match(topbarSource, /aria-label=\{savedLabel\}/);
  assert.doesNotMatch(topbarSource, /<Button[\s\S]*\{savedLabel\}[\s\S]*<\/Button>/);
  assert.match(composerSource, /aria-label="重新生成"[\s\S]*title="请在产物详情中调整后重做"[\s\S]*disabled/);
  assert.match(detailSource, /完整缩略图预览稍后开放/);
  assert.doesNotMatch(detailSource, /<button[\s\S]*来源对话[\s\S]*<\/button>/);
});
