export type RateLimitInput = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();
const maxBuckets = 10_000;

export function checkRateLimit(input: RateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.floor(input.limit));
  const windowMs = Math.max(1, Math.floor(input.windowMs));
  const bucketKey = `${input.scope}:${input.key}`;
  let bucket = buckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    buckets.delete(bucketKey);
    while (buckets.size >= maxBuckets) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, bucket);
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: 0,
  };
}

export function rateLimitKeyFromRequest(request: Request) {
  if (process.env.SHANHAI_TRUST_PROXY !== "1") return "unknown-client";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return normalizeRateLimitKey(forwarded || realIp || "unknown-client");
}

export function resetRateLimit(input: { scope: string; key: string }) {
  buckets.delete(`${input.scope}:${input.key}`);
}

export function resetRateLimits() {
  buckets.clear();
}

function normalizeRateLimitKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.:_-]/g, "_").slice(0, 160) || "unknown-client";
}
