import type { ToolObservation } from "@/server/capabilities/tool-observation";
import type { AgentObservation, RunCheckpoint } from "@/server/conversation/react-control";
import type { PersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import type { PendingDecision, TaskBrief } from "@/server/conversation/task-contract";
import type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactStatus,
  ConversationTurnJobRecord,
  GenerationJobRecord,
  ProjectRecord,
} from "@/server/workbench/types";

export type AgentWorldStateArtifact = Pick<
  ArtifactRecord,
  "id" | "nodeKey" | "kind" | "title" | "status" | "summary" | "isApproved" | "version"
> & { downstreamEligible?: boolean };

export type AgentWorldStateBlockedItem = {
  artifactKind: ArtifactKind;
  title: string;
  status: Extract<ArtifactStatus, "blocked" | "failed">;
  reason: string;
};

export type AgentWorldStateFailedJob = {
  id: string;
  kind: string;
  status: "failed";
  attempts: string;
  message: string;
};

export type AgentWorldStatePendingDecision = Pick<
  PendingDecision,
  "decisionId" | "status" | "kind" | "reasonCode" | "question" | "impactSummary"
> & {
  hasActionId: boolean;
};

export type AgentWorldStateRisk = {
  artifactKind: ArtifactKind;
  title: string;
  status: Extract<ArtifactStatus, "stale" | "failed" | "blocked">;
  reason: string;
};

export type AgentWorldStateToolObservation = Pick<
  ToolObservation,
  | "observationId"
  | "capabilityId"
  | "expectedArtifactKind"
  | "kind"
  | "status"
  | "teacherSafeSummary"
  | "internalReasonSanitized"
  | "retryPolicy"
  | "artifactCreated"
  | "createdAt"
>;

export type AgentWorldStateObservation = Pick<
  AgentObservation,
  | "observationId"
  | "source"
  | "status"
  | "actionKey"
  | "inputHash"
  | "reasonCodes"
  | "reportRefs"
  | "targetLocators"
  | "responsibleStage"
  | "minimalNextAction"
  | "teacherSafeSummary"
  | "createdAt"
>;

export type AgentWorldStateAgentToolReport = Pick<
  PersistedAgentToolReport,
  "reportId" | "reportDigest" | "intentEpoch" | "invocationId" | "toolId" | "status" | "assistantSummary" | "structuredOutput" | "policyOutcome" | "createdAt"
>;

export type AgentWorldState = {
  project: Pick<ProjectRecord, "id" | "title" | "grade" | "subject" | "textbookVersion" | "lessonTopic" | "status">;
  trustedInputs: AgentWorldStateArtifact[];
  draftArtifacts: AgentWorldStateArtifact[];
  blockedItems: AgentWorldStateBlockedItem[];
  failedJobs: AgentWorldStateFailedJob[];
  toolObservations: AgentWorldStateToolObservation[];
  agentObservations: AgentWorldStateObservation[];
  agentToolReports?: AgentWorldStateAgentToolReport[];
  runCheckpoint: RunCheckpoint | null;
  pendingDecision: AgentWorldStatePendingDecision | null;
  nextRisks: AgentWorldStateRisk[];
};

export type BuildAgentWorldStateInput = {
  project: ProjectRecord;
  taskBrief: TaskBrief | null;
  taskPlanRevision: number | null;
  artifacts: ArtifactRecord[];
  generationJobs: GenerationJobRecord[];
  turnJobs: ConversationTurnJobRecord[];
  pendingDecision: PendingDecision | null;
  toolObservations?: ToolObservation[];
  agentObservations?: AgentObservation[];
  agentToolReports?: PersistedAgentToolReport[];
  runCheckpoint?: RunCheckpoint | null;
};

const generationJobLabels: Record<GenerationJobRecord["kind"], string> = {
  pptx: "PPTX 文件生成",
  image: "课堂图片生成",
  audio: "视频旁白生成",
  video: "课堂视频生成",
};

const blockedReasonByStatus: Record<"blocked" | "failed", string> = {
  blocked: "这一步暂时无法继续，需要先补充或确认前置材料。",
  failed: "这一步上次没有成功，需要重试或调整后再继续。",
};

export function buildAgentWorldState(input: BuildAgentWorldStateInput): AgentWorldState {
  const scopedArtifacts = input.taskBrief
    ? input.artifacts.filter((artifact) => isArtifactBoundToTask(artifact, input.taskBrief!))
    : input.artifacts;
  const trustedInputs = scopedArtifacts
    .filter(isArtifactTrustedForDownstream)
    .map(toWorldStateArtifact);
  const draftArtifacts = scopedArtifacts
    .filter((artifact) => !isArtifactTrustedForDownstream(artifact))
    .map(toWorldStateArtifact);

  const blockedItems = scopedArtifacts
    .filter((artifact): artifact is ArtifactRecord & { status: "blocked" | "failed" } => artifact.status === "blocked" || artifact.status === "failed")
    .map((artifact) => ({
      artifactKind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      reason: blockedReasonByStatus[artifact.status],
    }));

  const staleRisks = scopedArtifacts
    .filter((artifact): artifact is ArtifactRecord & { status: "stale" } => artifact.status === "stale")
    .map((artifact) => ({
      artifactKind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      reason: "这项成果依赖的上游内容已变化，继续前需要重新核对。",
    }));

  return {
    project: {
      id: input.project.id,
      title: input.project.title,
      grade: input.project.grade,
      subject: input.project.subject,
      textbookVersion: input.project.textbookVersion,
      lessonTopic: input.project.lessonTopic,
      status: input.project.status,
    },
    trustedInputs,
    draftArtifacts,
    blockedItems,
    failedJobs: [
      ...input.generationJobs.filter((job) => job.status === "failed").map(toFailedGenerationJob),
      ...input.turnJobs.filter((job) => job.status === "failed").map(toFailedTurnJob),
    ],
    toolObservations: (input.toolObservations ?? [])
      .filter((observation) => observation.status === "active")
      .map(toWorldStateToolObservation),
    agentObservations: (input.agentObservations ?? [])
      .filter((observation) => observation.projectId === input.project.id)
      .slice(-12)
      .map(toWorldStateObservation),
    agentToolReports: (input.agentToolReports ?? [])
      .filter((report) => report.projectId === input.project.id && report.intentEpoch === (input.project.intentEpoch ?? 0))
      .slice(-8)
      .map((report) => ({
        reportId: report.reportId,
        reportDigest: report.reportDigest,
        intentEpoch: report.intentEpoch,
        invocationId: report.invocationId,
        toolId: report.toolId,
        status: report.status,
        assistantSummary: report.assistantSummary,
        structuredOutput: report.structuredOutput,
        policyOutcome: report.policyOutcome,
        createdAt: report.createdAt,
      })),
    runCheckpoint: resolveCurrentTaskCheckpoint(input),
    pendingDecision: input.pendingDecision?.status === "pending" ? toPendingDecision(input.pendingDecision) : null,
    nextRisks: [...staleRisks, ...blockedItems],
  };
}

function resolveCurrentTaskCheckpoint(input: BuildAgentWorldStateInput): RunCheckpoint | null {
  const checkpoint = input.runCheckpoint;
  if (!checkpoint || !input.taskBrief || input.taskPlanRevision === null ||
      checkpoint.projectId !== input.project.id || checkpoint.planVersion !== input.taskPlanRevision) {
    return null;
  }
  const currentObservationIds = new Set((input.agentObservations ?? []).map((observation) => observation.observationId));
  if (checkpoint.observationRefs.length === 0 ||
      checkpoint.observationRefs.some((observationId) => !currentObservationIds.has(observationId))) {
    return null;
  }
  return checkpoint;
}

function toWorldStateObservation(observation: AgentObservation): AgentWorldStateObservation {
  return {
    observationId: observation.observationId,
    source: observation.source,
    status: observation.status,
    actionKey: observation.actionKey,
    inputHash: observation.inputHash,
    reasonCodes: observation.reasonCodes,
    reportRefs: observation.reportRefs,
    targetLocators: observation.targetLocators,
    responsibleStage: observation.responsibleStage,
    minimalNextAction: observation.minimalNextAction,
    teacherSafeSummary: sanitizeTeacherMessage(observation.teacherSafeSummary) || "这一步的结果需要重新核对。",
    createdAt: observation.createdAt,
  };
}

function toWorldStateArtifact(artifact: ArtifactRecord): AgentWorldStateArtifact {
  return {
    id: artifact.id,
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    status: artifact.status,
    summary: artifact.summary,
    isApproved: artifact.isApproved,
    downstreamEligible: isArtifactTrustedForDownstream(artifact),
    version: artifact.version,
  };
}

function toFailedGenerationJob(job: GenerationJobRecord): AgentWorldStateFailedJob {
  return {
    id: job.id,
    kind: generationJobLabels[job.kind],
    status: "failed",
    attempts: `${job.attempts}/${job.maxAttempts}`,
    message: sanitizeTeacherMessage(job.errorMessage) || "这项材料暂时没有生成成功，请稍后重试或调整后再继续。",
  };
}

function toFailedTurnJob(job: ConversationTurnJobRecord): AgentWorldStateFailedJob {
  return {
    id: job.id,
    kind: "对话处理",
    status: "failed",
    attempts: `${job.attempts}/${job.maxAttempts}`,
    message: sanitizeTeacherMessage(job.errorMessage) || "这轮对话暂时没有处理成功，请重新发送或补充说明。",
  };
}

function toWorldStateToolObservation(observation: ToolObservation): AgentWorldStateToolObservation {
  return {
    observationId: observation.observationId,
    capabilityId: observation.capabilityId,
    expectedArtifactKind: observation.expectedArtifactKind,
    kind: observation.kind,
    status: observation.status,
    teacherSafeSummary: sanitizeTeacherMessage(observation.teacherSafeSummary) || "这一步暂时没有完成，请调整后再继续。",
    internalReasonSanitized: sanitizeTeacherMessage(observation.internalReasonSanitized) || "处理过程遇到问题，请稍后重试或调整后再继续。",
    retryPolicy: observation.retryPolicy,
    artifactCreated: observation.artifactCreated,
    createdAt: observation.createdAt,
  };
}

function toPendingDecision(input: PendingDecision): AgentWorldStatePendingDecision {
  return {
    decisionId: input.decisionId,
    status: input.status,
    kind: input.kind,
    reasonCode: input.reasonCode,
    question: input.question,
    impactSummary: input.impactSummary,
    hasActionId: Boolean(input.actionId.trim()),
  };
}

function sanitizeTeacherMessage(message: string | null): string {
  if (!message) return "";
  const containsSensitiveDetail = /\b(provider|schema|storage|debug|token|manifest|node_id|api|key|secret|credential)\b|[A-Z0-9_]*(?:API_KEY|API_TOKEN|TOKEN|SECRET|KEY|CREDENTIAL)[A-Z0-9_]*|local\s+path|[A-Za-z]:[\\/]|\/(Users|home|tmp|var|private|mnt)\//i.test(message);
  if (containsSensitiveDetail) return "处理过程遇到问题，请稍后重试或调整后再继续。";

  const sanitized = message
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "处理过程遇到问题，请稍后重试或调整后再继续。";
}
