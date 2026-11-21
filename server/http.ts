import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { IS_PRODUCTION } from './config.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const setSecurityHeaders = (res: ServerResponse) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:"
  ].join('; '));
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
};

export const send = (res: ServerResponse, status: number, payload: any) => {
  if (!res.hasHeader('X-Request-Id')) res.setHeader('X-Request-Id', crypto.randomUUID());
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

export const readBody = (req: IncomingMessage, limit = 1024 * 1024) => new Promise<string>((resolve, reject) => {
  const declaredSize = Number(req.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > limit) {
    req.resume();
    reject(new HttpError(413, 'BODY_TOO_LARGE'));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit && !settled) {
      settled = true;
      reject(new HttpError(413, 'BODY_TOO_LARGE'));
      return;
    }
    if (!settled) chunks.push(chunk);
  });
  req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks).toString('utf8')); });
  req.on('aborted', () => {
    if (!settled) {
      settled = true;
      reject(new HttpError(400, 'REQUEST_ABORTED'));
    }
  });
  req.on('error', err => {
    if (!settled) {
      settled = true;
      reject(err);
    }
  });
});

export const readJson = async (req: IncomingMessage, limit?: number) => {
  const raw = await readBody(req, limit);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'INVALID_JSON'); }
};

export const validateWriteRequest = (req: IncomingMessage) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) return;
  const origin = req.headers.origin;
  if (!origin) throw new HttpError(403, 'ORIGIN_REQUIRED');
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { throw new HttpError(403, 'INVALID_ORIGIN'); }
  if (originHost !== req.headers.host) throw new HttpError(403, 'ORIGIN_MISMATCH');
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(String(fetchSite))) throw new HttpError(403, 'CROSS_SITE_REQUEST');
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
};
