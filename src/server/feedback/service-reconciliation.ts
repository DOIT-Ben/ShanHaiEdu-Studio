import type { FeedbackRepository } from "./repository";
import { FeedbackStorage } from "./storage";
import { finalizeFeedbackSubmission } from "./service-shared";

export function createFeedbackReconciliationHandler(input: {
  repository: FeedbackRepository;
  storage: FeedbackStorage;
  now: () => Date;
}) {
  return async function reconcile(reconciliation: {
    owner: string;
    staleAfterMs: number;
    leaseMs: number;
    orphanGraceMs: number;
    limit?: number;
  }) {
    const current = input.now();
    const claimed = await input.repository.claimStaleProcessing({
      owner: reconciliation.owner,
      now: current,
      staleBefore: new Date(current.getTime() - reconciliation.staleAfterMs),
      leaseUntil: new Date(current.getTime() + reconciliation.leaseMs),
      limit: reconciliation.limit ?? 50,
    });
    let cleanupFailures = 0;
    let recoveryFailures = 0;
    for (const record of claimed) {
      let finalExists = false;
      try {
        finalExists = await input.storage.hasFinal(record.id);
        if (!finalExists) {
          if (!await input.storage.hasStaging(record.stagingKey)) {
            await input.repository.markFailed(record.id, "missing_staged_attachments", reconciliation.owner);
            recoveryFailures += 1;
            continue;
          }
          await input.storage.commit(record.stagingKey, record.id);
          finalExists = true;
        }
        if (!await finalizeFeedbackSubmission(input.repository, record.createdByUserId, record, reconciliation.owner)) {
          throw new Error("Feedback reconciliation ownership changed before finalization.");
        }
      } catch {
        recoveryFailures += 1;
        const recoverableFinal = finalExists || await input.storage.hasFinal(record.id).catch(() => true);
        if (!recoverableFinal) {
          await input.repository.markFailed(record.id, "reconciliation_failed", reconciliation.owner).catch(() => false);
          await input.storage.removeStaging(record.stagingKey).catch(() => { cleanupFailures += 1; });
        }
      }
    }

    const orphanCutoff = current.getTime() - reconciliation.orphanGraceMs;
    for (const entry of await input.storage.listStagingEntries()) {
      if (entry.modifiedAt.getTime() <= orphanCutoff && !await input.repository.isStagingReferenced(entry.key)) {
        await input.storage.removeStaging(entry.key).catch(() => { cleanupFailures += 1; });
      }
    }
    for (const entry of await input.storage.listFinalEntries()) {
      if (entry.modifiedAt.getTime() <= orphanCutoff && !await input.repository.isFeedbackReferenced(entry.key)) {
        await input.storage.removeFinal(entry.key).catch(() => { cleanupFailures += 1; });
      }
    }
    return { claimed: claimed.length, cleanupFailures, recoveryFailures };
  };
}
