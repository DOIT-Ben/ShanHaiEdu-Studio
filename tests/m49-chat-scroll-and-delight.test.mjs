import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readOptionalSource(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

test("ConversationWorkbench scrolls to the newest chat state", () => {
  const source = readSource("src/components/conversation/ConversationWorkbench.tsx");

  assert.match(source, /useEffect/);
  assert.match(source, /scrollAnchorRef/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/);
  assert.match(source, /\[messages\.length, composerSubmitting, projectBusy\]/);
  assert.match(source, /data-chat-scroll-anchor/);
  assert.match(source, /<ChatTranscript[\s\S]*projectBusy=\{projectBusy\}/);
});

test("ChatTranscript renders AI identity and thinking feedback", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");
  const generatingSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");
  const contractsSource = readSource("src/components/conversation/composer/composer-contracts.ts");

  assert.match(source, /function ShanHaiMark/);
  assert.match(source, /data-assistant-logo/);
  assert.match(generatingSource, /data-ai-thinking/);
  assert.match(generatingSource, /getGeneratingLabel/);
  assert.match(contractsSource, /正在生成回复/);
  assert.match(generatingSource, /typing-dot/);
});

test("assistant message actions are a quiet teacher-facing component", () => {
  const transcriptSource = readSource("src/components/conversation/ChatTranscript.tsx");
  const actionsSource = readOptionalSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(transcriptSource, /import \{ MessageActions \}/);
  assert.match(transcriptSource, /<MessageActions[\s\S]*?text=\{\[message\.title, message\.body\]/);
  assert.doesNotMatch(transcriptSource, /function AssistantMessageActions/);

  assert.match(actionsSource, /aria-label="复制回复"/);
  assert.match(actionsSource, /aria-label="这条有帮助"/);
  assert.match(actionsSource, /aria-label="这条没帮上"/);
  assert.doesNotMatch(actionsSource, /aria-label="更多操作"|更多操作暂未开放|MoreHorizontal/);
  assert.match(actionsSource, /opacity-0/);
  assert.match(actionsSource, /group-hover:opacity-100/);
  assert.match(actionsSource, /group-focus-within:opacity-100/);
});

test("Global styles define the AI thinking animation", () => {
  const source = readSource("src/app/globals.css");

  assert.match(source, /@keyframes shanhai-typing-pulse/);
  assert.match(source, /\.typing-dot/);
  assert.match(source, /animation: shanhai-typing-pulse/);
});
