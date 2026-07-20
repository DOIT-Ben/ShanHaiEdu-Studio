import type { FeedbackRecordEntity, FeedbackRepository } from "./repository";

export async function finalizeFeedbackSubmission(
  repository: FeedbackRepository,
  actorUserId: string,
  record: FeedbackRecordEntity,
  reconciliationOwner?: string,
) {
  return repository.finalizeSubmitted({
    id: record.id,
    reconciliationOwner,
    actorUserId,
    projectId: record.projectId,
    metadata: {
      category: record.category,
      severity: record.severity,
      attachmentCount: record.attachments.length,
      status: "submitted",
    },
  });
}
