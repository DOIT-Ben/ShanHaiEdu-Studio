export type V1_9OrchestrationAuthoritySubject = {
  projectId: string;
  actorUserId: string;
  taskId: string | null;
  taskBriefDigest: string | null;
  intentEpoch: number;
  teacherMessageId: string | null;
  turnJobId: string | null;
  planId: string | null;
  planRevision: number | null;
};

export type V1_9OrchestrationAuthoritySummary = {
  schemaVersion: "orchestration-authority-summary.v1";
  subject: V1_9OrchestrationAuthoritySubject;
  windowStartSequence: number;
  watermark: number;
  eventCount: number;
  attemptCount: number;
  resolvedCount: number;
  openAttemptCount: number;
  toolClaimCount: number;
  toolTerminalCount: number;
  mainAgentToolCount: number;
  nonMainAgentToolCount: number;
  firstToolOrdinal: number | null;
  lastToolOrdinal: number | null;
  toolOrdinalsContiguous: boolean;
  authorities: readonly string[];
  violationReasonCodes: readonly string[];
  factsDigest: string;
  complete: boolean;
  readyEligible: boolean;
  summaryDigest: string;
};

export function normalizeV1_9OrchestrationAuthoritySummary(value: unknown): V1_9OrchestrationAuthoritySummary;
export function normalizeV1_9OrchestrationAuthoritySubject(value: unknown): V1_9OrchestrationAuthoritySubject & {
  taskId: string;
  taskBriefDigest: string;
  teacherMessageId: string;
  turnJobId: string;
  planId: string;
  planRevision: number;
};
export function assertV1_9OrchestrationAuthorityProjection(input: {
  actual: unknown;
  projected?: unknown;
  expectedSubject: unknown;
  requireReady?: boolean;
}): V1_9OrchestrationAuthoritySummary;
