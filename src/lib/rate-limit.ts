/// Minimal in-memory sliding-window rate limiter (per route+IP).
/// Single-process safe; proxies run one Node process per container.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfterMs: b.resetAt - now };
  return { ok: true, retryAfterMs: 0 };
}

export function rateLimitKey(req: Request, route: string): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : null) || "unknown";
  return `${route}:${ip}`;
}
