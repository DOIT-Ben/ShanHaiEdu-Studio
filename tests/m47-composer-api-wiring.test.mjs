import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

test("PromptComposer paperclip is wired to a real file input instead of a decorative button", () => {
  const source = readFileSync(path.join(root, "src", "components", "conversation", "PromptComposer.tsx"), "utf8");

  assert.match(source, /onAttachFile/);
  assert.match(source, /type="file"/);
  assert.match(source, /fileInputRef/);
  assert.match(source, /onChange=\{handleFileChange\}/);
  assert.match(source, /onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}/);
});

test("Workbench controller creates a project before sending the first prompt when none is selected", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useWorkbenchController.ts"), "utf8");
  const sendPromptStart = source.indexOf("async function sendPrompt()");
  const sendPromptEnd = source.indexOf("function showRecovery()", sendPromptStart);
  const sendPromptSource = source.slice(sendPromptStart, sendPromptEnd);

  assert.doesNotMatch(sendPromptSource, /if \(!activeProjectId\) \{\s*flashComposerNotice\("请先选择或新建一个项目。"\);\s*return;\s*\}/);
  assert.match(sendPromptSource, /let targetProjectId = activeProjectId;/);
  assert.match(sendPromptSource, /dataSource\.createProject\(\)/);
  assert.match(sendPromptSource, /dataSource\.sendMessage\(targetProjectId, body, reference\)/);
});
