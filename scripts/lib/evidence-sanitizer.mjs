const assignmentLabel = "(?:[A-Za-z0-9]+[_-])*api[_\\s-]?key|(?:[A-Za-z0-9]+[_-])*token|credential|credentials|secret|password|authorization";
const quotedAssignmentPattern = new RegExp(
  `(["'])(${assignmentLabel})\\1\\s*([:=])\\s*(["'])[^"'\\r\\n]*\\4`,
  "gi",
);
const quotedValueAssignmentPattern = new RegExp(
  `\\b(${assignmentLabel})\\b\\s*([:=])\\s*(["'])[^"'\\r\\n]*\\3`,
  "gi",
);
const bareAssignmentPattern = new RegExp(
  `\\b(${assignmentLabel})\\b\\s*([:=])\\s*[^\\s,;)\\]}"']+`,
  "gi",
);
const quotedLocalPathPattern = /(["'])(?:(?:file:\/\/\/?)(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var|private|mnt)\/)|[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var|private|mnt)\/|~[\\/])[^"'\r\n]+\1/gi;
const fileUrlPathPattern = /file:\/\/\/?(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var|private|mnt)\/)[^\s,;)\]}"']+/gi;
const windowsPathWithSpacesPattern = /\b[A-Za-z]:[\\/][^\r\n,;，；。)\]}"']+?\.(?:json|log|txt|md|pdf|pptx|docx|xlsx|png|jpe?g|gif|svg|mp4|zip|sqlite|db|env|tsx?|jsx?|mjs|cjs)\b/gi;
const posixPathWithSpacesPattern = /(?<!:)\/(?:Users|home|root|tmp|var|private|mnt)\/[^\r\n,;，；。)\]}"']+?\.(?:json|log|txt|md|pdf|pptx|docx|xlsx|png|jpe?g|gif|svg|mp4|zip|sqlite|db|env|tsx?|jsx?|mjs|cjs)\b/gi;
const windowsPathPattern = /\b[A-Za-z]:[\\/][^\s,;)\]}"']+/g;
const posixPathPattern = /(?<!:)\/(?:Users|home|root|tmp|var|private|mnt)\/[^\s,;)\]}"']+/g;
const homePathPattern = /(?:^|(?<=\s))~[\\/][^\s,;)\]}"']+/g;
const urlPattern = /\b(?:https?|wss?):\/\/[^\s"'<>),;\]}]+/gi;
const bearerPattern = /\bBearer\s+[^\s,;]+/gi;
const skSecretPattern = /\bsk-[A-Za-z0-9][A-Za-z0-9._-]*/gi;

export function sanitizeEvidenceText(value, options = {}) {
  const maxStringLength = positiveIntegerOrInfinity(options.maxStringLength);
  const sanitized = String(value ?? "")
    .replace(quotedLocalPathPattern, (_match, quote) => `${quote}[redacted-path]${quote}`)
    .replace(fileUrlPathPattern, "[redacted-path]")
    .replace(windowsPathWithSpacesPattern, "[redacted-path]")
    .replace(posixPathWithSpacesPattern, "[redacted-path]")
    .replace(windowsPathPattern, "[redacted-path]")
    .replace(posixPathPattern, "[redacted-path]")
    .replace(homePathPattern, "[redacted-path]")
    .replace(urlPattern, "[redacted-url]")
    .replace(bearerPattern, "[redacted]")
    .replace(quotedAssignmentPattern, (_match, keyQuote, key, separator, valueQuote) => (
      `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[redacted]${valueQuote}`
    ))
    .replace(quotedValueAssignmentPattern, (_match, key, separator, valueQuote) => (
      `${key}${separator}${valueQuote}[redacted]${valueQuote}`
    ))
    .replace(bareAssignmentPattern, (_match, key, separator) => `${key}${separator}[redacted]`)
    .replace(skSecretPattern, "[redacted]");
  return maxStringLength === Infinity ? sanitized : sanitized.slice(0, maxStringLength);
}

export function sanitizeEvidenceValue(value, options = {}) {
  const limits = {
    maxDepth: positiveIntegerOrDefault(options.maxDepth, 32),
    maxArrayItems: positiveIntegerOrInfinity(options.maxArrayItems),
    maxObjectEntries: positiveIntegerOrInfinity(options.maxObjectEntries),
    maxStringLength: positiveIntegerOrInfinity(options.maxStringLength),
  };
  return sanitizeValue(value, limits, 0, new WeakSet());
}

export function sanitizeEvidenceRecord(value, options = {}) {
  if (!isPlainRecord(value)) return null;
  const sanitized = sanitizeEvidenceValue(value, options);
  return isPlainRecord(sanitized) ? sanitized : null;
}

function sanitizeValue(value, limits, depth, ancestors) {
  if (typeof value === "string") {
    return sanitizeEvidenceText(value, { maxStringLength: limits.maxStringLength });
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object") return sanitizeEvidenceText(String(value), { maxStringLength: limits.maxStringLength });
  if (depth >= limits.maxDepth) return "[redacted-depth-limit]";
  if (ancestors.has(value)) return "[redacted-circular]";

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, limits.maxArrayItems)
        .map((item) => sanitizeValue(item, limits, depth + 1, ancestors));
    }

    const entries = Object.entries(value).slice(0, limits.maxObjectEntries);
    return Object.fromEntries(entries.map(([key, item]) => {
      const marker = sensitiveFieldMarker(key);
      if (marker && item !== null && typeof item !== "undefined") return [key, marker];
      return [key, sanitizeValue(item, limits, depth + 1, ancestors)];
    }));
  } finally {
    ancestors.delete(value);
  }
}

function sensitiveFieldMarker(key) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (normalized.endsWith("url")) return "[redacted-url]";
  if (normalized.endsWith("path")) return "[redacted-path]";
  if (
    normalized.endsWith("apikey")
    || normalized.endsWith("token")
    || normalized.endsWith("credential")
    || normalized.endsWith("credentials")
    || normalized.endsWith("secret")
    || normalized.endsWith("password")
    || normalized === "authorization"
  ) {
    return "[redacted]";
  }
  return null;
}

function positiveIntegerOrInfinity(value) {
  return Number.isInteger(value) && value > 0 ? value : Infinity;
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
