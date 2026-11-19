import type { IncomingMessage, ServerResponse } from 'node:http';
import { readDb, writeDb } from './db.ts';
import { readBody, send } from './http.ts';
import { handleAgentChat, handleAgentStatus } from './agent.ts';

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

let proxyConfigured = false;
// Node 原生 fetch 不读代理环境变量；本机访问 DeepSeek 需要走本地代理。
async function ensureProxy() {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!raw) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(raw.replace(/^socks5h:/, 'socks5:')));
  } catch (err) {
    console.warn('[api] proxy setup failed, using direct connection', err);
  }
}

async function handleAiRecommend(req: IncomingMessage, res: ServerResponse) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return send(res, 503, { error: 'AI_NOT_CONFIGURED' });
  await ensureProxy();

  const body = JSON.parse(await readBody(req) || '{}');
  const { purpose, participants, resources = [], bookings = [], startTime, endTime, requirements = {}, resourceType } = body;
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是办公资源推荐助手。只能从候选资源中选择，不得编造资源 ID。结合用途、人数、时段、设备和位置选择最合适的一项，用一句中文说明理由。只输出 JSON 对象：{"resourceId":"候选资源ID","reason":"推荐理由"}'
          },
          {
            role: 'user',
            content: JSON.stringify({ purpose, participants, startTime, endTime, requirements, resourceType, resources, bookings })
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        stream: false
      })
    });
    if (!response.ok) throw new Error(`DeepSeek request failed with status ${response.status}`);
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!resources.some((resource: any) => resource.id === parsed.resourceId) || typeof parsed.reason !== 'string') {
      return send(res, 502, { error: 'AI_INVALID_RESPONSE' });
    }
    return send(res, 200, { resourceId: parsed.resourceId, reason: parsed.reason });
  } catch (err: any) {
    return send(res, 502, { error: 'AI_UPSTREAM_ERROR', detail: String(err?.message || err) });
  }
}

export function registerApi(middlewares: any) {
  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (!url.startsWith('/api/')) return next();

    try {
      if (url === '/api/db' && req.method === 'GET') {
        return send(res, 200, readDb() || {});
      }

      if (url === '/api/db' && req.method === 'POST') {
        const raw = await readBody(req);
        writeDb(JSON.parse(raw || '{}'));
        return send(res, 200, { ok: true });
      }

      // 服务端原子校验：Node 单线程串行处理，读写之间不会插入其它请求，防止双人同订。
      if (url === '/api/bookings' && req.method === 'POST') {
        const { booking } = JSON.parse(await readBody(req) || '{}');
        if (!booking?.resourceId || !booking?.startTime || !booking?.endTime) {
          return send(res, 400, { error: 'INVALID_BOOKING' });
        }
        const db = readDb() || {};
        const list = db.bookings || [];
        const start = new Date(booking.startTime);
        const end = new Date(booking.endTime);
        const conflicts = list.filter((b: any) =>
          b.resourceId === booking.resourceId
          && (b.status === 'APPROVED' || b.status === 'PENDING')
          && overlaps(start, end, new Date(b.startTime), new Date(b.endTime))
        );
        if (conflicts.length > 0) {
          return send(res, 409, { error: 'CONFLICT', conflicts });
        }
        db.bookings = [booking, ...list];
        writeDb(db);
        return send(res, 201, { booking });
      }

      if (url === '/api/bookings/batch' && req.method === 'POST') {
        const { bookings } = JSON.parse(await readBody(req) || '{}');
        if (!Array.isArray(bookings) || bookings.length === 0 || bookings.some((b: any) => !b?.resourceId || !b?.startTime || !b?.endTime)) {
          return send(res, 400, { error: 'INVALID_BOOKINGS' });
        }
        const db = readDb() || {};
        const list = db.bookings || [];
        const accepted: any[] = [];
        const conflicts: any[] = [];
        bookings.forEach((booking: any, index: number) => {
          const start = new Date(booking.startTime);
          const end = new Date(booking.endTime);
          const overlapping = [...list, ...accepted].filter((b: any) =>
            b.resourceId === booking.resourceId
            && (b.status === 'APPROVED' || b.status === 'PENDING')
            && overlaps(start, end, new Date(b.startTime), new Date(b.endTime))
          );
          if (overlapping.length > 0) conflicts.push({ index, conflicts: overlapping });
          else accepted.push(booking);
        });
        if (conflicts.length > 0) return send(res, 409, { error: 'CONFLICT', conflicts });
        db.bookings = [...bookings, ...list];
        writeDb(db);
        return send(res, 201, { bookings });
      }

      const editMatch = url.match(/^\/api\/bookings\/([^/]+)$/);
      if (editMatch && req.method === 'PUT') {
        const { booking } = JSON.parse(await readBody(req) || '{}');
        const id = decodeURIComponent(editMatch[1]);
        if (!booking?.resourceId || !booking?.startTime || !booking?.endTime) {
          return send(res, 400, { error: 'INVALID_BOOKING' });
        }
        const db = readDb() || {};
        const list = db.bookings || [];
        if (!list.some((b: any) => b.id === id)) return send(res, 404, { error: 'BOOKING_NOT_FOUND' });
        const start = new Date(booking.startTime);
        const end = new Date(booking.endTime);
        const conflicts = list.filter((b: any) => b.id !== id
          && b.resourceId === booking.resourceId
          && (b.status === 'APPROVED' || b.status === 'PENDING')
          && overlaps(start, end, new Date(b.startTime), new Date(b.endTime))
        );
        if (conflicts.length > 0) return send(res, 409, { error: 'CONFLICT', conflicts });
        db.bookings = list.map((b: any) => b.id === id ? { ...booking, id } : b);
        writeDb(db);
        return send(res, 200, { booking: { ...booking, id } });
      }

      if (url === '/api/ai/status' && req.method === 'GET') {
        return send(res, 200, { enabled: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'deepseek' });
      }

      if (url === '/api/ai/recommend' && req.method === 'POST') {
        return await handleAiRecommend(req, res);
      }

      if (url === '/api/agent/status' && req.method === 'GET') {
        return handleAgentStatus(req, res);
      }

      if (url === '/api/agent/chat' && req.method === 'POST') {
        return await handleAgentChat(req, res);
      }

      return send(res, 404, { error: 'NOT_FOUND' });
    } catch (err: any) {
      return send(res, 500, { error: 'INTERNAL', detail: String(err?.message || err) });
    }
  });
}
