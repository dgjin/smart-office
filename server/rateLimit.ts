import net from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS, TRUST_PROXY } from './config.ts';
import { send } from './http.ts';
import { recordAuthRateLimited } from './observability.ts';

type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();
const limitedRoutes = new Set(['/api/auth/login', '/api/auth/callback', '/api/auth/dev']);

export const clientIp = (req: IncomingMessage) => {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (net.isIP(forwarded)) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
};

export const enforceAuthRateLimit = (req: IncomingMessage, res: ServerResponse, pathname: string) => {
  if (!limitedRoutes.has(pathname)) return false;
  const now = Date.now();
  const key = `${clientIp(req)}:${pathname}`;
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= AUTH_RATE_LIMIT_MAX) {
    recordAuthRateLimited();
    const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + AUTH_RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    send(res, 429, { error: 'AUTH_RATE_LIMITED' });
    return true;
  }
  bucket.count += 1;
  if (buckets.size > 10_000) {
    for (const [candidate, value] of buckets) {
      if (now - value.startedAt >= AUTH_RATE_LIMIT_WINDOW_MS) buckets.delete(candidate);
    }
    if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value!);
  }
  return false;
};
