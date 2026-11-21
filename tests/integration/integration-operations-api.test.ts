import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { AccessAuthorizationFact, Booking, IntegrationDelivery, User } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

type Session = Awaited<ReturnType<TestServer['login']>>;
type RecordedRequest = { path: string; idempotencyKey: string; body: any };

class FakeIntegrationEndpoints {
  private statuses = new Map<string, number>();
  private server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const idempotencyKey = String(req.headers['idempotency-key'] || '');
    this.requests.push({
      path: req.url || '', idempotencyKey,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
    });
    res.writeHead(this.statuses.get(idempotencyKey) || 200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
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

  setStatus(eventKey: string, status?: number) {
    if (status === undefined) this.statuses.delete(eventKey);
    else this.statuses.set(eventKey, status);
  }
}

const fake = new FakeIntegrationEndpoints();
const server = new TestServer();
const callbackSecret = 'mrp7-isolated-oa-callback-secret';
let admin: Session;
let approver: Session;
let requester: Session;
let sequence = 0;
let lifecycleBookingId = '';

const readJson = async (response: Response) => response.json() as Promise<any>;
const call = (pathname: string, method: string, session: Session, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const expectJson = async (response: Response, status: number) => {
  const body = await readJson(response);
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const readCollection = async <T>(key: string): Promise<T[]> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM office_state WHERE state_key = ?', [key]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const readBooking = async (id: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [id]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const readOutbox = async (eventKey: string) => {
  const rows = await queryTestDb<any[]>('SELECT * FROM outbox_events WHERE event_key = ?', [eventKey]);
  assert.equal(rows.length, 1, eventKey);
  return rows[0];
};
const waitFor = async (check: () => Promise<boolean>, message = '等待集成事件处理超时') => {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const waitEvent = async (eventKey: string, status = 'DONE') => {
  await waitFor(async () => (await readOutbox(eventKey)).status === status, `${eventKey} 未进入 ${status}`);
  return readOutbox(eventKey);
};
const createBooking = async (purpose: string, overrides: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + (30 + sequence++) * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  const response = await call('/api/bookings', 'POST', requester, {
    booking: {
      id: crypto.randomUUID(), resourceId: 'r1', type: 'ROOM', startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 3600000).toISOString(), purpose, participants: 2,
      meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', attendeeIds: ['4'],
      status: 'PENDING', createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [], ...overrides
    }
  });
  return (await expectJson(response, 201)).booking as Booking;
};
const approveWithAgent = async (session: Session, bookingId: string) => {
  const response = await call('/api/agent/action', 'POST', session, {
    action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: 'MRP7 隔离核准', summary: '核准' }
  });
  await expectJson(response, 200);
};
const oaCallback = async (input: {
  bookingId: string; approverExternalId: string; eventId?: string; nonce?: string;
  occurredAt?: string; comment?: string; decision?: 'APPROVE' | 'REJECT';
}, signature?: string) => {
  const raw = JSON.stringify({
    eventId: input.eventId || `event-${crypto.randomUUID()}`,
    nonce: input.nonce || `nonce-${crypto.randomUUID()}`,
    occurredAt: input.occurredAt || new Date().toISOString(),
    bookingId: input.bookingId,
    externalApprovalId: `external-approval-${input.bookingId}`,
    decision: input.decision || 'APPROVE',
    approverExternalId: input.approverExternalId,
    comment: input.comment || 'OA 隔离审批'
  });
  const signed = signature || crypto.createHmac('sha256', callbackSecret).update(raw, 'utf8').digest('hex');
  return server.request('/api/integrations/oa/callback', {
    method: 'POST', headers: { 'X-Smart-Office-Signature': signed }, body: raw
  });
};
const latestDelivery = async (eventKey: string) => {
  const deliveries = await readCollection<IntegrationDelivery>('integrationDeliveries');
  return deliveries.find(item => item.eventKey === eventKey);
};
const insertApprovedBooking = async (id: string, start: Date, end: Date) => {
  const payload: Booking = {
    id, userId: '3', resourceId: 'r1', type: 'ROOM', startTime: start.toISOString(), endTime: end.toISOString(),
    status: 'APPROVED', purpose: '提前结束授权回收', participants: 2, createdAt: new Date().toISOString(),
    currentNodeIndex: 1, approvalHistory: [], attendeeIds: ['4'], meetingType: 'NORMAL',
    confidentialityChoice: 'NON_CONFIDENTIAL', requesterDepartmentId: 'dpt3', scheduleVersion: 1
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, '3', 'r1', ?, ?, 'APPROVED', ?, ?, 1)`, [id, start, end, JSON.stringify(payload), new Date(payload.createdAt)]);
};

before(async () => {
  if (!integrationEnabled) return;
  await resetTestDb();
  const users = await readCollection<User>('users');
  const mappedUsers = users.map(user => ({ ...user, externalId: `OA-${user.id}`, directorySource: 'TEST_OA' }));
  if (!mappedUsers.some(user => user.id === '4')) mappedUsers.push({
    id: '4', name: 'MRP7参会同事', email: 'mrp7-attendee@company.com', role: ['EMPLOYEE'],
    department: '市场部', landline: '010-88889999', mobile: '13800000124', status: 'ACTIVE',
    externalId: 'OA-4', directorySource: 'TEST_OA'
  });
  await queryTestDb("UPDATE office_state SET payload = ? WHERE state_key = 'users'", [JSON.stringify(mappedUsers)]);
  await fake.start();
  await server.start({
    SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000',
    SMART_OFFICE_EXTERNAL_HTTP_TIMEOUT_MS: '200',
    SMART_OFFICE_OA_CALLBACK_ENABLED: 'true', SMART_OFFICE_OA_CALLBACK_SECRET: callbackSecret,
    SMART_OFFICE_CALENDAR_ENABLED: 'true', SMART_OFFICE_CALENDAR_URL: `${fake.baseUrl}/calendar`, SMART_OFFICE_CALENDAR_AUTH_TOKEN: 'calendar-test-token',
    SMART_OFFICE_ACCESS_ENABLED: 'true', SMART_OFFICE_ACCESS_URL: `${fake.baseUrl}/access`, SMART_OFFICE_ACCESS_AUTH_TOKEN: 'access-test-token'
  });
  [admin, approver, requester] = await Promise.all([server.login('1'), server.login('2'), server.login('3')]);
});

after(async () => {
  if (!integrationEnabled) return;
  await server.stop();
  await fake.stop();
});

describe('MRP7-C OA、日历、门禁与安全重放隔离验证', { skip: !integrationEnabled, concurrency: false }, () => {
  it('拒绝错签名、过期、越权和非当前节点回调，非管理员不能访问集成运维', async () => {
    const booking = await createBooking('OA 反向安全验证');
    const badSignature = await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-2' }, '0'.repeat(64));
    assert.equal((await expectJson(badSignature, 401)).error, 'OA_SIGNATURE_INVALID');
    const expired = await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-2', occurredAt: new Date(Date.now() - 6 * 60000).toISOString() });
    assert.equal((await expectJson(expired, 400)).error, 'OA_CALLBACK_INVALID');

    for (const externalId of ['UNKNOWN', 'OA-3', 'OA-1']) {
      const response = await oaCallback({ bookingId: booking.id, approverExternalId: externalId });
      const body = await expectJson(response, 200);
      assert.equal(body.callback.status, 'REJECTED');
      assert.equal(body.callback.errorCode, 'OA_APPROVER_FORBIDDEN');
    }
    assert.equal((await readBooking(booking.id)).status, 'PENDING');
    assert.equal((await readBooking(booking.id)).currentNodeIndex, 0);
    assert.equal((await call('/api/integrations', 'GET', requester)).status, 403);
    assert.equal((await call('/api/integrations/replay', 'POST', requester, { eventKey: 'access:any:v1:GRANT:ALL' })).status, 403);
    const operations = await expectJson(await call('/api/integrations', 'GET', admin), 200);
    assert.ok(operations.callbacks.length >= 3);
    assert.ok(operations.callbacks.every((item: any) => item.payloadHash === undefined && item.nonce === undefined));
  });

  it('合法 OA 回调复用完整审批链，重复事件幂等且冲突指纹被拒绝', async () => {
    const booking = await createBooking('OA 正式审批与外部授权');
    lifecycleBookingId = booking.id;
    const eventId = `event-${crypto.randomUUID()}`;
    const nonce = `nonce-${crypto.randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const first = await expectJson(await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-2', eventId, nonce, occurredAt }), 200);
    assert.equal(first.callback.status, 'APPLIED');
    assert.equal(first.duplicate, false);
    assert.equal((await readBooking(booking.id)).currentNodeIndex, 1);
    const duplicate = await expectJson(await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-2', eventId, nonce, occurredAt }), 200);
    assert.equal(duplicate.duplicate, true);
    const conflict = await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-2', eventId, nonce, occurredAt, comment: '不同正文' });
    assert.equal((await expectJson(conflict, 409)).error, 'OA_CALLBACK_CONFLICT');
    assert.equal((await readCollection<any>('externalCallbacks')).filter(item => item.eventId === eventId).length, 1);

    const final = await expectJson(await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-1' }), 200);
    assert.equal(final.callback.status, 'APPLIED');
    assert.equal((await readBooking(booking.id)).status, 'APPROVED');
    const calendarKey = `calendar:${booking.id}:v1:UPSERT`;
    const accessKey = `access:${booking.id}:v1:GRANT:ALL`;
    await Promise.all([waitEvent(calendarKey), waitEvent(accessKey)]);
    const calendarRequest = fake.requests.find(item => item.idempotencyKey === calendarKey)!;
    const accessRequest = fake.requests.find(item => item.idempotencyKey === accessKey)!;
    assert.equal(calendarRequest.path, '/calendar');
    assert.equal(calendarRequest.body.title, booking.purpose);
    assert.deepEqual(calendarRequest.body.attendees.sort(), ['OA-3', 'OA-4']);
    assert.equal(accessRequest.path, '/access');
    assert.deepEqual(accessRequest.body.subjects.map((item: any) => item.subject).sort(), ['OA-3', 'OA-4']);
    assert.ok(!JSON.stringify(accessRequest.body).includes(booking.purpose));
    const facts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === booking.id);
    assert.equal(facts.length, 2);
    assert.ok(facts.every(item => item.status === 'AUTHORIZED' && item.grantAcknowledgedAt));
    const staleDecision = await expectJson(await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-1' }), 200);
    assert.equal(staleDecision.callback.status, 'REJECTED');
    assert.equal(staleDecision.callback.errorCode, 'OA_BOOKING_STATE_CHANGED');
    const ics = await server.request(`/api/bookings/${booking.id}/ics`, { headers: { Cookie: requester.cookie } });
    assert.equal(ics.status, 200);
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
  });

  it('改期撤销旧版本并核准新版本，取消后旧 GRANT 重放只能过期跳过', async () => {
    const booking = await readBooking(lifecycleBookingId);
    const oldGrantKey = `access:${booking.id}:v1:GRANT:ALL`;
    const oldGrantRequests = fake.requests.filter(item => item.idempotencyKey === oldGrantKey).length;
    const newStart = new Date(Date.parse(booking.startTime) + 2 * 3600000).toISOString();
    const edited = await expectJson(await call(`/api/bookings/${booking.id}`, 'PUT', requester, {
      booking: { ...booking, startTime: newStart, endTime: new Date(Date.parse(newStart) + 3600000).toISOString() }
    }), 200);
    assert.equal(edited.booking.status, 'PENDING');
    assert.equal(edited.booking.scheduleVersion, 2);
    await Promise.all([
      waitEvent(`calendar:${booking.id}:v1:CANCEL`),
      waitEvent(`access:${booking.id}:v1:REVOKE:ALL`)
    ]);
    const oldFacts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === booking.id && item.scheduleVersion === 1);
    assert.ok(oldFacts.every(item => item.status === 'REVOKED' && item.revocationReason === 'RESCHEDULED' && item.revocationAcknowledgedAt));

    await approveWithAgent(approver, booking.id);
    await approveWithAgent(admin, booking.id);
    await Promise.all([
      waitEvent(`calendar:${booking.id}:v2:UPSERT`),
      waitEvent(`access:${booking.id}:v2:GRANT:ALL`)
    ]);
    const cancelled = await call('/api/agent/action', 'POST', requester, {
      action: { type: 'PROPOSE_CANCEL', bookingId: booking.id, reason: 'MRP7 取消回收验证', summary: '取消预约' }
    });
    await expectJson(cancelled, 200);
    await Promise.all([
      waitEvent(`calendar:${booking.id}:v2:CANCEL`),
      waitEvent(`access:${booking.id}:v2:REVOKE:ALL`)
    ]);

    await queryTestDb(`UPDATE outbox_events SET status = 'FAILED', attempts = 1, max_attempts = 1,
      lease_owner = NULL, lease_expires_at = NULL, processed_at = NULL WHERE event_key = ?`, [oldGrantKey]);
    await expectJson(await call('/api/integrations/replay', 'POST', admin, { eventKey: oldGrantKey }), 200);
    await waitEvent(oldGrantKey);
    assert.equal((await latestDelivery(oldGrantKey))?.outcome, 'STALE');
    assert.equal(fake.requests.filter(item => item.idempotencyKey === oldGrantKey).length, oldGrantRequests);
    const revokedFacts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === booking.id);
    assert.ok(revokedFacts.every(item => item.status === 'REVOKED'));
    const repeated = await call('/api/integrations/replay', 'POST', admin, { eventKey: oldGrantKey });
    assert.equal((await expectJson(repeated, 409)).error, 'INTEGRATION_EVENT_NOT_REPLAYABLE');
  });

  it('对账补齐当前事件，提前结束和账号停用分别回收全量及单用户授权', async () => {
    const earlyId = `early-${crypto.randomUUID()}`;
    await insertApprovedBooking(earlyId, new Date(Date.now() - 5 * 60000), new Date(Date.now() + 55 * 60000));
    const reconciled = await expectJson(await call('/api/integrations/reconcile', 'POST', admin, {}), 200);
    assert.ok(reconciled.checkedBookings >= 1);
    await Promise.all([waitEvent(`calendar:${earlyId}:v1:UPSERT`), waitEvent(`access:${earlyId}:v1:GRANT:ALL`)]);
    await expectJson(await call(`/api/bookings/${earlyId}/check-in`, 'POST', requester, { source: 'QR', scheduleVersion: 1 }), 200);
    await expectJson(await call(`/api/bookings/${earlyId}/complete`, 'POST', requester, {}), 200);
    await Promise.all([waitEvent(`calendar:${earlyId}:v1:CANCEL`), waitEvent(`access:${earlyId}:v1:REVOKE:ALL`)]);
    const earlyFacts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === earlyId);
    assert.ok(earlyFacts.every(item => item.status === 'REVOKED' && item.revocationReason === 'EARLY_END' && item.revocationAcknowledgedAt));

    const disabledBooking = await createBooking('账号停用门禁回收');
    await approveWithAgent(approver, disabledBooking.id);
    await approveWithAgent(admin, disabledBooking.id);
    await waitEvent(`access:${disabledBooking.id}:v1:GRANT:ALL`);
    const users = await readCollection<User>('users');
    const attendee = users.find(user => user.id === '4')!;
    await expectJson(await call('/api/users/4', 'PUT', admin, {
      user: { ...attendee, status: 'DISABLED', disabledAt: new Date().toISOString(), disabledReason: 'MRP7 隔离停用验证' }
    }), 200);
    const revokeKey = `access:${disabledBooking.id}:v1:REVOKE:USER:4`;
    await waitEvent(revokeKey);
    const disabledFacts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === disabledBooking.id);
    assert.equal(disabledFacts.find(item => item.userId === '4')?.status, 'REVOKED');
    assert.equal(disabledFacts.find(item => item.userId === '4')?.revocationReason, 'USER_DISABLED');
    assert.equal(disabledFacts.find(item => item.userId === '3')?.status, 'AUTHORIZED');
    const revokeRequest = fake.requests.find(item => item.idempotencyKey === revokeKey)!;
    assert.deepEqual(revokeRequest.body.subjects, [{ subject: 'OA-4' }]);
    assert.equal(revokeRequest.body.reason, 'USER_DISABLED');
  });

  it('FAILED 使用原幂等键安全重放，成功或重复重放不产生额外业务事件', async () => {
    const booking = await createBooking('门禁死信安全重放', { attendeeIds: [] });
    const accessKey = `access:${booking.id}:v1:GRANT:ALL`;
    fake.setStatus(accessKey, 503);
    await approveWithAgent(approver, booking.id);
    await approveWithAgent(admin, booking.id);
    await waitFor(async () => fake.requests.some(item => item.idempotencyKey === accessKey)
      && (await latestDelivery(accessKey))?.outcome === 'FAILED');
    await waitFor(async () => {
      const event = await readOutbox(accessKey);
      return event.status !== 'RUNNING' && event.last_error === 'INTEGRATION_DELIVERY_HTTP_503';
    });
    await queryTestDb(`UPDATE outbox_events SET status = 'FAILED', attempts = 1, max_attempts = 1,
      lease_owner = NULL, lease_expires_at = NULL, processed_at = NULL, last_error = 'INTEGRATION_DELIVERY_HTTP_503' WHERE event_key = ?`, [accessKey]);
    assert.equal((await latestDelivery(accessKey))?.outcome, 'FAILED');
    const beforeReplay = (await readCollection<any>('integrationDeliveries')).length;
    fake.setStatus(accessKey);
    await expectJson(await call('/api/integrations/replay', 'POST', admin, { eventKey: accessKey }), 200);
    await waitEvent(accessKey);
    assert.equal(fake.requests.filter(item => item.idempotencyKey === accessKey).length, 2);
    assert.equal((await latestDelivery(accessKey))?.outcome, 'DELIVERED');
    const facts = (await readCollection<AccessAuthorizationFact>('accessAuthorizationFacts')).filter(item => item.bookingId === booking.id);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, 'AUTHORIZED');
    assert.ok((await readCollection<any>('integrationDeliveries')).length > beforeReplay);
    const duplicate = await call('/api/integrations/replay', 'POST', admin, { eventKey: accessKey });
    assert.equal((await expectJson(duplicate, 409)).error, 'INTEGRATION_EVENT_NOT_REPLAYABLE');
    assert.equal(fake.requests.filter(item => item.idempotencyKey === accessKey).length, 2);
    const compensation = await expectJson(await call('/api/integrations/compensations', 'POST', admin, {
      eventKey: accessKey, note: '已与供应商线下核对，保留原事件和回执事实。'
    }), 201);
    assert.equal(compensation.compensation.eventKey, accessKey);
    const operations = await expectJson(await call('/api/integrations', 'GET', admin), 200);
    assert.ok(operations.compensations.some((item: any) => item.id === compensation.compensation.id));
  });

  it('v7 备份恢复集成事实，旧版本恢复不会遗留外部授权或回调记录', async () => {
    const keys = ['organizationSyncBatches', 'externalCallbacks', 'externalCompensations', 'accessAuthorizationFacts', 'integrationDeliveries'];
    const backup = await expectJson(await call('/api/backup', 'GET', admin), 200);
    assert.equal(backup.schemaVersion, 7);
    for (const key of keys) assert.ok(Array.isArray(backup.collections[key]), key);
    for (const key of keys.slice(1)) assert.ok(backup.collections[key].length > 0, key);
    const deliveryEventKeys = backup.collections.integrationDeliveries.map((item: IntegrationDelivery) => item.eventKey);
    assert.ok(new Set(deliveryEventKeys).size < deliveryEventKeys.length);
    await expectJson(await call('/api/backup/restore', 'POST', admin, backup), 200);
    for (const key of keys) assert.equal((await readCollection<any>(key)).length, backup.collections[key].length, key);

    const legacy = structuredClone(backup);
    legacy.schemaVersion = 6;
    for (const key of keys) delete legacy.collections[key];
    await expectJson(await call('/api/backup/restore', 'POST', admin, legacy), 200);
    for (const key of keys) assert.deepEqual(await readCollection<any>(key), [], key);
  });

  it('适配器默认关闭时核心预约、通知和 ICS 正常，事件仅记录 DISABLED', async () => {
    await server.stop();
    await server.start({
      SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000',
      SMART_OFFICE_OA_CALLBACK_ENABLED: 'false', SMART_OFFICE_OA_CALLBACK_SECRET: '',
      SMART_OFFICE_CALENDAR_ENABLED: 'false', SMART_OFFICE_CALENDAR_URL: '',
      SMART_OFFICE_ACCESS_ENABLED: 'false', SMART_OFFICE_ACCESS_URL: ''
    });
    const beforeRequests = fake.requests.length;
    const booking = await createBooking('外部依赖关闭核心流程验证', { attendeeIds: [] });
    await approveWithAgent(approver, booking.id);
    await approveWithAgent(admin, booking.id);
    assert.equal((await readBooking(booking.id)).status, 'APPROVED');
    const calendarKey = `calendar:${booking.id}:v1:UPSERT`;
    const accessKey = `access:${booking.id}:v1:GRANT:ALL`;
    await Promise.all([waitEvent(calendarKey), waitEvent(accessKey)]);
    assert.equal((await latestDelivery(calendarKey))?.reason, 'DISABLED');
    assert.equal((await latestDelivery(accessKey))?.reason, 'DISABLED');
    assert.equal(fake.requests.length, beforeRequests);
    await waitFor(async () => (await queryTestDb<any[]>('SELECT id FROM notifications WHERE user_id = ? AND title = ?', ['3', '预约已核准'])).length > 0);
    const ics = await server.request(`/api/bookings/${booking.id}/ics`, { headers: { Cookie: requester.cookie } });
    assert.equal(ics.status, 200);
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
    const disabledCallback = await oaCallback({ bookingId: booking.id, approverExternalId: 'OA-1' });
    assert.equal((await expectJson(disabledCallback, 503)).error, 'OA_CALLBACK_DISABLED');
  });
});
