import type { ArtifactRecord, ConversationMessageRecord, ProjectRecord, WorkflowNodeRecord } from "@/server/workbench/types";
import type { SummaryValidationResult } from "./summary-validator";

export type ContextPackageMode = "full" | "snapshot" | "fallback";

export type ContextPackage = {
  mode: ContextPackageMode;
  project: Pick<ProjectRecord, "id" | "title" | "grade" | "subject" | "textbookVersion" | "lessonTopic" | "currentNodeKey">;
  workflowNodes: Pick<WorkflowNodeRecord, "key" | "title" | "status" | "approvedArtifactId" | "staleReason">[];
  sessionSummary?: string;
  recentMessages: Pick<ConversationMessageRecord, "id" | "role" | "content" | "artifactRefs" | "createdAt">[];
  artifacts: Pick<ArtifactRecord, "id" | "nodeKey" | "kind" | "title" | "status" | "summary" | "isApproved" | "version">[];
  guardrails: string[];
  summaryValidation: SummaryValidationResult;
  tokenEstimate: number;
};
