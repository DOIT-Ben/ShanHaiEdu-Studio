import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ChatTranscript does not show inline artifacts for ungenerated workflow nodes", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /if \(!item\.artifactId\) return null/);
  assert.match(source, /hasGeneratedSignal/);
  assert.doesNotMatch(source, /已生成\|生成\|产物\|草稿\|说明书\|教案\|大纲\|视频\|交付/);
});

test("ChatTranscript renders recommended quick reply choices for semi-auto clarification", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /onQuickReplySelect\?: \(value: string\) => void/);
  assert.match(source, /data-quick-reply-choice/);
  assert.match(source, /data-recommended-choice/);
  assert.match(source, /推荐/);
  assert.match(source, /getQuickReplyChoices/);
});

test("ConversationWorkbench routes quick reply choices into the composer without sending", () => {
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");

  assert.match(conversationSource, /onQuickReplySelect=\{onQuickReplySelect\}/);
  assert.match(controllerSource, /function selectQuickReply/);
  assert.match(controllerSource, /setInput\(value\)/);
  assert.doesNotMatch(controllerSource, /selectQuickReply[\s\S]*sendPrompt\(/);
});

test("ProjectSidebar can collapse the public course section and keeps disabled features out of the main visual path", () => {
  const source = readSource("src/components/layout/ProjectSidebar.tsx");

  assert.match(source, /courseSectionOpen, setCourseSectionOpen/);
  assert.match(source, /aria-expanded=\{courseSectionOpen\}/);
  assert.match(source, /filteredProjects\.map/);
  assert.match(source, /showDisabledUtilities/);
  assert.doesNotMatch(source, /回收站[\s\S]*w-full justify-start/);
});

test("Deterministic conversation gate separates casual chat from explicit lesson work", () => {
  const source = readSource("src/server/conversation/conversation-orchestrator.ts");

  assert.match(source, /isCasualChat/);
  assert.match(source, /isExplicitLessonWorkRequest/);
  assert.match(source, /intent: "chat"/);
  assert.match(source, /intent: "start_requirement"/);
  assert.doesNotMatch(source, /"生成",\s*\n\s*"设计",/);
});
