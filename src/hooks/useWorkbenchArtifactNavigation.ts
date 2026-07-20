"use client";

import { useCallback } from "react";
import { artifactText } from "@/lib/workbench-api";
import type { ArtifactItem } from "@/lib/types";
import type { WorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";
import type { WorkbenchComposerController } from "@/hooks/useWorkbenchComposerController";

type NavigationOptions = {
  state: WorkbenchProjectState;
  composer: WorkbenchComposerController;
  setPendingConfirmationActionId: React.Dispatch<React.SetStateAction<string | null>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
};

export type WorkbenchArtifactNavigation = {
  openDetail: (item: ArtifactItem) => void;
  openSidePanel: (item: ArtifactItem) => void;
  copyArtifact: (item: ArtifactItem) => Promise<boolean>;
  useAsInput: (item: ArtifactItem) => void;
  showRecovery: () => void;
};

export function useWorkbenchArtifactNavigation({ state, composer, setPendingConfirmationActionId, setNotice }: NavigationOptions): WorkbenchArtifactNavigation {
  const openDetail = useCallback((item: ArtifactItem) => {
    state.setDetailItem(item);
    state.setDetailOpen(true);
  }, [state]);
  const openSidePanel = useCallback((item: ArtifactItem) => {
    if (state.sidePanelOpen && state.sidePanelItem?.key === item.key) {
      state.setSidePanelOpen(false);
      return;
    }
    state.setSidePanelItem(item);
    state.setSidePanelOpen(true);
  }, [state]);
  const copyArtifact = useCallback(async (item: ArtifactItem) => {
    try {
      await navigator.clipboard.writeText(artifactText(item));
      setNotice(`已复制「${item.title}」关键内容。`);
      return true;
    } catch {
      setNotice(`复制没有成功，请打开「${item.title}」详情后手动选择内容。`);
      return false;
    }
  }, [setNotice]);
  const useAsInput = useCallback((item: ArtifactItem) => {
    state.setRailOpen(false);
    state.setSidePanelOpen(false);
    state.setDetailOpen(false);
    setPendingConfirmationActionId(null);
    composer.setReference(`${item.title}：${item.summary}`);
    composer.setComposerArtifactRefs(item.artifactId ? [item.artifactId] : []);
    composer.setInput((current) => (current ? `${current}\n\n请基于：${artifactText(item)}` : `请基于：${artifactText(item)}`));
    setNotice(`已把「${item.title}」插入为下一步输入。`);
    composer.flashComposerNotice("已插入为下一步输入。");
  }, [composer, setNotice, setPendingConfirmationActionId, state]);
  const showRecovery = useCallback(() => {
    const blocked = state.artifacts.find((item) => item.key === "video-storyboard");
    if (blocked) openDetail(blocked);
    setNotice("失败恢复示例已打开：旧内容会保留，并提示下一步能做什么。");
  }, [openDetail, setNotice, state.artifacts]);
  return { openDetail, openSidePanel, copyArtifact, useAsInput, showRecovery };
}
