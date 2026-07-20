import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ConversationWorkbench keeps the transcript free of timeline navigation", () => {
  const source = readSource("src/components/conversation/ConversationWorkbench.tsx");

  assert.equal(source.includes("ConversationNavigator"), false);
  assert.equal(source.includes("jumpToMessage"), false);
});

test("ShanHaiThread renders model-chat style message bubbles with preserved multiline text", () => {
  const source = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const actionsSource = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(source, /data-message-role="assistant"/);
  assert.match(source, /data-message-role="teacher"/);
  assert.match(source, /data-chat-bubble="assistant"/);
  assert.match(source, /data-chat-bubble="user"/);
  assert.match(source, /whitespace-pre-wrap/);
  assert.match(source, /<MessageActions/);
  assert.match(actionsSource, /aria-label="复制回复"/);
});

test("MediaWorkbench keeps the artifact drawer available for narrow screens", () => {
  const source = readSource("src/components/layout/MediaWorkbench.tsx");

  assert.match(source, /onClick=\{\(\) => openArtifactDrawer\("all"\)\}/);
  assert.match(source, />\s*产物\s*</);
  assert.match(source, /<Sheet open=\{controller\.railOpen\} onOpenChange=\{controller\.setRailOpen\}/);
  assert.match(source, /variant="drawer"/);
});

test("Workbench controller gives immediate chat feedback and blocks duplicate submit clicks", () => {
  const source = readSource("src/hooks/workbench-composer-submission.ts");
  const composerControllerSource = readSource("src/hooks/useWorkbenchComposerController.ts");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");

  assert.match(readSource("src/hooks/useWorkbenchController.ts"), /const \[composerSubmitting, setComposerSubmitting\] = useState\(false\)/);
  assert.match(composerControllerSource, /const composerSubmittingRef = useRef\(false\)/);
  assert.match(source, /if \(context\.composerSubmittingRef\.current \|\| context\.composerSubmitting\)/);
  assert.match(source, /context\.composerSubmittingRef\.current = true/);
  assert.match(source, /context\.composerSubmittingRef\.current = false/);
  assert.match(composerControllerSource, /setMessages\(\(current\) => \[/);
  assert.match(source, /speaker: "teacher"/);
  assert.match(source, /context\.setComposerSubmitting\(true\)/);
  assert.match(source, /context\.setComposerSubmitting\(false\)/);
  assert.match(readSource("src/hooks/useWorkbenchController.ts"), /composerSubmitting,/);
  assert.match(composerSource, /composerSubmitting: boolean/);
  assert.match(composerSource, /disabled=\{composerSubmitting\}/);
});
