import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("MediaWorkbench restores the compact desktop artifact rail while keeping the drawer", () => {
  const source = readSource("src/components/layout/MediaWorkbench.tsx");

  assert.match(source, /hidden\s+w-16\s+shrink-0\s+lg:block/);
  assert.match(source, /<ArtifactRail[\s\S]*onOpenGroup=\{openArtifactDrawer\}/);
  assert.match(source, /<Sheet open=\{controller\.railOpen\} onOpenChange=\{controller\.setRailOpen\}/);
  assert.match(source, /variant="drawer"/);
});

test("Conversation transcript can show generated artifacts inline", () => {
  const workbenchSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const transcriptSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const rendererSource = readSource("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(workbenchSource, /artifacts: ArtifactItem\[\]/);
  assert.match(workbenchSource, /<ShanHaiAssistantRuntime[\s\S]*artifacts=\{artifacts\}/);
  assert.match(transcriptSource, /artifacts: ArtifactItem\[\]/);
  assert.match(transcriptSource, /data-teacher-artifact-card/);
  assert.match(rendererSource, /shanhai\.artifact-ref/);
});

test("MarkdownPreview renders markdown structure instead of plain text blobs", () => {
  const source = readSource("src/components/artifacts/MarkdownPreview.tsx");

  assert.match(source, /function renderMarkdownBlocks/);
  assert.match(source, /block\.type === "heading"/);
  assert.match(source, /block\.type === "list"/);
  assert.match(source, /block\.type === "paragraph"/);
  assert.match(source, /startsWith\("#"\)/);
  assert.match(source, /startsWith\("- "\)/);
});

test("Artifact detail surfaces reuse MarkdownPreview and share the AI visual tone", () => {
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const railSource = readSource("src/components/artifacts/ArtifactRail.tsx");

  assert.match(detailSource, /import \{ MarkdownPreview \}/);
  assert.match(detailSource, /<MarkdownPreview item=\{item\}/);
  assert.doesNotMatch(detailSource, /Object\.entries\(item\.content\)\.map/);
  assert.match(detailSource, /#e3ece9|#fcfdfd|#eef5f3/);
  assert.match(sidePanelSource, /#e3ece9|#fcfdfd|#eef5f3/);
  assert.match(railSource, /#e3ece9|#fcfdfd|#eef5f3/);
});
