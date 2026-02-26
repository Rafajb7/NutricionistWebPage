type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(options.key);

  if (!existing || now > existing.resetAt) {
    buckets.set(options.key, {
      count: 1,
      resetAt: now + options.windowMs
    });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, existing.resetAt - now)
    };
  }

  existing.count += 1;
  buckets.set(options.key, existing);
  return { allowed: true, retryAfterMs: 0 };
}
