import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("conversation workbench does not mount the static prototype generation panel", () => {
  const source = readFileSync(path.join(root, "src", "components", "conversation", "ConversationWorkbench.tsx"), "utf8");

  assert.equal(source.includes("GenerationPanel"), false);
  assert.equal(source.includes("PPT 页面生成中"), false);
  assert.equal(source.includes("8 / 12"), false);
});

test("workbench topbar uses the active project instead of prototype literals", () => {
  const topbarSource = readFileSync(path.join(root, "src", "components", "conversation", "WorkbenchTopbar.tsx"), "utf8");
  const conversationSource = readFileSync(path.join(root, "src", "components", "conversation", "ConversationWorkbench.tsx"), "utf8");
  const transcriptSource = readFileSync(path.join(root, "src", "components", "conversation", "ChatTranscript.tsx"), "utf8");

  assert.equal(topbarSource.includes("表内乘法（一）"), false);
  assert.equal(topbarSource.includes("已保存 10:24"), false);
  assert.equal(transcriptSource.includes(">10:24<"), false);
  assert.match(conversationSource, /<WorkbenchTopbar[\s\S]*?project=\{project\}/);
});
