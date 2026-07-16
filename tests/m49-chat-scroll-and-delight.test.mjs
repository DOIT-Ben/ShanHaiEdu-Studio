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

test("assistant-ui exclusively owns conversation scrolling", () => {
  const source = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const assistantThread = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");

  assert.doesNotMatch(source, /LegacyConversationThread|scrollAnchorRef|data-chat-scroll-anchor|ChatTranscript/);
  assert.match(source, /<ShanHaiAssistantRuntime/);
  assert.match(assistantThread, /ThreadPrimitive\.Viewport/);
  assert.match(assistantThread, /data-assistant-ui-scroll-viewport/);
  assert.doesNotMatch(assistantThread, /scrollIntoView|data-chat-scroll-anchor|ScrollArea/);
});

test("assistant-ui renders 小酷 identity and thinking feedback", () => {
  const source = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const generatingSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");
  const contractsSource = readSource("src/components/conversation/composer/composer-contracts.ts");

  assert.match(source, /function XiaoKuMark/);
  assert.match(source, /function XiaoKuMark/);
  assert.match(source, /\/brand\/xiaoku-avatar\.png/);
  assert.match(generatingSource, /data-ai-thinking/);
  assert.match(generatingSource, /getGeneratingLabel/);
  assert.match(contractsSource, /正在生成回复/);
  assert.match(generatingSource, /typing-dot/);
  assert.doesNotMatch(generatingSource, />小酷</);
});

test("assistant message actions are a quiet teacher-facing component", () => {
  const transcriptSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const actionsSource = readOptionalSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(transcriptSource, /import \{ MessageActions \}/);
  assert.match(transcriptSource, /<MessageActions[\s\S]*?text=\{\[custom\.title, custom\.body\]/);
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
