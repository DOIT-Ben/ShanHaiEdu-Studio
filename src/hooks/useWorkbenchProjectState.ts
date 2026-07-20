"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ArtifactItem, ChatMessage, ConversationTurnJob, ProjectItem, ProjectLifecycleState, WorkbenchLoadState } from "@/lib/types";
import type { ProjectSnapshotCommitToken } from "@/lib/project-agent-event-sync";

export type SnapshotCommitWatermark = {
  begin: (projectId: string) => ProjectSnapshotCommitToken;
  commit: (snapshot: import("@/lib/types").WorkbenchSnapshot, token: ProjectSnapshotCommitToken) => boolean;
};

export type EventSnapshotCoordinator = {
  request: (input: { projectId: string; requiredSequence: number }) => Promise<number | null>;
};

export type WorkbenchProjectState = {
  projects: ProjectItem[];
  setProjects: Dispatch<SetStateAction<ProjectItem[]>>;
  projectView: ProjectLifecycleState;
  setProjectView: Dispatch<SetStateAction<ProjectLifecycleState>>;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  activeProjectId: string;
  setActiveProjectId: Dispatch<SetStateAction<string>>;
  loadState: WorkbenchLoadState;
  setLoadState: Dispatch<SetStateAction<WorkbenchLoadState>>;
  errorMessage: string | null;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  turnJobs: ConversationTurnJob[];
  setTurnJobs: Dispatch<SetStateAction<ConversationTurnJob[]>>;
  artifacts: ArtifactItem[];
  setArtifacts: Dispatch<SetStateAction<ArtifactItem[]>>;
  activeArtifactKey: string;
  setActiveArtifactKey: Dispatch<SetStateAction<string>>;
  detailItem: ArtifactItem | null;
  setDetailItem: Dispatch<SetStateAction<ArtifactItem | null>>;
  detailOpen: boolean;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  railOpen: boolean;
  setRailOpen: Dispatch<SetStateAction<boolean>>;
  sidePanelItem: ArtifactItem | null;
  setSidePanelItem: Dispatch<SetStateAction<ArtifactItem | null>>;
  sidePanelOpen: boolean;
  setSidePanelOpen: Dispatch<SetStateAction<boolean>>;
  activeProject: ProjectItem | null;
  activeArtifact: ArtifactItem | null;
  projectBusy: boolean;
  activeProjectIdRef: React.MutableRefObject<string>;
  snapshotCommitWatermarkRef: React.MutableRefObject<SnapshotCommitWatermark | null>;
  eventSnapshotCoordinatorRef: React.MutableRefObject<EventSnapshotCoordinator | null>;
};

function hasPendingTurnStatus(status?: ChatMessage["turnStatus"] | ConversationTurnJob["status"]) {
  return status === "queued" || status === "running";
}

export function snapshotHasPendingTurn(snapshot: import("@/lib/types").WorkbenchSnapshot) {
  return snapshot.turnJobs.some((job) => hasPendingTurnStatus(job.status))
    || snapshot.messages.some((message) => hasPendingTurnStatus(message.turnStatus));
}

export function useWorkbenchProjectState(): WorkbenchProjectState {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectView, setProjectView] = useState<ProjectLifecycleState>("active");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [loadState, setLoadState] = useState<WorkbenchLoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turnJobs, setTurnJobs] = useState<ConversationTurnJob[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [activeArtifactKey, setActiveArtifactKey] = useState("");
  const [detailItem, setDetailItem] = useState<ArtifactItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidePanelItem, setSidePanelItem] = useState<ArtifactItem | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const activeProjectIdRef = useRef("");
  const snapshotCommitWatermarkRef = useRef<SnapshotCommitWatermark | null>(null);
  const eventSnapshotCoordinatorRef = useRef<EventSnapshotCoordinator | null>(null);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const activeArtifact = useMemo(
    () => artifacts.find((item) => item.key === activeArtifactKey) ?? artifacts[0] ?? null,
    [activeArtifactKey, artifacts],
  );
  const projectBusy = useMemo(
    () => turnJobs.some((job) => hasPendingTurnStatus(job.status))
      || messages.some((message) => hasPendingTurnStatus(message.turnStatus)),
    [messages, turnJobs],
  );

  return {
    projects, setProjects, projectView, setProjectView, messages, setMessages,
    activeProjectId, setActiveProjectId, loadState, setLoadState, errorMessage, setErrorMessage,
    turnJobs, setTurnJobs, artifacts, setArtifacts, activeArtifactKey, setActiveArtifactKey,
    detailItem, setDetailItem, detailOpen, setDetailOpen, railOpen, setRailOpen,
    sidePanelItem, setSidePanelItem, sidePanelOpen, setSidePanelOpen,
    activeProject, activeArtifact, projectBusy, activeProjectIdRef,
    snapshotCommitWatermarkRef, eventSnapshotCoordinatorRef,
  };
}
