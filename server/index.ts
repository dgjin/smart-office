import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './api.ts';
import { closeDbPool, databaseHealth } from './db.ts';
import { securityProfileFor, send, setSecurityHeaders } from './http.ts';
import { METRICS_TOKEN, SERVER_HOST, SERVER_PORT } from './config.ts';
import { startJobWorker, stopJobWorker } from './jobs.ts';
import { logEvent, metricsText, observeRequest, requestIdFor } from './observability.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const serveStatic = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'INVALID_PATH' }); }
  if (pathname.includes('\0')) return send(res, 400, { error: 'INVALID_PATH' });
  let filePath = path.resolve(dist, `.${pathname}`);
  if (filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) return send(res, 403, { error: 'FORBIDDEN' });
  let fileStat = await stat(filePath).catch(() => null);
  if (fileStat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) {
    if (path.extname(pathname)) return send(res, 404, { error: 'NOT_FOUND' });
    filePath = path.join(dist, 'index.html');
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) return send(res, 503, { error: 'CLIENT_BUILD_NOT_FOUND' });
  const body = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeTypes[path.extname(filePath)] || 'application/octet-stream');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=3600');
  res.end(req.method === 'HEAD' ? undefined : body);
};

const metricsAllowed = (req: http.IncomingMessage) => {
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return true;
  if (!METRICS_TOKEN) return false;
  const supplied = String(req.headers.authorization || '');
  const expected = `Bearer ${METRICS_TOKEN}`;
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  // 3D 楼层图与它的 Three.js 依赖走 embedded 档（允许同源内嵌 + 内联脚本），
  // 其余一律 strict。必须在 serveStatic / handleApiRequest 之前定下来。
  setSecurityHeaders(res, securityProfileFor(url.pathname));
  observeRequest(req, res, url.pathname);
  try {
    if (url.pathname === '/livez') return send(res, 200, { ok: true });
    if (url.pathname === '/healthz') {
      await databaseHealth();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/metrics') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      }
      if (!metricsAllowed(req)) return send(res, 403, { error: 'FORBIDDEN' });
      let databaseUp = false;
      try {
        await databaseHealth();
        databaseUp = true;
      } catch {}
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(metricsText(databaseUp));
    }
    if (await handleApiRequest(req, res, url)) return;
    await serveStatic(req, res, url);
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    logEvent('error', 'http.unhandled', { requestId: requestIdFor(req), status, errorName: error?.name, code: error?.code });
    if (!res.writableEnded) send(res, status, { error: status === 503 ? 'UNAVAILABLE' : 'INTERNAL' });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1000;
server.listen(SERVER_PORT, SERVER_HOST, () => {
  logEvent('info', 'server.started', { host: SERVER_HOST, port: SERVER_PORT });
  startJobWorker();
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  server.closeIdleConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await stopJobWorker();
  await closeDbPool();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; });
  });
}
