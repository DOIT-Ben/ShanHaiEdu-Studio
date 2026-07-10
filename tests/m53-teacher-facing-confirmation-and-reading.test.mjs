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

test("message route lets the model-first agent decide before generating artifacts", () => {
  const routeSource = readSource("src/app/api/workbench/projects/[projectId]/messages/route.ts");
  const queueSource = readSource("src/server/conversation/conversation-turn-queue.ts");
  const serviceSource = readSource("src/server/conversation/conversation-turn-service.ts");

  assert.match(routeSource, /drainProjectConversationQueue/);
  assert.match(queueSource, /createConversationTurnService/);
  assert.doesNotMatch(routeSource, /formatRequirementConfirmation/);
  assert.doesNotMatch(routeSource, /runtime\.run/);
  assert.doesNotMatch(routeSource, /saveArtifact/);

  assert.match(serviceSource, /agent\.respond/);
  assert.match(serviceSource, /conversationContext/);
  assert.match(serviceSource, /findPendingDeliveryPlan/);
  assert.match(serviceSource, /runPlannedArtifact/);
  assert.match(serviceSource, /runCapabilityWithAgentRuntime/);
  assert.match(serviceSource, /saveArtifact/);

  const agentDecisionStart = serviceSource.indexOf("const agentTurn = applyCapabilityAvailabilityToTurn(await input.agent.respond");
  assert.notEqual(agentDecisionStart, -1);
  const agentDecisionBranch = serviceSource.slice(agentDecisionStart);
  assert.match(agentDecisionBranch, /if \(agentTurn\.shouldRunToolNow && \(agentTurn\.toolPlan \|\| pendingPlan\?\.toolPlan\)\)/);
  assert.match(agentDecisionBranch, /runPlannedArtifact/);
  assert.match(agentDecisionBranch, /return \{ message: input\.triggerMessage, assistantMessage, agentTurn \}/);
  assert.doesNotMatch(agentDecisionBranch.split(/if \(agentTurn\.shouldRunToolNow && \(agentTurn\.toolPlan \|\| pendingPlan\?\.toolPlan\)\)/)[0], /saveArtifact/);
});

test("conversation inline artifact is a teacher-facing result card without backend labels", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /TeacherArtifactCard/);
  assert.match(source, /data-teacher-artifact-card/);
  assert.match(source, /展开查看/);
  assert.doesNotMatch(source, /GeneratedArtifactInline/);
  assert.doesNotMatch(source, /生成内容已进入产物链/);
  assert.doesNotMatch(source, /上游来源/);
  assert.doesNotMatch(source, /line-clamp-4/);
});

test("artifact reading preview keeps markdown rendering but removes backend section titles", () => {
  const source = readSource("src/components/artifacts/MarkdownPreview.tsx");

  assert.match(source, /function renderMarkdownBlocks/);
  assert.match(source, /MarkdownBlockView/);
  assert.match(source, /readableContentEntries/);
  assert.doesNotMatch(source, /关键字段/);
  assert.doesNotMatch(source, /正文预览/);
  assert.doesNotMatch(source, /上游来源/);
  assert.doesNotMatch(source, />\{title\}<|<h3[^>]*>\{title\}<\/h3>/);
});

test("artifact detail and side panel use reading language instead of engineering surfaces", () => {
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const nodeCardSource = readSource("src/components/artifacts/ArtifactNodeCard.tsx");
  const resizableSource = readSource("src/components/artifacts/ResizableHandle.tsx");

  assert.match(detailSource, /成果阅读|备课成果/);
  assert.match(sidePanelSource, /成果阅读|备课成果/);
  assert.doesNotMatch(sidePanelSource, /产物预览/);
  assert.doesNotMatch(nodeCardSource, /提示词/);
  assert.doesNotMatch(resizableSource, /产物预览/);

  for (const forbidden of ["生成来源", "页面脚本", "提示词", "缩略预览", "上游产物"]) {
    assert.doesNotMatch(detailSource, new RegExp(forbidden));
  }
});

test("workbench mappers do not expose Markdown or status as visible artifact labels", () => {
  const source = readSource("src/lib/workbench-mappers.ts");

  assert.match(source, /content\.正文|content\["正文"\]|content\["备课内容"\]/);
  assert.doesNotMatch(source, /content\.Markdown|content\["Markdown"\]/);
  assert.doesNotMatch(source, /label: "状态"/);
  assert.doesNotMatch(source, /content: \{ 说明: "还没有生成内容。"\ }/);
  assert.match(source, /capability.*id/);
  assert.match(source, /runtime.*kind/);
  assert.match(source, /provider.*status/);
});

test("chat transcript wraps long continuous teacher-facing text on narrow screens", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /break-words whitespace-pre-wrap rounded-2xl bg/);
  assert.match(source, /space-y-3 break-words whitespace-pre-wrap/);
  assert.match(source, /break-words whitespace-pre-wrap text-xs/);
});

test("assistant feedback actions open the real feedback collection with message context", () => {
  const source = readOptionalSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(source, /onOpenFeedback/);
  assert.match(source, /origin: "message_helpful"/);
  assert.match(source, /origin: "message_unhelpful"/);
  assert.match(source, /projectId, messageId/);
  assert.doesNotMatch(source, /反馈入口暂未开放/);

  for (const forbidden of ["backend", "API", "debug", "provider", "schema", "manifest", "node_id", "storage"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }
});

test("generating indicator keeps waiting text understandable for teachers", () => {
  const generatingSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");

  assert.match(generatingSource, /aria-label="正在准备回复"|aria-label="正在生成"/);
  assert.match(generatingSource, /getGeneratingLabel/);
  assert.doesNotMatch(generatingSource, /debug|provider|schema|manifest|node_id|storage/i);
});

test("delivery plan card uses teacher-facing step labels without backend fields", () => {
  const source = readSource("src/components/conversation/ChatTranscript.tsx");

  assert.match(source, /DeliveryPlanCard/);
  assert.match(source, /备课推进计划|交付计划/);
  assert.match(source, /statusLabel/);
  assert.doesNotMatch(source, /capabilityId|artifactKind|schema|manifest|provider|node_id|storage|API|debug|local path/i);
});

test("composer auto resize uses measured text height before hiding overflow", () => {
  const source = readSource("src/components/conversation/composer/useAutoResizeTextarea.ts");

  assert.match(source, /element\.scrollHeight/);
  assert.match(source, /Math\.min\(maxHeight, measuredHeight\)/);
  assert.match(source, /measuredHeight > maxHeight \? "auto" : "hidden"/);
});
