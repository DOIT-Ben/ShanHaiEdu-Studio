"use client";

import { useCallback } from "react";
import { getRealAssetGenerationActions, type RealAssetKind } from "@/lib/artifact-real-assets";
import { buildArtifactRegenerationSubmission, resolveArtifactActionKey } from "@/lib/workbench-actions";
import { createWorkbenchApiClient } from "@/lib/workbench-api";
import type { ArtifactItem, PptFullDeckReviewSubmission, PptSampleReviewSubmission } from "@/lib/types";
import type { WorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";
import type { WorkbenchProjectSync } from "@/hooks/useWorkbenchProjectSync";
import type { WorkbenchComposerController } from "@/hooks/useWorkbenchComposerController";

type ArtifactOperationOptions = {
  dataSource: ReturnType<typeof createWorkbenchApiClient>;
  state: WorkbenchProjectState;
  sync: WorkbenchProjectSync;
  composer: WorkbenchComposerController;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setRealAssetGenerationKey: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useWorkbenchArtifactOperations({ dataSource, state, sync, composer, setNotice, setRealAssetGenerationKey }: ArtifactOperationOptions) {
  const confirmArtifact = useCallback(async (item: ArtifactItem) => {
    if (!state.activeProjectId) return;
    const artifactKey = resolveArtifactActionKey(item, "confirm");
    if (!artifactKey) {
      setNotice(`「${item.title}」暂时没有确认成功，请稍后再试。`);
      return;
    }
    try {
      const token = sync.beginSnapshotRequest(state.activeProjectId);
      sync.applySnapshot(await dataSource.approveArtifact(state.activeProjectId, artifactKey), token);
      setNotice(`已确认「${item.title}」，下一步会使用它继续生成。`);
    } catch {
      setNotice(`「${item.title}」暂时没有确认成功，请稍后再试。`);
    }
  }, [dataSource, setNotice, state.activeProjectId, sync]);
  const requestArtifactRegeneration = useCallback(async (item: ArtifactItem) => {
    const submission = buildArtifactRegenerationSubmission(item);
    if (!state.activeProjectId || !submission) {
      setNotice(`「${item.title}」暂时没有开始重做，请稍后再试。`);
      return;
    }
    state.setDetailOpen(false);
    await composer.submitConversationMessage(submission, "artifact_action");
  }, [composer, setNotice, state]);
  const generateRealAsset = useCallback(async (item: ArtifactItem, assetKind: RealAssetKind) => {
    if (!state.activeProjectId || !item.artifactId) {
      setNotice(`「${item.title}」暂时不能生成真实素材，请稍后再试。`);
      return;
    }
    const action = getRealAssetGenerationActions(item).find((candidate) => candidate.kind === assetKind);
    if (!action?.actionId) {
      setNotice(`「${item.title}」暂时不能生成真实素材，请稍后再试。`);
      return;
    }
    setRealAssetGenerationKey(`${item.artifactId}:${assetKind}`);
    try {
      const token = sync.beginSnapshotRequest(state.activeProjectId);
      sync.applySnapshot(await dataSource.generateRealAsset(state.activeProjectId, item.artifactId, assetKind, {
        confirmedActionId: action.actionId,
        ...(action.shotId ? { shotId: action.shotId } : {}),
      }), token);
      setNotice(action.successNotice);
    } catch {
      setNotice(action.failureNotice);
    } finally {
      setRealAssetGenerationKey(null);
    }
  }, [dataSource, setNotice, setRealAssetGenerationKey, state.activeProjectId, sync]);
  const submitPptSampleReview = useCallback(async (item: ArtifactItem, review: PptSampleReviewSubmission) => {
    if (!state.activeProjectId || !item.artifactId) return;
    try {
      const token = sync.beginSnapshotRequest(state.activeProjectId);
      sync.applySnapshot(await dataSource.submitPptSampleReview(state.activeProjectId, item.artifactId, review), token);
      const passed = review.qa.every((entry) => entry.design === "passed" && entry.visual === "passed" && entry.provenance === "passed" && entry.findings.length === 0);
      setNotice(passed ? "样张审查已通过，请确认是否用于后续批量制作。" : "样张问题已记录，可以按页调整后重新审查。");
    } catch {
      setNotice("样张审查暂时没有保存成功，请检查各页结论后重试。");
    }
  }, [dataSource, setNotice, state.activeProjectId, sync]);
  const submitPptFullDeckReview = useCallback(async (item: ArtifactItem, review: PptFullDeckReviewSubmission) => {
    if (!state.activeProjectId || !item.artifactId) return;
    try {
      const token = sync.beginSnapshotRequest(state.activeProjectId);
      sync.applySnapshot(await dataSource.submitPptFullDeckReview(state.activeProjectId, item.artifactId, review), token);
      const passed = review.qa.every((entry) => entry.design === "passed" && entry.visual === "passed" && entry.provenance === "passed" && entry.readability === "passed" && entry.findings.length === 0);
      setNotice(passed ? "完整课件逐页审查已通过，请确认是否进入最终交付。" : "页面问题已记录，可以按页返修后重新审查。");
    } catch {
      setNotice("完整课件审查暂时没有保存成功，请检查逐页结论后重试。");
    }
  }, [dataSource, setNotice, state.activeProjectId, sync]);
  return { confirmArtifact, requestArtifactRegeneration, generateRealAsset, submitPptSampleReview, submitPptFullDeckReview };
}
