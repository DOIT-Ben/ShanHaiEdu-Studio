import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ShanHaiThread only links artifacts named by message facts", () => {
  const source = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");

  assert.match(source, /custom\.artifactRefs/);
  assert.match(source, /hasArtifactPart/);
  assert.doesNotMatch(source, /hasGeneratedSignal/);
  assert.doesNotMatch(source, /已生成\|生成\|产物\|草稿\|说明书\|教案\|大纲\|视频\|交付/);
});

test("ShanHaiThread renders only explicit quick reply choices", () => {
  const source = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const quickReplySource = readSource("src/components/conversation/messages/QuickReplySuggestions.tsx");

  assert.match(source, /custom\.quickReplies\.length > 0/);
  assert.match(source, /onSelect=\{props\.onSelectAction\}/);
  assert.match(quickReplySource, /data-quick-reply-choice/);
  assert.match(quickReplySource, /data-recommended-choice/);
  assert.match(quickReplySource, /推荐/);
  assert.doesNotMatch(source, /我想做三年级数学公开课/);
  assert.doesNotMatch(source, /先帮我整理备课需求/);
});

test("ConversationWorkbench routes quick reply choices into the composer without sending", () => {
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const controllerSource = readSource("src/hooks/useWorkbenchComposerController.ts");

  assert.match(conversationSource, /onSelectAction=\{onQuickReplySelect \?\? onInputChange\}/);
  assert.match(controllerSource, /const selectQuickReply = useCallback/);
  assert.match(controllerSource, /setInputState\(value\)/);
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

test("Conversation UI presents the assistant as 小酷", () => {
  const transcriptSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");

  assert.match(transcriptSource, />小酷</);
  assert.match(transcriptSource, /你好，我是小酷/);
  assert.doesNotMatch(transcriptSource, /ShanHaiEdu AI/);
});
