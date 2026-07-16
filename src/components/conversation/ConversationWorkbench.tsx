"use client";

import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState } from "@/lib/types";
import { WorkbenchTopbar } from "@/components/conversation/WorkbenchTopbar";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import type { WorkbenchExecutionFeedback } from "@/lib/workbench-execution-feedback";
import { generationIntensityLabel } from "@/lib/generation-intensity";
import { ShanHaiAssistantRuntime } from "@/components/conversation/assistant-ui/ShanHaiAssistantRuntime";
import type { SubmitConversationMessageInput } from "@/hooks/useWorkbenchController";
import type { TeacherAgentEvent } from "@/lib/teacher-agent-events";

type ConversationWorkbenchProps = {
  project: ProjectItem | null;
  currentUser?: PasswordAuthUser | null;
  messages: ChatMessage[];
  artifacts: ArtifactItem[];
  compact: boolean;
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  input: string;
  reference: string | null;
  artifactRefs: string[];
  confirmedActionId: string | null;
  composerSubmitting: boolean;
  projectBusy: boolean;
  executionFeedback: WorkbenchExecutionFeedback | null;
  notice: string | null;
  composerNotice: string | null;
  onInputChange: (value: string) => void;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onSubmitConversationMessage: (submission: SubmitConversationMessageInput) => Promise<void>;
  onAgentEvent: (event: TeacherAgentEvent) => Promise<number | null>;
  onAgentStreamError: () => void | Promise<void>;
  onRecoverCheckpoint: (checkpointId: string) => void | Promise<void>;
  onQuickReplySelect?: (value: string, actionId?: string) => void;
  onSetMessageReaction?: (messageId: string, value: ChatMessage["reaction"] | null) => void | Promise<void>;
  onRetry: () => void;
  onOpenArtifacts: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onOpenMembers?: () => void;
  onOpenFeedback: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
  onOpenXiaoKuSettings?: () => void;
};

export function ConversationWorkbench({
  project,
  currentUser,
  messages,
  artifacts,
  compact,
  loadState,
  errorMessage,
  input,
  reference,
  artifactRefs,
  confirmedActionId,
  composerSubmitting,
  projectBusy,
  executionFeedback,
  notice,
  composerNotice,
  onInputChange,
  onClearReference,
  onAttachFile,
  onAttachFileError,
  onSubmitConversationMessage,
  onAgentEvent,
  onAgentStreamError,
  onRecoverCheckpoint,
  onQuickReplySelect,
  onSetMessageReaction,
  onRetry,
  onOpenArtifacts,
  onOpenArtifact,
  onOpenMembers,
  onOpenFeedback,
  onOpenUserManagement,
  onLogout,
  onOpenXiaoKuSettings,
}: ConversationWorkbenchProps) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-card">
      <WorkbenchTopbar
        project={project}
        currentUser={currentUser}
        compact={compact}
        onOpenArtifacts={onOpenArtifacts}
        onOpenMembers={onOpenMembers}
        onOpenFeedback={onOpenFeedback}
        onOpenUserManagement={onOpenUserManagement}
        onLogout={onLogout}
        onOpenXiaoKuSettings={onOpenXiaoKuSettings}
      />
      <ShanHaiAssistantRuntime
        projectId={project?.id ?? ""}
        messages={messages}
        artifacts={artifacts}
        input={input}
        reference={reference}
        artifactRefs={artifactRefs}
        confirmedActionId={confirmedActionId}
        loadState={loadState}
        errorMessage={errorMessage}
        projectBusy={projectBusy}
        composerSubmitting={composerSubmitting}
        executionFeedback={executionFeedback}
        notice={notice}
        composerNotice={composerNotice}
        generationIntensityLabel={generationIntensityLabel(project?.generationIntensity)}
        submitConversationMessage={onSubmitConversationMessage}
        onAgentEvent={onAgentEvent}
        onAgentStreamError={onAgentStreamError}
        onClearReference={onClearReference}
        onAttachFile={onAttachFile}
        onAttachFileError={onAttachFileError}
        onSelectAction={onQuickReplySelect ?? onInputChange}
        onRecoverCheckpoint={onRecoverCheckpoint}
        onOpenArtifact={onOpenArtifact}
        onRetry={onRetry}
        onOpenFeedback={onOpenFeedback}
        onSetMessageReaction={onSetMessageReaction}
        onOpenSettings={onOpenXiaoKuSettings}
      />
    </main>
  );
}
