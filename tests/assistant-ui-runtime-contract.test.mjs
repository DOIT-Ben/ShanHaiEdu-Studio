import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("assistant-ui is the only conversation runtime", () => {
  const runtimePath = "src/components/conversation/assistant-ui/ShanHaiAssistantRuntime.tsx";
  const threadPath = "src/components/conversation/assistant-ui/ShanHaiThread.tsx";
  assert.equal(existsSync(path.join(root, runtimePath)), true);
  assert.equal(existsSync(path.join(root, threadPath)), true);

  const runtime = read(runtimePath);
  const thread = read(threadPath);
  const workbench = read("src/components/conversation/ConversationWorkbench.tsx");
  const page = read("src/app/page.tsx");

  assert.match(runtime, /useExternalStoreRuntime/);
  assert.match(runtime, /AssistantRuntimeProvider/);
  assert.match(runtime, /onNew/);
  assert.match(runtime, /mergeTeacherAgentEventsIntoMessages/);
  assert.match(runtime, /unstable_enableToolInvocations:\s*false/);
  assert.doesNotMatch(runtime, /onEdit|onReload|onDelete|onRespondToToolApproval/);
  assert.match(thread, /ThreadPrimitive\.Root/);
  assert.match(thread, /ThreadPrimitive\.Viewport/);
  assert.match(thread, /ThreadPrimitive\.Messages/);
  assert.match(thread, /ComposerPrimitive\.Root/);
  assert.match(thread, /ComposerPrimitive\.Input/);
  assert.match(thread, /ComposerPrimitive\.Send/);
  assert.match(thread, /name="lesson-workbench-prompt"/);
  assert.match(thread, /data-message-role/);
  assert.match(thread, /data-chat-bubble="assistant"/);
  assert.match(thread, /data-chat-bubble="user"/);
  assert.doesNotMatch(thread, /ScrollArea|scrollIntoView|data-chat-scroll-anchor/);
  assert.match(workbench, /<ShanHaiAssistantRuntime/);
  assert.doesNotMatch(workbench, /conversationRuntime|LegacyConversationThread/);
  assert.doesNotMatch(page, /SHANHAI_ASSISTANT_UI_ENABLED|conversationRuntime/);
  assert.match(page, /<MediaWorkbench\s*\/>/);
  assert.match(page, /export const dynamic\s*=\s*["']force-dynamic["']/);
});

test("all project data parts have explicit renderers and markdown rejects raw html", () => {
  const renderers = read("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");
  for (const name of ["activity", "plan", "tool-status", "artifact-ref", "quality-summary", "human-input", "dialogue-checkpoint", "next-actions", "error-recovery"]) {
    assert.match(renderers, new RegExp(`shanhai\\.${name.replace("-", "\\-")}`));
  }
  assert.match(renderers, /MarkdownTextPrimitive/);
  assert.match(renderers, /remarkGfm/);
  assert.match(renderers, /skipHtml/);
  assert.doesNotMatch(renderers, /dangerouslySetInnerHTML/);
});

test("assistant-ui submit uses an explicit message object and keeps runtime-only actions disabled", () => {
  const controller = read("src/hooks/useWorkbenchController.ts");
  const runtime = read("src/components/conversation/assistant-ui/ShanHaiAssistantRuntime.tsx");

  assert.match(controller, /submitConversationMessage/);
  assert.match(controller, /body:\s*string/);
  assert.match(controller, /artifactRefs:\s*string\[\]/);
  assert.match(runtime, /submitConversationMessage\(\{[\s\S]*body[\s\S]*reference[\s\S]*artifactRefs[\s\S]*confirmedActionId/);
  assert.doesNotMatch(runtime, /addToolResult|respondToToolApproval|reload\(|edit\(|branch/);
});

test("assistant-ui presents one compact live state on a shared conversation rail", () => {
  const runtime = read("src/components/conversation/assistant-ui/ShanHaiAssistantRuntime.tsx");
  const thread = read("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const renderers = read("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(runtime, /hasAgentActivity/);
  assert.match(thread, /projectBusy\s*&&\s*!props\.hasAgentActivity/);
  assert.doesNotMatch(thread, />你<\/span>/);
  assert.doesNotMatch(thread, /space-y-7/);
  assert.ok((thread.match(/max-w-\[800px\]/g) ?? []).length >= 2);
  assert.match(renderers, /data-activity-inline/);
  assert.match(renderers, /data-agent-progress-step/);
  assert.match(renderers, /data\.purpose/);
  assert.match(renderers, /data\.inputSummary/);
  assert.match(renderers, /data\.expectedOutput/);
  assert.match(renderers, /data\.observationSummary/);
  assert.match(renderers, /useRealElapsedMs/);
  assert.match(renderers, /window\.setInterval/);
  assert.doesNotMatch(renderers, /模拟进度|progressPercent|\d+%/);
  assert.match(thread, /data-agent-progress-timeline/);
  assert.match(thread, /data-agent-stream-caret/);
  assert.match(thread, /projectionKind === "agent-response"/);
  assert.doesNotMatch(renderers, /data-message-part="activity"[\s\S]{0,400}<StatusLabel/);
});

test("conversation workbench does not render a fixed macro-stage progress rail", () => {
  const workbench = read("src/components/conversation/ConversationWorkbench.tsx");

  assert.doesNotMatch(workbench, /StageProgress/);
  assert.doesNotMatch(workbench, /deriveWorkbenchStageIndex/);
});

test("app metadata uses an existing brand asset as the browser icon", () => {
  const layout = read("src/app/layout.tsx");

  assert.match(layout, /icons:\s*\{[\s\S]*icon:\s*["']\/brand\/shanhai-ai-logo-256\.png["']/);
});
