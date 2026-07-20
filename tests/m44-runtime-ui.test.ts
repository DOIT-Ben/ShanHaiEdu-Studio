import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationWorkbench } from "@/components/conversation/ConversationWorkbench";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";

const project = {
  id: "project-m44",
  title: "四年级科学备课",
  meta: "四年级 · 科学",
  status: "active" as const,
  currentStep: "需求整理",
  currentNodeKey: "requirement_spec" as const,
  grade: "四年级",
  subject: "科学",
  textbookVersion: null,
  lessonTopic: "水的变化",
  lifecycleState: "active" as const,
  lifecycleVersion: 0,
  intentEpoch: 0,
  generationIntensity: "standard" as const,
  archivedAt: null,
  deletedAt: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const noop = () => undefined;
const asyncNoop = async () => undefined;
const asyncEvent = async () => null;
const workbenchProps = {
  project,
  messages: [],
  artifacts: [],
  compact: false,
  loadState: "ready" as const,
  errorMessage: null,
  input: "",
  reference: null,
  artifactRefs: [],
  confirmedActionId: null,
  composerSubmitting: false,
  projectBusy: false,
  executionFeedback: null,
  notice: null,
  composerNotice: null,
  onInputChange: noop,
  onClearReference: noop,
  onAttachFile: noop,
  onAttachFileError: noop,
  onSubmitConversationMessage: asyncNoop,
  onAgentEvent: asyncEvent,
  onAgentStreamError: noop,
  onRecoverCheckpoint: asyncNoop,
  onQuickReplySelect: noop,
  onSetMessageReaction: asyncNoop,
  onRetry: noop,
  onOpenArtifacts: noop,
  onOpenArtifact: noop,
  onOpenMembers: noop,
  onOpenFeedback: noop,
  onOpenUserManagement: noop,
  onLogout: asyncNoop,
  onOpenXiaoKuSettings: noop,
};

describe("M44 runtime UI", () => {
  it("does not mount the static prototype generation panel", () => {
    const markup = renderToStaticMarkup(createElement(ConversationWorkbench, workbenchProps));

    expect(markup).not.toContain("GenerationPanel");
    expect(markup).not.toContain("PPT 页面生成中");
    expect(markup).not.toContain("8 / 12");
  });

  it("renders the active project in the workbench topbar", () => {
    const markup = renderToStaticMarkup(createElement(WorkbenchTopbar, { project }));

    expect(markup).not.toContain("表内乘法（一）");
    expect(markup).not.toContain("已保存 10:24");
    expect(markup).toContain("四年级科学备课");
    expect(markup).toContain("2026-07-20T00:00:00.000Z");
  });
});
