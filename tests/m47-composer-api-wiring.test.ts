import { describe, expect, it } from "vitest";
import { getRealAssetGenerationActions } from "@/lib/artifact-real-assets";
import { resolveBoundConfirmationActionId } from "@/hooks/workbench-composer-contracts";
import { submitWorkbenchConversationMessage, type SubmitConversationMessageInput } from "@/hooks/workbench-composer-submission";

function createContext(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ projectId: string; submission: Record<string, unknown> }> = [];
  const messages: Array<Record<string, unknown>> = [];
  const context = {
    dataSource: {
      createProject: async () => ({ project: { id: "project-created" } }),
      listProjects: async () => [],
      submitConversationMessage: async (projectId: string, submission: Record<string, unknown>) => {
        calls.push({ projectId, submission });
        return { project: { id: projectId } };
      },
    },
    activeProjectId: "",
    projectBusy: false,
    composerSubmitting: false,
    composerSubmittingRef: { current: false },
    pendingConfirmationActionId: "action-1",
    input: "确认生成",
    xiaokuResponseStyle: "pragmatic",
    messageIdempotencyRef: { current: new Map<string, string>() },
    beginSnapshotRequest: () => ({ projectId: "project-created", requestId: "snapshot-1" }),
    applySnapshot: () => true,
    createProjectForSubmission: async () => ({ projectId: "project-created", snapshotRequest: { projectId: "project-created", requestId: "snapshot-1" } }),
    appendMessage: (message: Record<string, unknown>) => messages.push(message),
    removeMessage: () => undefined,
    clearComposer: () => undefined,
    setInput: () => undefined,
    setPendingConfirmationActionId: () => undefined,
    setReference: () => undefined,
    setComposerArtifactRefs: () => undefined,
    setComposerSubmitting: () => undefined,
    flashComposerNotice: () => undefined,
    calls,
    messages,
    ...overrides,
  } as unknown as Parameters<typeof submitWorkbenchConversationMessage>[0] & { calls: typeof calls; messages: typeof messages };
  return context;
}

describe("M47 composer runtime wiring", () => {
  it("creates a project before sending the first prompt and forwards an idempotent request", async () => {
    const context = createContext();
    const submission: SubmitConversationMessageInput = { body: "确认生成", reference: null, artifactRefs: [] };

    await submitWorkbenchConversationMessage(context, submission);

    expect(context.calls).toHaveLength(1);
    expect(context.calls[0]).toMatchObject({ projectId: "project-created", submission: { body: "确认生成", responseStyle: "pragmatic" } });
    expect(context.calls[0].submission.idempotencyKey).toEqual(expect.any(String));
    expect(context.messages.some((message) => message.speaker === "teacher")).toBe(true);
  });

  it("forwards only a confirmation action bound to the pending prompt", async () => {
    const context = createContext({ activeProjectId: "project-a" });

    await submitWorkbenchConversationMessage(context, { body: "确认生成", reference: null, artifactRefs: [], confirmedActionId: "action-1" });
    expect(context.calls[0].submission.confirmedActionId).toBe("action-1");
    expect(resolveBoundConfirmationActionId({ pendingActionId: "action-1", submittedActionId: "action-1", submittedBody: "确认生成", boundBody: "确认生成" })).toBe("action-1");
    expect(resolveBoundConfirmationActionId({ pendingActionId: "action-1", submittedActionId: "action-1", submittedBody: "确认生成吧", boundBody: "确认生成" })).toBeNull();
  });

  it("exposes only server-issued real asset actions, including a bound video shot", () => {
    const video = getRealAssetGenerationActions({
      artifactId: "artifact-video",
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      status: "approved",
      routeGenerationActions: { video_segment_generate: { actionId: "action-video", shotId: "shot_intro" } },
    } as never);
    const invalid = getRealAssetGenerationActions({
      artifactId: "artifact-video",
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      status: "approved",
      routeGenerationActions: { video_segment_generate: { actionId: "action-video" } },
    } as never);

    expect(video).toMatchObject([{ kind: "video", actionId: "action-video", shotId: "shot_intro" }]);
    expect(invalid).toEqual([]);
  });
});
