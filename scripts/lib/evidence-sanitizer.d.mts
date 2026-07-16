export type EvidenceSanitizerOptions = {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectEntries?: number;
  maxStringLength?: number;
};

export function sanitizeEvidenceText(value: unknown, options?: EvidenceSanitizerOptions): string;
export function sanitizeEvidenceValue(value: unknown, options?: EvidenceSanitizerOptions): unknown;
export function sanitizeEvidenceRecord(
  value: unknown,
  options?: EvidenceSanitizerOptions,
): Record<string, unknown> | null;
