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

test("ChatTranscript renders model-chat style message bubbles with preserved multiline text", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");
  const actionsSource = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(source, /data-message-role=\{message\.speaker\}/);
  assert.match(source, /data-chat-bubble="assistant"/);
  assert.match(source, /data-chat-bubble="user"/);
  assert.match(source, /whitespace-pre-wrap/);
  assert.match(source, /<MessageActions/);
  assert.match(actionsSource, /aria-label="复制回复"/);
});

test("MediaWorkbench keeps the artifact drawer available for narrow screens", () => {
  const source = readSource("src/components/layout/MediaWorkbench.tsx");

  assert.match(source, /onClick=\{\(\) => controller\.setRailOpen\(true\)\}/);
  assert.match(source, />\s*产物\s*</);
  assert.match(source, /<Sheet open=\{controller\.railOpen\} onOpenChange=\{controller\.setRailOpen\}/);
  assert.match(source, /variant="drawer"/);
});

test("Workbench controller gives immediate chat feedback and blocks duplicate sends while waiting", () => {
  const source = readSource("src/hooks/useWorkbenchController.ts");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");

  assert.match(source, /const \[sending, setSending\] = useState\(false\)/);
  assert.match(source, /const sendingRef = useRef\(false\)/);
  assert.match(source, /if \(sendingRef\.current \|\| sending\) \{/);
  assert.match(source, /sendingRef\.current = true/);
  assert.match(source, /sendingRef\.current = false/);
  assert.match(source, /setMessages\(\(current\) => \[/);
  assert.match(source, /speaker: "teacher"/);
  assert.match(source, /setSending\(true\)/);
  assert.match(source, /setSending\(false\)/);
  assert.match(source, /sending,/);
  assert.match(composerSource, /sending: boolean/);
  assert.match(composerSource, /disabled=\{sending\}/);
});
