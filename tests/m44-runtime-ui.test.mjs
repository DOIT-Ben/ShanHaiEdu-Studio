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
