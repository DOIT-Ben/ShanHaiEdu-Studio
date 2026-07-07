export type AuditLogAction =
  | "auth.login"
  | "auth.logout"
  | "project.created"
  | "project.member.changed"
  | "artifact.approved"
  | "generation.started"
  | "download.created";

export type CreateAuditLogEntryInput = {
  actorUserId?: string | null;
  action: AuditLogAction | string;
  targetType: string;
  targetId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
};

const sensitiveMetadataKeys = /token|secret|password|api.?key|credential|authorization|providerresponse|remoteurl|localpath/i;

export function createAuditLogEntry(input: CreateAuditLogEntryInput) {
  return {
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    projectId: input.projectId ?? null,
    metadata: sanitizeAuditMetadata(input.metadata ?? {}),
  };
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, sensitiveMetadataKeys.test(key) ? "[redacted]" : sanitizeMetadataValue(value)]),
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue);
  }
  if (value && typeof value === "object") {
    return sanitizeAuditMetadata(value as Record<string, unknown>);
  }
  return value;
}
