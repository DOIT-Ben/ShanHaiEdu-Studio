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
  const submitSource = readFileSync(path.join(root, "src", "hooks", "workbench-composer-submission.ts"), "utf8");
  const projectSource = readFileSync(path.join(root, "src", "hooks", "useWorkbenchComposerController.ts"), "utf8");

  assert.doesNotMatch(submitSource, /请先选择或新建一个项目/);
  assert.match(submitSource, /let targetProjectId = context\.activeProjectId;/);
  assert.match(projectSource, /dataSource\.createProject\(\)/);
  assert.match(submitSource, /const sendOptions: WorkbenchSendMessageOptions = \{/);
  assert.match(submitSource, /const messageSignature = buildClientMessageSignature\(targetProjectId, body, submittedReference, confirmationActionId, context\.xiaokuResponseStyle, artifactRefs\)/);
  assert.match(submitSource, /idempotencyKey: getRetrySafeMessageIdempotencyKey\(context\.messageIdempotencyRef, messageSignature\)/);
  assert.match(submitSource, /confirmedActionId: confirmationActionId/);
  assert.match(submitSource, /responseStyle: context\.xiaokuResponseStyle/);
  assert.match(submitSource, /context\.dataSource\.submitConversationMessage\(targetProjectId, \{/);
});

test("Workbench quick replies preserve pending HumanGate action ids until send", () => {
  const source = readFileSync(path.join(root, "src", "hooks", "useWorkbenchComposerController.ts"), "utf8");
  const threadSource = readFileSync(path.join(root, "src", "components", "conversation", "assistant-ui", "ShanHaiThread.tsx"), "utf8");
  const workbenchSource = readFileSync(path.join(root, "src", "components", "conversation", "ConversationWorkbench.tsx"), "utf8");
  const suggestionsSource = readFileSync(path.join(root, "src", "components", "conversation", "messages", "QuickReplySuggestions.tsx"), "utf8");
  const selectQuickReplyStart = source.indexOf("const selectQuickReply");
  const selectQuickReplySource = source.slice(selectQuickReplyStart, source.indexOf("const sendPrompt", selectQuickReplyStart));

  assert.match(readFileSync(path.join(root, "src", "hooks", "useWorkbenchController.ts"), "utf8"), /const \[pendingConfirmationActionId, setPendingConfirmationActionId\] = useState<string \| null>\(null\);/);
  assert.match(source, /const selectQuickReply = useCallback/);
  assert.match(selectQuickReplySource, /setPendingConfirmationActionId\(actionId\?\.trim\(\) \|\| null\);[\s\S]*setInputState\(value\);/);
  assert.doesNotMatch(selectQuickReplySource, /sendPrompt/);
  assert.match(threadSource, /onChange=\{\(event\) => onComposerInputChange\(event\.currentTarget\.value\)\}/);
  assert.match(workbenchSource, /onComposerInputChange=\{onInputChange\}/);
  assert.match(suggestionsSource, /onClick=\{\(\) => onSelect\?\.\(choice\.prompt, choice\.actionId\)\}/);
});

test("Workbench invalidates a pending HumanGate action when composer context changes", () => {
  const sources = [
    readFileSync(path.join(root, "src", "hooks", "useWorkbenchProjectSync.ts"), "utf8"),
    readFileSync(path.join(root, "src", "hooks", "useWorkbenchProjectActions.ts"), "utf8"),
    readFileSync(path.join(root, "src", "hooks", "useWorkbenchComposerController.ts"), "utf8"),
  ].join("\n");

  assert.match(sources, /setPendingConfirmationActionId\(null\)/);
  assert.match(sources, /const setInput = useCallback[\s\S]*setPendingConfirmationActionId\(null\)[\s\S]*setInputState/);
  assert.match(sources, /const clearComposerReference = useCallback[\s\S]*setPendingConfirmationActionId\(null\)/);
});

test("Workbench real asset buttons send server-issued HumanGate action ids", () => {
  const generateSource = readFileSync(path.join(root, "src", "hooks", "useWorkbenchArtifactOperations.ts"), "utf8");

  assert.match(generateSource, /if \(!action\?\.actionId\) \{/);
  assert.match(generateSource, /dataSource\.generateRealAsset\(state\.activeProjectId, item\.artifactId, assetKind, \{[\s\S]*confirmedActionId: action\.actionId/);
});
