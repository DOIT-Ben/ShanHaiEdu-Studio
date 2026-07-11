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

  assert.match(source, /message\.artifactRefs/);
  assert.doesNotMatch(source, /hasGeneratedSignal/);
  assert.doesNotMatch(source, /已生成\|生成\|产物\|草稿\|说明书\|教案\|大纲\|视频\|交付/);
});

test("ChatTranscript renders recommended quick reply choices for semi-auto clarification", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");
  const quickReplySource = readSource("src/components/conversation/messages/QuickReplySuggestions.tsx");

  assert.match(source, /onQuickReplySelect\?: \(value: string, actionId\?: string\) => void/);
  assert.match(quickReplySource, /data-quick-reply-choice/);
  assert.match(quickReplySource, /data-recommended-choice/);
  assert.match(quickReplySource, /推荐/);
  assert.match(source, /getQuickReplyChoices/);
  assert.doesNotMatch(source, /!artifact\s*&&\s*quickReplies\.length/);
  assert.doesNotMatch(source, /我想做三年级数学公开课/);
  assert.doesNotMatch(source, /先帮我整理备课需求/);
});

test("ConversationWorkbench routes quick reply choices into the composer without sending", () => {
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");

  assert.match(conversationSource, /onQuickReplySelect=\{onQuickReplySelect\}/);
  assert.match(controllerSource, /function selectQuickReply/);
  assert.match(controllerSource, /setInput\(value\)/);
  assert.doesNotMatch(controllerSource, /selectQuickReply[\s\S]*sendPrompt\(/);
});

test("ProjectSidebar can collapse the public course section and keeps lifecycle utilities available", () => {
  const source = readSource("src/components/layout/ProjectSidebar.tsx");

  assert.match(source, /courseSectionOpen, setCourseSectionOpen/);
  assert.match(source, /aria-expanded=\{courseSectionOpen\}/);
  assert.match(source, /filteredProjects\.map/);
  assert.match(source, /onViewChange\?\.\("archived"\)/);
  assert.match(source, /onViewChange\?\.\("trash"\)/);
  assert.doesNotMatch(source, /showDisabledUtilities|回收站稍后开放/);
});

test("Message route uses model-first main conversation agent instead of deterministic pre-gates", () => {
  const source = readSource("src/app/api/workbench/projects/[projectId]/messages/route.ts");

  assert.match(source, /createMainConversationAgentFromEnv/);
  assert.doesNotMatch(source, /createDeterministicMainConversationAgent/);
  assert.doesNotMatch(source, /planCapabilityForRequest/);
});
