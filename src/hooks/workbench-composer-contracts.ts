export function resolveBoundConfirmationActionId(input: {
  submittedActionId?: string;
  pendingActionId: string | null;
  submittedBody: string;
  boundBody: string;
}) {
  const submittedActionId = input.submittedActionId?.trim() || null;
  if (!submittedActionId || submittedActionId !== input.pendingActionId?.trim()) return null;
  return input.submittedBody.trim() === input.boundBody.trim() ? submittedActionId : null;
}
