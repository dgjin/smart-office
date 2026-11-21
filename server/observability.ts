import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const observedRequests = new WeakSet<IncomingMessage>();
const requestIds = new WeakMap<IncomingMessage, string>();
const statusCounts = new Map<number, number>();
const startedAt = Date.now();
let requestsTotal = 0;
let requestsInFlight = 0;
let requestDurationMs = 0;
let requestDurationMaxMs = 0;
let authRateLimitedTotal = 0;

const sanitize = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[TRUNCATED]';
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
      key,
      /password|passwd|secret|token|cookie|authorization|api[-_]?key|credential/i.test(key)
        ? '[REDACTED]'
        : sanitize(item, depth + 1)
    ]));
  }
  return value;
};

export const logEvent = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) => {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, sanitize(value)]))
  });
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
};

export const requestIdFor = (req: IncomingMessage) => requestIds.get(req);

export const observeRequest = (req: IncomingMessage, res: ServerResponse, pathname: string) => {
  let requestId = requestIds.get(req);
  if (!requestId) {
    const incoming = String(req.headers['x-request-id'] || '');
    requestId = /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    requestIds.set(req, requestId);
  }
  res.setHeader('X-Request-Id', requestId);
  if (observedRequests.has(req)) return requestId;
  observedRequests.add(req);
  requestsInFlight += 1;
  const started = performance.now();
  let completed = false;
  const complete = (aborted: boolean) => {
    if (completed) return;
    completed = true;
    const durationMs = performance.now() - started;
    const status = aborted && !res.writableEnded ? 499 : res.statusCode;
    requestsTotal += 1;
    requestsInFlight -= 1;
    requestDurationMs += durationMs;
    requestDurationMaxMs = Math.max(requestDurationMaxMs, durationMs);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    logEvent(status >= 500 ? 'error' : 'info', 'http.request', {
      requestId,
      method: req.method,
      pathname,
      status,
      durationMs: Math.round(durationMs * 100) / 100
    });
  };
  res.once('finish', () => complete(false));
  res.once('close', () => complete(true));
  return requestId;
};

export const recordAuthRateLimited = () => {
  authRateLimitedTotal += 1;
};

export const metricsText = (databaseUp: boolean) => {
  const lines = [
    '# HELP smart_office_uptime_seconds Node process uptime.',
    '# TYPE smart_office_uptime_seconds gauge',
    `smart_office_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    '# HELP smart_office_database_up Whether the database readiness check succeeds.',
    '# TYPE smart_office_database_up gauge',
    `smart_office_database_up ${databaseUp ? 1 : 0}`,
    '# HELP smart_office_http_requests_total Completed HTTP requests.',
    '# TYPE smart_office_http_requests_total counter',
    `smart_office_http_requests_total ${requestsTotal}`,
    '# HELP smart_office_http_in_flight Current HTTP requests.',
    '# TYPE smart_office_http_in_flight gauge',
    `smart_office_http_in_flight ${requestsInFlight}`,
    '# HELP smart_office_http_request_duration_seconds Request duration summary.',
    '# TYPE smart_office_http_request_duration_seconds summary',
    `smart_office_http_request_duration_seconds_count ${requestsTotal}`,
    `smart_office_http_request_duration_seconds_sum ${requestDurationMs / 1000}`,
    '# HELP smart_office_http_request_duration_max_seconds Maximum observed request duration.',
    '# TYPE smart_office_http_request_duration_max_seconds gauge',
    `smart_office_http_request_duration_max_seconds ${requestDurationMaxMs / 1000}`,
    '# HELP smart_office_auth_rate_limited_total Rejected authentication attempts.',
    '# TYPE smart_office_auth_rate_limited_total counter',
    `smart_office_auth_rate_limited_total ${authRateLimitedTotal}`,
    '# HELP smart_office_http_responses_total HTTP responses by status code.',
    '# TYPE smart_office_http_responses_total counter'
  ];
  for (const [status, count] of [...statusCounts.entries()].sort(([left], [right]) => left - right)) {
    lines.push(`smart_office_http_responses_total{status="${status}"} ${count}`);
  }
  return `${lines.join('\n')}\n`;
};
