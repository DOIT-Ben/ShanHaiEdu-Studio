import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("ProjectSidebar provides a real searchable project input", () => {
  const source = readSource("src/components/layout/ProjectSidebar.tsx");

  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(""\)/);
  assert.match(source, /placeholder="搜索课题"/);
  assert.match(source, /value=\{searchQuery\}/);
  assert.match(source, /onChange=\{\(event\) => setSearchQuery\(event\.target\.value\)\}/);
  assert.match(source, /filteredProjects/);
  assert.match(source, /project\.title|project\.currentStep|project\.meta/);
  assert.match(source, /没有找到匹配项目/);
});

test("assistant-ui renders persisted artifact references and uses the XiaoKu avatar asset", () => {
  const threadSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const partSource = readSource("src/components/conversation/assistant-ui/MessagePartRenderers.tsx");

  assert.match(partSource, /data-message-part="artifact-ref"/);
  assert.match(partSource, /onOpenArtifact\(data\.artifactId\)/);
  assert.match(threadSource, /\/brand\/xiaoku-avatar\.png/);
  assert.equal(existsSync(path.join(root, "public/brand/xiaoku-avatar.png")), true);
});

test("Artifact side panel disables width animation while dragging", () => {
  const sidePanelSource = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const handleSource = readSource("src/components/artifacts/ResizableHandle.tsx");

  assert.doesNotMatch(sidePanelSource, /transition-\[width\]/);
  assert.match(sidePanelSource, /const \[width, setWidth\] = useState\(360\)/);
  assert.match(sidePanelSource, /onChange=\{setWidth\}/);
  assert.match(handleSource, /onPointerDown=\{startResize\}/);
  assert.match(handleSource, /onMouseDown=\{startResize\}/);
  assert.match(handleSource, /onResizeStart\?: \(\) => void/);
  assert.match(handleSource, /onResizeEnd\?: \(\) => void/);
  assert.match(handleSource, /onResizeStart\?\.\(\)/);
  assert.match(handleSource, /onResizeEnd\?\.\(\)/);
});

test("Conversation layout compresses when the artifact side panel is open", () => {
  const mediaSource = readSource("src/components/layout/MediaWorkbench.tsx");
  const conversationSource = readSource("src/components/conversation/ConversationWorkbench.tsx");
  const topbarSource = readSource("src/components/conversation/WorkbenchTopbar.tsx");

  assert.match(mediaSource, /compact=\{controller\.sidePanelOpen\}/);
  assert.match(conversationSource, /compact: boolean/);
  assert.match(conversationSource, /<WorkbenchTopbar[\s\S]*compact=\{compact\}/);
  assert.doesNotMatch(conversationSource, /<StageProgress/);
  assert.match(topbarSource, /compact = false/);
  assert.match(topbarSource, /data-workbench-topbar-compact/);
});

test("Project sidebar exposes real archive and recycle-bin actions while collaboration stays wired to member management", () => {
  const sidebarSource = readSource("src/components/layout/ProjectSidebar.tsx");
  const topbarSource = readSource("src/components/conversation/WorkbenchTopbar.tsx");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");
  const detailSource = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");

  assert.match(sidebarSource, /onViewChange\?\.\("archived"\)/);
  assert.match(sidebarSource, /onViewChange\?\.\("trash"\)/);
  assert.match(sidebarSource, /ProjectLifecycleConfirmDialog/);
  assert.doesNotMatch(sidebarSource, /回收站稍后开放|showDisabledUtilities/);
  assert.match(topbarSource, /onOpenMembers/);
  assert.match(topbarSource, /title=\{project \? "管理协作成员" : "先选择项目"\}/);
  assert.doesNotMatch(topbarSource, /title="协作稍后开放"/);
  assert.match(topbarSource, /aria-label=\{savedLabel\}/);
  assert.doesNotMatch(topbarSource, /<Button[\s\S]*\{savedLabel\}[\s\S]*<\/Button>/);
  assert.match(composerSource, /data-composer-surface/);
  assert.match(composerSource, /aria-label="添加选项"/);
  assert.match(composerSource, /aria-label="选择生成强度"/);
  assert.match(composerSource, /生成强度/);
  assert.doesNotMatch(composerSource, /可选模型|更多模型即将提供/);
  assert.doesNotMatch(composerSource, /aria-label="工具和资料"|aria-label="重新生成"/);
  assert.doesNotMatch(detailSource, /完整缩略图预览稍后开放|缩略预览/);
  assert.doesNotMatch(detailSource, /<button[\s\S]*来源对话[\s\S]*<\/button>/);
});

test("M70 composer exposes real first-run, drag-drop, paste, and tool-menu surfaces", () => {
  const conversationSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");
  const actionsSource = readSource("src/components/conversation/messages/MessageActions.tsx");

  assert.match(conversationSource, /WelcomeEmptyState/);
  assert.match(conversationSource, /buildWelcomePromptSuggestions/);
  assert.match(conversationSource, /onSelect\(suggestion\.prompt\)/);
  assert.doesNotMatch(conversationSource, /直接告诉我你要准备哪节公开课/);

  assert.match(composerSource, /handleDrop/);
  assert.match(composerSource, /onDrop=\{handleDrop\}/);
  assert.match(composerSource, /handlePaste/);
  assert.match(composerSource, /onPaste=\{handlePaste\}/);
  assert.doesNotMatch(composerSource, /previousComposerSubmittingRef/);
  assert.match(composerSource, /attachmentSubmission/);
  assert.match(composerSource, /hasCompletedComposerAttachmentSubmission/);
  assert.match(composerSource, /attachmentWasSubmitted/);
  assert.match(composerSource, /visibleAttachment/);
  assert.match(composerSource, /function handleSubmit/);
  assert.match(composerSource, /visibleAttachment\?\.status === "pending_parse"/);
  assert.match(composerSource, /这份资料还在读取/);
  assert.match(composerSource, /if \(composerSubmitting\) return;/);
  assert.match(composerSource, /正在发送中，请等本轮发送完成后再添加资料/);
  assert.match(composerSource, /cancelPendingAttachmentRead/);
  assert.match(composerSource, /onRemove=\{composerSubmitting \? undefined : clearAttachment\}/);
  assert.match(composerSource, /reference\?\.startsWith\(`资料《\$\{attachment\.fileName\}》`\)/);
  assert.match(composerSource, /ComposerMenuPlaceholder/);
  assert.doesNotMatch(composerSource, /item\.action === "focus_input"|onFocusInput/);
  assert.match(composerSource, /添加资料/);
  assert.doesNotMatch(composerSource, /更多操作暂未开放|稍后开放/);
  assert.doesNotMatch(actionsSource, /更多操作暂未开放|aria-label="更多操作"|MoreHorizontal/);
});

test("M70 workbench send requests include a client idempotency key", () => {
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");
  const apiSource = readSource("src/lib/workbench-api.ts");

  assert.match(controllerSource, /messageIdempotencyRef/);
  assert.match(controllerSource, /getRetrySafeMessageIdempotencyKey\(messageIdempotencyRef, messageSignature\)/);
  assert.match(controllerSource, /messageIdempotencyRef\.current = null/);
  assert.match(controllerSource, /crypto\.randomUUID/);
  assert.match(apiSource, /idempotencyKey: options\.idempotencyKey/);
});
