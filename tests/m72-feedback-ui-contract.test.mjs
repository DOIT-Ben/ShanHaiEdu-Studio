import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("M72 feedback dialog keeps its frame and quick supplement region stable", () => {
  const source = readSource("src/components/feedback/FeedbackDialog.tsx");

  assert.match(source, /h-\[min\(760px,calc\(100dvh-24px\)\)\]/);
  assert.match(source, /flex-1[\s\S]*overflow-y-auto/);
  assert.match(source, /<footer className="[^"]*border-t/);
  assert.match(source, /data-feedback-quick-supplement className="min-h-28 shrink-0"/);
  assert.match(source, /\(selectedCategory\?\.chips \?\? \[\]\)\.map/);
  assert.doesNotMatch(source, /selectedCategory && \([\s\S]*data-feedback-quick-supplement/);
});

test("M72 feedback paste keeps issue and expected screenshots separated", () => {
  const source = readSource("src/components/feedback/FeedbackDialog.tsx");

  assert.match(source, /closest<HTMLElement>\("\[data-feedback-paste-kind\]"\)/);
  assert.match(source, /pasteTarget === "expected" \? "expected" : "issue"/);
  assert.match(source, /data-feedback-paste-kind="issue"/);
  assert.match(source, /data-feedback-paste-kind="expected"/);
});

test("M72 message reactions announce save, switch, cancel, and failure results accessibly", () => {
  const source = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(source, /previousReaction === value[\s\S]*"已取消评价"/);
  assert.match(source, /`已改为\$\{value === "helpful" \? "点赞" : "点踩"\}`/);
  assert.match(source, /`已\$\{value === "helpful" \? "点赞" : "点踩"\}`/);
  assert.match(source, /"评价保存失败，请重试"/);
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /onSetReaction\(messageId, previousReaction === value \? null : value\)/);
});
