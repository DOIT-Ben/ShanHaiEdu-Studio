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
  const submitStart = source.indexOf("async function submitConversationMessage(");
  const submitEnd = source.indexOf("async function sendPrompt()", submitStart);
  const submitSource = source.slice(submitStart, submitEnd);

  assert.doesNotMatch(submitSource, /if \(!activeProjectId\) \{\s*flashComposerNotice\("请先选择或新建一个项目。"\);\s*return;\s*\}/);
  assert.match(submitSource, /let targetProjectId = activeProjectId;/);
  assert.match(submitSource, /dataSource\.createProject\(\)/);
  assert.match(submitSource, /const sendOptions: WorkbenchSendMessageOptions = \{/);
  assert.match(submitSource, /const messageSignature = buildClientMessageSignature\(targetProjectId, body, submittedReference, confirmationActionId, xiaokuResponseStyle, artifactRefs\)/);
  assert.match(submitSource, /idempotencyKey: getRetrySafeMessageIdempotencyKey\(messageIdempotencyRef, messageSignature\)/);
  assert.match(submitSource, /confirmedActionId: confirmationActionId/);
  assert.match(submitSource, /responseStyle: xiaokuResponseStyle/);
  assert.match(submitSource, /dataSource\.submitConversationMessage\(targetProjectId, \{/);
});

test("Workbench quick replies preserve pending HumanGate action ids until send", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useWorkbenchController.ts"), "utf8");
  const threadSource = readFileSync(path.join(root, "src", "components", "conversation", "assistant-ui", "ShanHaiThread.tsx"), "utf8");
  const workbenchSource = readFileSync(path.join(root, "src", "components", "conversation", "ConversationWorkbench.tsx"), "utf8");
  const suggestionsSource = readFileSync(path.join(root, "src", "components", "conversation", "messages", "QuickReplySuggestions.tsx"), "utf8");
  const selectQuickReplyStart = source.indexOf("function selectQuickReply");
  const selectQuickReplyEnd = source.indexOf("function showRecovery", selectQuickReplyStart);
  const selectQuickReplySource = source.slice(selectQuickReplyStart, selectQuickReplyEnd);

  assert.match(source, /const \[pendingConfirmationActionId, setPendingConfirmationActionId\] = useState<string \| null>\(null\);/);
  assert.match(source, /function selectQuickReply\(value: string, actionId\?: string\)/);
  assert.match(selectQuickReplySource, /setPendingConfirmationActionId\(actionId\?\.trim\(\) \|\| null\);[\s\S]*setInput\(value\);/);
  assert.doesNotMatch(selectQuickReplySource, /updateInput\(/);
  assert.match(threadSource, /onChange=\{\(event\) => onComposerInputChange\(event\.currentTarget\.value\)\}/);
  assert.match(workbenchSource, /onComposerInputChange=\{onInputChange\}/);
  assert.match(suggestionsSource, /onClick=\{\(\) => onSelect\?\.\(choice\.prompt, choice\.actionId\)\}/);
});

test("Workbench invalidates a pending HumanGate action when composer context changes", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useWorkbenchController.ts"), "utf8");

  for (const [startMarker, endMarker] of [
    ["const clearActiveProject", "const applySnapshotState"],
    ["function selectProject", "async function createProject"],
    ["async function createProject", "function openSidePanel"],
    ["function attachComposerFile", "function clearComposerReference"],
    ["function clearComposerReference", "async function setMessageReaction"],
  ]) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.match(source.slice(start, end), /setPendingConfirmationActionId\(null\)/, `${startMarker} must invalidate the pending action`);
  }

  assert.match(source, /function updateInput\(value: string\) \{[\s\S]*setPendingConfirmationActionId\(null\);[\s\S]*setInput\(value\);[\s\S]*\}/);
});

test("Workbench real asset buttons send server-issued HumanGate action ids", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useWorkbenchController.ts"), "utf8");
  const generateStart = source.indexOf("async function generateRealAsset");
  const generateEnd = source.indexOf("async function sendPrompt()", generateStart);
  const generateSource = source.slice(generateStart, generateEnd);

  assert.match(generateSource, /if \(!action\?\.actionId\) \{/);
  assert.match(generateSource, /dataSource\.generateRealAsset\(activeProjectId, item\.artifactId, assetKind, \{ confirmedActionId: action\.actionId \}\)/);
});
