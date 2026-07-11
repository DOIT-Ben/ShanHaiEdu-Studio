import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} should exist`);
  return readFileSync(absolutePath, "utf8");
}

test("M67 feedback client sends multipart metadata and repeated images with CSRF only", () => {
  const contractsSource = readSource("src/lib/feedback-contracts.ts");
  const apiSource = readSource("src/lib/feedback-api.ts");

  for (const field of [
    "category",
    "description",
    "severity",
    "idempotencyKey",
    "origin",
    "projectId",
    "messageId",
    "pageRoute",
    "clientContext",
  ]) {
    assert.match(contractsSource, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(contractsSource, /\bappVersion\b/);
  assert.match(contractsSource, /FeedbackSeverity\s*=\s*"normal"\s*\|\s*"affected"\s*\|\s*"blocked"/);
  assert.match(contractsSource, /"global"\s*\|\s*"profile"\s*\|\s*"message_helpful"\s*\|\s*"message_unhelpful"/);
  assert.match(contractsSource, /status:\s*"submitted"/);
  assert.match(contractsSource, /reused\?:\s*boolean/);
  assert.match(contractsSource, /export const feedbackCategoryOptions/);
  assert.match(contractsSource, /export const feedbackSeverityOptions/);
  assert.match(contractsSource, /language\?:\s*string/);

  assert.match(apiSource, /new FormData\(\)/);
  assert.match(apiSource, /formData\.append\("metadata",\s*JSON\.stringify\(metadata\)\)/);
  assert.match(apiSource, /formData\.append\("images",\s*file\)/);
  assert.match(apiSource, /fetcher\("\/api\/feedback"/);
  assert.match(apiSource, /getWorkbenchCsrfToken\(\)/);
  assert.match(apiSource, /"x-shanhai-csrf"/);
  assert.doesNotMatch(apiSource, /["']content-type["']\s*:/i);
  assert.match(apiSource, /response\.json\(\)/);
  assert.match(apiSource, /error\?:\s*unknown/);
  assert.match(apiSource, /message\?:\s*unknown/);
  assert.match(apiSource, /body\.message/);
  assert.match(apiSource, /new FeedbackApiError\(response\.status,\s*await/);
  assert.match(apiSource, /teacherFacingSubmitError/);
});

test("M67 feedback dialog provides guided categories, chips, image paste, previews, and states", () => {
  const dialogPrimitiveSource = readSource("src/components/ui/dialog.tsx");
  const dialogSource = readSource("src/components/feedback/FeedbackDialog.tsx");

  assert.match(dialogPrimitiveSource, /@radix-ui\/react-dialog/);
  assert.match(dialogPrimitiveSource, /rounded-(?:md|lg)/);
  assert.match(dialogSource, /data-feedback-dialog/);
  assert.match(dialogSource, /max-w-\[390px\]|w-\[calc\(100%-\d+px\)\]/);

  assert.match(dialogSource, /feedbackCategoryOptions\.map/);
  assert.match(dialogSource, /feedbackSeverityOptions\.map/);
  assert.doesNotMatch(dialogSource, /const categoryOptions/);
  assert.doesNotMatch(dialogSource, /const severityOptions/);
  assert.match(dialogSource, /data-feedback-chip/);
  assert.match(dialogSource, /onPaste/);
  assert.match(dialogSource, /clipboardData\.items/);
  assert.match(dialogSource, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(dialogSource, /data-feedback-image/);
  assert.match(dialogSource, /data-feedback-image-source/);
  assert.match(dialogSource, /data-feedback-status/);
  assert.match(dialogSource, /提交反馈/);
  assert.match(dialogSource, /反馈已收到/);
  assert.match(dialogSource, /重新提交/);
});

test("M71A feedback choices expose selected states and a primary submit action", () => {
  const dialogSource = readSource("src/components/feedback/FeedbackDialog.tsx");

  assert.match(dialogSource, /data-feedback-category=\{option\.id\}[\s\S]*aria-pressed=\{controller\.category === option\.id\}/);
  assert.match(dialogSource, /data-feedback-severity=\{option\.id\}[\s\S]*aria-pressed=\{controller\.severity === option\.id\}/);
  assert.match(dialogSource, /data-feedback-chip[\s\S]*aria-pressed=\{controller\.description\.includes\(chip\)\}/);
  assert.match(dialogSource, /border-2 border-\[#367d6d\] bg-\[#eef7f3\] font-medium text-\[#123f33\] shadow-\[0_0_0_2px_rgba\(54,125,109,0\.12\)\]/);
  assert.match(dialogSource, /hover:border-\[#8fcbbb\] hover:bg-\[#f7fbf9\]/);
  assert.match(dialogSource, /focus:ring-2 focus:ring-\[#8fcbbb\]\/45/);
  assert.match(dialogSource, /<Check className="h-3\.5 w-3\.5/);
  assert.match(dialogSource, /description\.includes\(chip\)/);
  assert.match(dialogSource, /const canSubmit = Boolean\(controller\.category && controller\.description\.trim\(\)\);/);
  assert.match(dialogSource, /disabled=\{submitting \|\| !canSubmit\}/);
  assert.match(dialogSource, /canSubmit && !submitting && "border-\[#367d6d\] bg-\[#367d6d\] text-white/);
});

test("M67 freezes every payload control while a submission is in flight", () => {
  const dialogSource = readSource("src/components/feedback/FeedbackDialog.tsx");

  assert.match(dialogSource, /const submitting = controller\.status === "submitting"/);
  assert.match(dialogSource, /if \(submitting\) return;[\s\S]*clipboardData\.items/);
  assert.match(dialogSource, /<DialogContent[\s\S]*onPaste=\{handlePaste\}/);
  assert.match(dialogSource, /data-feedback-category=\{option\.id\}[\s\S]*disabled=\{submitting\}/);
  assert.match(dialogSource, /data-feedback-chip[\s\S]*disabled=\{submitting\}/);
  assert.match(dialogSource, /data-feedback-description[\s\S]*disabled=\{submitting\}/);
  assert.match(dialogSource, /data-feedback-severity=\{option\.id\}[\s\S]*disabled=\{submitting\}/);
  assert.match(dialogSource, /type="file"[\s\S]*disabled=\{submitting\}/);
  assert.match(dialogSource, /aria-label=\{`删除图片[\s\S]*disabled=\{submitting\}/);
});

test("M67 feedback controller owns one retry-safe draft independently from workbench state", () => {
  const controllerSource = readSource("src/hooks/useFeedbackController.ts");
  const mediaWorkbenchSource = readSource("src/components/layout/MediaWorkbench.tsx");

  assert.doesNotMatch(controllerSource, /useWorkbenchController/);
  assert.match(controllerSource, /MAX_FEEDBACK_IMAGES\s*=\s*5/);
  assert.match(controllerSource, /10\s*\*\s*1024\s*\*\s*1024/);
  assert.match(controllerSource, /25\s*\*\s*1024\s*\*\s*1024/);
  assert.match(controllerSource, /image\/png/);
  assert.match(controllerSource, /image\/jpeg/);
  assert.match(controllerSource, /image\/webp/);
  assert.match(controllerSource, /URL\.createObjectURL/);
  assert.match(controllerSource, /URL\.revokeObjectURL/);
  assert.match(controllerSource, /createIdempotencyKey/);
  assert.match(controllerSource, /setStatus\("failed"\)/);
  assert.match(controllerSource, /submitFeedback/);
  assert.match(controllerSource, /inFlightRef\s*=\s*useRef\(false\)/);
  assert.match(controllerSource, /requestGenerationRef\s*=\s*useRef\(0\)/);
  assert.match(controllerSource, /if \(inFlightRef\.current\) return/);
  assert.match(controllerSource, /inFlightRef\.current\s*=\s*true/);
  assert.match(controllerSource, /requestGeneration\s*!==\s*requestGenerationRef\.current/);
  assert.match(controllerSource, /inFlightRef\.current\s*=\s*false/);
  assert.doesNotMatch(controllerSource, /NEXT_PUBLIC_APP_VERSION|appVersion/);

  assert.match(mediaWorkbenchSource, /useFeedbackController\(\)/);
  assert.equal((mediaWorkbenchSource.match(/<FeedbackDialog\b/g) ?? []).length, 1, "workbench should mount one FeedbackDialog");
  assert.match(mediaWorkbenchSource, /feedbackController\.openFeedback/);
});

test("M67 routes global, profile, and assistant message feedback into the singleton dialog", () => {
  const profileSource = readSource("src/components/layout/ProfileMenu.tsx");
  const sidebarSource = readSource("src/components/layout/ProjectSidebar.tsx");
  const topbarSource = readSource("src/components/conversation/WorkbenchTopbar.tsx");
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const transcriptSource = readSource("src/components/conversation/ChatTranscript.tsx");
  const actionsSource = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(profileSource, /data-feedback-origin="profile"/);
  assert.match(sidebarSource, /<ProfileMenu/);
  assert.match(sidebarSource, /mt-auto/);
  assert.match(topbarSource, /data-feedback-origin="global"/);
  assert.match(topbarSource, /<ProfileMenu/);
  assert.match(topbarSource, /lg:hidden/);
  assert.match(conversationSource, /onOpenFeedback/);
  assert.match(transcriptSource, /data-message-id=\{message\.id\}/);
  assert.match(transcriptSource, /projectId=\{projectId\}/);
  assert.match(transcriptSource, /messageId=\{message\.id\}/);
  assert.match(actionsSource, /origin:\s*"message_helpful"/);
  assert.match(actionsSource, /origin:\s*"message_unhelpful"/);
  assert.match(actionsSource, /projectId/);
  assert.match(actionsSource, /messageId/);
  assert.doesNotMatch(actionsSource, /反馈入口暂未开放/);
});

test("M67 message feedback actions remain visible on touch and expose stable selectors", () => {
  const actionsSource = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(actionsSource, /data-message-actions/);
  assert.match(actionsSource, /data-feedback-origin="message_helpful"/);
  assert.match(actionsSource, /data-feedback-origin="message_unhelpful"/);
  assert.match(actionsSource, /opacity-100/);
  assert.match(actionsSource, /@media\(hover:hover\)/);
});
