import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ConversationWorkbench scrolls to the newest chat state", () => {
  const source = readSource("src/components/conversation/ConversationWorkbench.tsx");

  assert.match(source, /useEffect/);
  assert.match(source, /scrollAnchorRef/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/);
  assert.match(source, /\[messages\.length, sending\]/);
  assert.match(source, /data-chat-scroll-anchor/);
  assert.match(source, /<ChatTranscript[\s\S]*sending=\{sending\}/);
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

test("Global styles define the AI thinking animation", () => {
  const source = readSource("src/app/globals.css");

  assert.match(source, /@keyframes shanhai-typing-pulse/);
  assert.match(source, /\.typing-dot/);
  assert.match(source, /animation: shanhai-typing-pulse/);
});
