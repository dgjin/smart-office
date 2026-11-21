import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

type RecordedRequest = {
  path: string;
  authorization?: string;
  idempotencyKey?: string;
  body: any;
};

class FakeExternalMessages {
  private server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = req.url || '';
    this.requests.push({
      path,
      authorization: req.headers.authorization,
      idempotencyKey: String(req.headers['idempotency-key'] || ''),
      body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
    });
    const messageId = this.requests[this.requests.length - 1].body.messageId;
    if (this.failNext.has(messageId)) {
      this.failNext.delete(messageId);
      res.writeHead(503).end();
      return;
    }
    if (this.delays.has(messageId)) await new Promise(resolve => setTimeout(resolve, this.delays.get(messageId)));
    res.writeHead(this.statuses.get(messageId) || 200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  private failNext = new Set<string>();
  private statuses = new Map<string, number>();
  private delays = new Map<string, number>();
  requests: RecordedRequest[] = [];
  baseUrl = '';

  async start() {
    await new Promise<void>((resolve, reject) => this.server.listen(0, '127.0.0.1', resolve).once('error', reject));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }

  failOnce(messageId: string) { this.failNext.add(messageId); }
  setStatus(messageId: string, status: number) { this.statuses.set(messageId, status); }
  setDelay(messageId: string, delay: number) { this.delays.set(messageId, delay); }
}

const fake = new FakeExternalMessages();
const server = new TestServer();
let requester: Awaited<ReturnType<TestServer['login']>>;
let approver: Awaited<ReturnType<TestServer['login']>>;
let security: Awaited<ReturnType<TestServer['login']>>;
let admin: Awaited<ReturnType<TestServer['login']>>;
let bookingSequence = 0;

const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待外部消息 Outbox 处理超时');
};

const approve = async (session: Awaited<ReturnType<TestServer['login']>>, bookingId: string) => {
  const response = await server.request('/api/agent/action', {
    method: 'POST', headers: { Cookie: session.cookie }, body: JSON.stringify({
      action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: '隔离测试核准', summary: '核准' }
    })
  });
  assert.equal(response.status, 200, await response.clone().text());
};

const insertOutbox = async (eventKey: string, eventType: string, payload: unknown, maxAttempts = 3) => {
  await queryTestDb(`INSERT INTO outbox_events (id, event_key, event_type, payload, max_attempts)
    VALUES (?, ?, ?, ?, ?)`, [crypto.randomUUID(), eventKey, eventType, JSON.stringify(payload), maxAttempts]);
};

const readOutbox = async (eventKey: string) => {
  const rows = await queryTestDb<any[]>('SELECT * FROM outbox_events WHERE event_key = ?', [eventKey]);
  assert.equal(rows.length, 1);
  return rows[0];
};

const createConfidentialBooking = async (purpose: string) => {
  const start = new Date(Date.now() + (20 + bookingSequence++) * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  const response = await server.request('/api/bookings', {
    method: 'POST', headers: { Cookie: requester.cookie }, body: JSON.stringify({
      booking: {
        id: crypto.randomUUID(), resourceId: 'r1', type: 'ROOM', startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 3600000).toISOString(), purpose, participants: 1,
        meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', attendeeIds: [],
        status: 'PENDING', createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: []
      }
    })
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json() as any).booking as Booking;
};

describe('MRP7 外部消息适配器隔离验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    const whitelist = [{
      id: 'external-message-whitelist-3', userId: '3', reason: '隔离测试涉密授权',
      createdAt: new Date().toISOString(), createdBy: '1'
    }];
    await queryTestDb("UPDATE office_state SET payload = ? WHERE state_key = 'confidentialWhitelist'", [JSON.stringify(whitelist)]);
    const userRows = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'users'");
    const users = typeof userRows[0].payload === 'string' ? JSON.parse(userRows[0].payload) : userRows[0].payload;
    const mappedUsers = users.map((user: any) => user.id === '3' ? { ...user, externalId: 'HR-3', directorySource: 'TEST_HR' } : user);
    mappedUsers.push({
      id: 'external-security', name: '隔离保密审批人', email: 'external-security@company.com', mobile: '13800000004',
      role: ['SECURITY_ADMIN'], department: '行政部', landline: '010-88880000'
    });
    await queryTestDb("UPDATE office_state SET payload = ? WHERE state_key = 'users'", [JSON.stringify(mappedUsers)]);
    await fake.start();
    await server.start({
      SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000',
      SMART_OFFICE_EXTERNAL_HTTP_TIMEOUT_MS: '100',
      SMART_OFFICE_WECOM_ENABLED: 'true', SMART_OFFICE_WECOM_URL: `${fake.baseUrl}/wecom`, SMART_OFFICE_WECOM_AUTH_TOKEN: 'test-wecom-token',
      SMART_OFFICE_SMS_ENABLED: 'true', SMART_OFFICE_SMS_URL: `${fake.baseUrl}/sms`, SMART_OFFICE_SMS_AUTH_TOKEN: 'test-sms-token',
      SMART_OFFICE_EMAIL_ENABLED: 'true', SMART_OFFICE_EMAIL_URL: `${fake.baseUrl}/email`, SMART_OFFICE_EMAIL_AUTH_TOKEN: 'test-email-token'
    });
    [requester, approver, security, admin] = await Promise.all([
      server.login('3'), server.login('2'), server.login('external-security'), server.login('1')
    ]);
  });

  after(async () => {
    await server.stop();
    await fake.stop();
  });

  it('涉密预约只外发通用提醒，企业微信和邮件成功且应用内通知与 ICS 不受影响', async () => {
    const secret = '绝密项目XYZ不得外发';
    const booking = await createConfidentialBooking(secret);
    await waitFor(async () => fake.requests.some(item => item.path === '/wecom' && item.body.title === '预约申请已提交' && item.body.recipient === 'HR-3')
      && fake.requests.some(item => item.path === '/email' && item.body.title === '预约申请已提交' && item.body.recipient === 'li@company.com'));
    const delivered = fake.requests.filter(item => item.body.title === '预约申请已提交' && ['HR-3', 'li@company.com'].includes(item.body.recipient));
    assert.equal(delivered.length, 2);
    for (const request of delivered) {
      assert.equal(request.body.content, '您有一条「预约申请已提交」提醒，请登录智慧办公系统查看详情。');
      assert.ok(!JSON.stringify(request.body).includes(secret));
      assert.ok(!JSON.stringify(request.body).includes('Alpha 战略会议室'));
      assert.equal(request.authorization, `Bearer test-${request.body.channel.toLowerCase()}-token`);
      assert.equal(request.idempotencyKey, `external-notification:${request.body.channel}:${request.body.messageId}`);
      const stored = await readOutbox(request.idempotencyKey!);
      assert.equal(stored.status, 'DONE');
      const payload = typeof stored.payload === 'string' ? JSON.parse(stored.payload) : stored.payload;
      assert.ok(!('content' in payload));
      assert.ok(!JSON.stringify(payload).includes(secret));
    }
    assert.ok(!fake.requests.some(item => item.path === '/sms' && item.body.title === '预约申请已提交'));
    const notices = await queryTestDb<any[]>("SELECT id FROM notifications WHERE user_id = '3' AND title = '预约申请已提交'");
    assert.equal(notices.length, 1);
    await approve(approver, booking.id);
    await approve(security, booking.id);
    await approve(admin, booking.id);
    const ics = await server.request(`/api/bookings/${booking.id}/ics`, { headers: { Cookie: requester.cookie } });
    assert.equal(ics.status, 200, await ics.clone().text());
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
  });

  it('临时故障按相同幂等键重试，成功后不重复投递', async () => {
    const id = `external-retry-${crypto.randomUUID()}`;
    fake.failOnce(id);
    const eventKey = `external-notification:WECOM:${id}`;
    await insertOutbox(eventKey, 'EXTERNAL_NOTIFICATION', {
      notificationId: id, channel: 'WECOM', recipient: 'HR-3', title: '重试测试',
      occurredAt: new Date().toISOString(), content: '额外敏感正文不得外发'
    });
    await waitFor(async () => (await readOutbox(eventKey)).status === 'DONE');
    const event = await readOutbox(eventKey);
    assert.equal(event.attempts, 2);
    assert.equal(event.last_error, null);
    const requests = fake.requests.filter(item => item.body.messageId === id);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].idempotencyKey, eventKey);
    assert.equal(requests[1].idempotencyKey, eventKey);
    assert.ok(requests.every(item => !JSON.stringify(item.body).includes('额外敏感正文不得外发')));
  });

  it('永久失败进入死信，应用内通知和核心预约仍成功', async () => {
    const id = `external-dead-${crypto.randomUUID()}`;
    fake.setStatus(id, 503);
    const eventKey = `external-notification:SMS:${id}`;
    const inAppId = `in-app-${crypto.randomUUID()}`;
    await insertOutbox(eventKey, 'EXTERNAL_NOTIFICATION', {
      notificationId: id, channel: 'SMS', recipient: '13800000003', title: '紧急死信测试', occurredAt: new Date().toISOString()
    }, 1);
    await insertOutbox(`notification:${inAppId}`, 'IN_APP_NOTIFICATION', {
      id: inAppId, userId: '3', title: '应用内隔离验证', content: '核心通知正常', timestamp: new Date().toISOString(), isRead: false, type: 'INFO'
    });
    const booking = await createConfidentialBooking('外部故障期间核心预约');
    await waitFor(async () => (await readOutbox(eventKey)).status === 'FAILED'
      && (await readOutbox(`notification:${inAppId}`)).status === 'DONE');
    const failed = await readOutbox(eventKey);
    assert.equal(failed.attempts, 1);
    assert.equal(failed.last_error, 'EXTERNAL_DELIVERY_HTTP_503');
    assert.ok(!String(failed.last_error).includes('test-sms-token'));
    assert.equal((await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [booking.id]))[0].status, 'PENDING');
    assert.equal((await queryTestDb<any[]>('SELECT id FROM notifications WHERE id = ?', [inAppId])).length, 1);
  });

  it('HTTP 超时形成受控错误，不记录地址、凭证或消息正文', async () => {
    const id = `external-timeout-${crypto.randomUUID()}`;
    fake.setDelay(id, 250);
    const eventKey = `external-notification:EMAIL:${id}`;
    await insertOutbox(eventKey, 'EXTERNAL_NOTIFICATION', {
      notificationId: id, channel: 'EMAIL', recipient: 'li@company.com', title: '超时测试', occurredAt: new Date().toISOString()
    }, 1);
    await waitFor(async () => (await readOutbox(eventKey)).status === 'FAILED');
    const failed = await readOutbox(eventKey);
    assert.equal(failed.last_error, 'EXTERNAL_DELIVERY_TIMEOUT');
    assert.ok(!String(failed.last_error).includes(fake.baseUrl));
    assert.ok(!String(failed.last_error).includes('test-email-token'));
    assert.ok(!String(failed.last_error).includes('超时测试'));
  });
});
