export type MessageIdempotencyKeyStore = {
  current: Map<string, string>;
};

export function buildClientMessageSignature(
  projectId: string,
  body: string,
  reference: string | null,
  confirmationActionId: string | null,
  responseStyle = "pragmatic",
  artifactRefs: string[] = [],
) {
  return JSON.stringify({
    projectId,
    body,
    reference: reference ?? "",
    artifactRefs: [...artifactRefs].sort(),
    confirmationActionId: confirmationActionId ?? "",
    responseStyle,
  });
}

export function getRetrySafeMessageIdempotencyKey(store: MessageIdempotencyKeyStore, signature: string) {
  const existing = store.current.get(signature);
  if (existing) return existing;
  const key = buildClientMessageIdempotencyKey(signature);
  store.current.set(signature, key);
  return key;
}

export function clearRetrySafeMessageIdempotencyKey(store: MessageIdempotencyKeyStore, signature: string) {
  store.current.delete(signature);
}

function buildClientMessageIdempotencyKey(signature: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `message:${randomPart}:${signature.length}`;
}
