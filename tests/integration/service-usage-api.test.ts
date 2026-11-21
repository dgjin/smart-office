import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Booking, BookingUsageFact, ServiceInspection, UsageAppeal, WorkOrder } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
let admin: Session;
let approver: Session;
let requester: Session;
let coordinator: Session;
let frontDesk: Session;
const coordinatorId = 'u-mrp45-coordinator';
const frontDeskId = 'u-mrp45-front-desk';

const call = (pathname: string, method: string, session: Session, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const readJson = async (response: Response) => response.json() as Promise<any>;
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
const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待会务领域任务超时');
};
const approve = (session: Session, bookingId: string) => call('/api/agent/action', 'POST', session, {
  action: { type: 'PROPOSE_APPROVAL', bookingId, decision: 'APPROVE', comment: '会务集成验证通过', summary: '通过审批' }
});
const insertApprovedBooking = async (input: {
  id: string; start: Date; end: Date; purpose: string; tea?: boolean; resourceId?: string;
}) => {
  const payload: Booking = {
    id: input.id, userId: '3', resourceId: input.resourceId || 'r1', type: 'ROOM',
    startTime: input.start.toISOString(), endTime: input.end.toISOString(), status: 'APPROVED',
    purpose: input.purpose, participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
    approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
    requesterDepartmentId: 'dpt3', scheduleVersion: 1,
    serviceRequirements: input.tea ? [{ type: 'TEA', fieldValues: { servings: '4', notes: '会前送达' } }] : []
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, '3', ?, ?, ?, 'APPROVED', ?, ?, 1)`, [input.id, input.resourceId || 'r1', input.start, input.end, JSON.stringify(payload), new Date(payload.createdAt)]);
};

before(async () => {
  if (!integrationEnabled) return;
  await resetTestDb();
  await server.start({ SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000' });
  [admin, approver, requester] = await Promise.all([server.login('1'), server.login('2'), server.login('3')]);
  for (const [id, name, role, mobile] of [
    [coordinatorId, 'MRP4会务协调员', 'SERVICE_COORDINATOR', '13800000121'],
    [frontDeskId, 'MRP4前台人员', 'FRONT_DESK', '13800000122']
  ]) {
    await expectJson(await call('/api/users', 'POST', admin, {
      user: { id, name, email: `${id}@company.com`, role: [role], department: '行政部', landline: '010-88889999', mobile }
    }), 201);
  }
  [coordinator, frontDesk] = await Promise.all([server.login(coordinatorId), server.login(frontDeskId)]);
});

after(async () => {
  if (integrationEnabled) await server.stop();
});

describe('MRP4-5 会务服务与使用释放真实 API 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  it('目录快照经真实审批生成工单，待定补充、执行回写、责任区班次和巡查均可用', async () => {
    const catalog = await readCollection<any>('serviceCatalog');
    const tea = catalog.find(item => item.type === 'TEA');
    const updated = await expectJson(await call('/api/service-catalog/service-tea', 'PUT', admin, {
      ...tea,
      fields: tea.fields.map((field: any) => field.key === 'servings' ? { ...field, required: true } : field)
    }), 200);
    assert.equal(updated.item.version, 2);

    const start = new Date(Date.now() + 2 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    const bookingId = `service-${crypto.randomUUID()}`;
    const created = await expectJson(await call('/api/bookings', 'POST', requester, {
      booking: {
        id: bookingId, userId: '3', resourceId: 'r1', type: 'ROOM', startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 3600000).toISOString(), status: 'PENDING', purpose: '会务服务全链路验证',
        participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [], attendeeIds: [],
        meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', requesterDepartmentId: 'dpt3',
        serviceRequirements: [{ type: 'TEA', fieldValues: { servings: '4' } }]
      }
    }), 201);
    assert.equal(created.booking.serviceRequirements[0].catalogSnapshot.catalogVersion, 2);
    await expectJson(await approve(approver, bookingId), 200);
    await expectJson(await approve(admin, bookingId), 200);
    assert.equal((await readBooking(bookingId)).status, 'APPROVED');
    const orderId = `wo-${bookingId}-v1-TEA`;
    await waitFor(async () => (await readCollection<WorkOrder>('workOrders')).some(order => order.id === orderId));
    let order = (await readCollection<WorkOrder>('workOrders')).find(item => item.id === orderId)!;
    assert.equal(order.requirementSnapshot?.catalogSnapshot?.catalogVersion, 2);
    assert.deepEqual(order.fieldValues, { servings: '4' });

    await expectJson(await call(`/api/work-orders/${orderId}/transitions`, 'POST', coordinator, {
      action: 'REQUEST_INFO', reason: '请确认最终人数和送达要求'
    }), 200);
    const premature = await expectJson(await call(`/api/work-orders/${orderId}/transitions`, 'POST', coordinator, { action: 'START' }), 409);
    assert.equal(premature.error, 'INVALID_WORK_ORDER_TRANSITION');
    const provided = await expectJson(await call(`/api/work-orders/${orderId}/transitions`, 'POST', requester, {
      action: 'PROVIDE_INFO', fieldValues: { servings: '5', notes: '会前 20 分钟送达' }
    }), 200);
    assert.equal(provided.order.status, 'TODO');
    assert.deepEqual(provided.order.fieldValues, { servings: '5', notes: '会前 20 分钟送达' });
    const started = await expectJson(await call(`/api/work-orders/${orderId}/transitions`, 'POST', coordinator, { action: 'START' }), 200);
    assert.ok(started.order.respondedAt && started.order.startedAt);
    const completed = await expectJson(await call(`/api/work-orders/${orderId}/transitions`, 'POST', coordinator, {
      action: 'COMPLETE', executionResult: '茶水已按要求送达', costAmount: 25.5, costNote: '集成验证物料成本'
    }), 200);
    assert.equal(completed.order.status, 'DONE');
    assert.equal(completed.order.costAmount, 25.5);
    assert.equal(completed.order.statusHistory.length, 5);

    const area = await expectJson(await call('/api/service-areas', 'POST', coordinator, {
      name: 'MRP4主楼责任区', resourceIds: ['r1'], building: 'MAIN'
    }), 201);
    const shift = await expectJson(await call('/api/service-shifts', 'POST', coordinator, {
      areaId: area.area.id, assigneeId: coordinatorId,
      startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 6 * 3600000).toISOString()
    }), 201);
    assert.equal(shift.shift.assigneeId, coordinatorId);
    await waitFor(async () => (await readCollection<ServiceInspection>('serviceInspections')).some(item => item.id === `inspection-${bookingId}-v1-PRE_OPEN`));
    const inspectionId = `inspection-${bookingId}-v1-PRE_OPEN`;
    const inspection = await expectJson(await call(`/api/service-inspections/${inspectionId}`, 'POST', frontDesk, {
      status: 'DONE', note: '会前巡查完成'
    }), 200);
    assert.equal(inspection.inspection.status, 'DONE');
    assert.equal(inspection.inspection.completedBy, frontDeskId);

    const requesterWorkspace = await expectJson(await call('/api/workspace', 'GET', requester), 200);
    assert.ok(requesterWorkspace.workOrders.some((item: WorkOrder) => item.id === orderId));
    assert.equal(requesterWorkspace.serviceAreas, undefined);
    order = (await readCollection<WorkOrder>('workOrders')).find(item => item.id === orderId)!;
    assert.equal(order.executionResult, '茶水已按要求送达');
  });

  it('扫码签到、正常使用确认和统一提前结束入口保存事件、实际时长与审计', async () => {
    const bookingId = `usage-${crypto.randomUUID()}`;
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() - 5 * 60000), end: new Date(Date.now() + 55 * 60000), purpose: '实际使用事实验证'
    });
    const checked = await expectJson(await call(`/api/bookings/${bookingId}/check-in`, 'POST', requester, { source: 'QR', scheduleVersion: 1 }), 200);
    assert.equal(checked.booking.checkInSource, 'QR');
    assert.equal(checked.event.subjectUserId, '3');
    assert.equal(checked.event.operatorId, '3');
    await expectJson(await call(`/api/bookings/${bookingId}/usage-confirmation`, 'POST', requester, {
      decision: 'IN_USE', note: '会议正常进行'
    }), 200);
    const completed = await expectJson(await call(`/api/bookings/${bookingId}/complete`, 'POST', requester, {}), 200);
    assert.equal(completed.message, '会议已提前结束');
    assert.equal(completed.booking.status, 'COMPLETED');
    assert.ok(completed.booking.actualStartTime && completed.booking.actualEndTime && completed.booking.endedEarlyAt);
    assert.ok(completed.booking.releasedAt && completed.booking.accessRevokedAt);

    const events = await readCollection<any>('checkInEvents');
    assert.equal(events.filter(event => event.bookingId === bookingId).length, 1);
    const facts = (await readCollection<BookingUsageFact>('usageFacts')).filter(fact => fact.bookingId === bookingId);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].scheduledMinutes, 60);
    assert.equal(facts[0].actualStartTime, completed.booking.actualStartTime);
    assert.equal(facts[0].actualEndTime, completed.booking.actualEndTime);
    assert.equal(facts[0].revision, 3);
    assert.equal(facts[0].unusedConfirmation?.status, 'IN_USE');
    const audits = await queryTestDb<any[]>('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY action', [bookingId]);
    assert.ok(audits.some(row => row.action === 'BOOKING_CHECK_IN'));
    assert.ok(audits.some(row => row.action === 'BOOKING_USAGE_CONFIRM'));
    assert.ok(audits.some(row => row.action === 'BOOKING_COMPLETE_EARLY'));
  });

  it('无版本、旧版本、代扫和伪造客户端时间均不能生成签到或使用事实', async () => {
    const bookingId = `qr-security-${crypto.randomUUID()}`;
    const futureBookingId = `qr-time-${crypto.randomUUID()}`;
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() + 4 * 3600000), end: new Date(Date.now() + 5 * 3600000), purpose: '二维码安全边界验证', resourceId: 'r2'
    });
    const futureStart = new Date(Date.now() + 3 * 3600000);
    await insertApprovedBooking({
      id: futureBookingId, start: futureStart, end: new Date(futureStart.getTime() + 3600000), purpose: '客户端时间伪造验证'
    });

    const missingVersion = await expectJson(await call(`/api/bookings/${bookingId}/check-in`, 'POST', requester, { source: 'QR' }), 400);
    assert.equal(missingVersion.error, 'INVALID_QR_CHECK_IN');
    const staleVersion = await expectJson(await call(`/api/bookings/${bookingId}/check-in`, 'POST', requester, { source: 'QR', scheduleVersion: 2 }), 409);
    assert.equal(staleVersion.error, 'QR_CHECK_IN_SCHEDULE_STALE');
    const proxied = await expectJson(await call(`/api/bookings/${bookingId}/check-in`, 'POST', coordinator, {
      source: 'QR', scheduleVersion: 1, subjectUserId: '3'
    }), 403);
    assert.equal(proxied.error, 'QR_CHECK_IN_REQUIRES_SELF');
    const forgedTime = await expectJson(await call(`/api/bookings/${futureBookingId}/check-in`, 'POST', requester, {
      source: 'QR', scheduleVersion: 1, at: futureStart.toISOString()
    }), 409);
    assert.equal(forgedTime.error, 'CHECK_IN_OUTSIDE_WINDOW');

    for (const id of [bookingId, futureBookingId]) {
      assert.equal((await readBooking(id)).checkedInAt, undefined);
      assert.equal((await readCollection<any>('checkInEvents')).filter(event => event.bookingId === id).length, 0);
      assert.equal((await readCollection<BookingUsageFact>('usageFacts')).filter(fact => fact.bookingId === id).length, 0);
    }
  });

  it('未使用确认释放资源并保留原因，重复确认和伪造非核准状态事实被阻断', async () => {
    const bookingId = `unused-${crypto.randomUUID()}`;
    await insertApprovedBooking({
      id: bookingId, start: new Date(Date.now() + 3 * 3600000), end: new Date(Date.now() + 4 * 3600000), purpose: '未使用确认验证'
    });
    const missingNote = await expectJson(await call(`/api/bookings/${bookingId}/usage-confirmation`, 'POST', requester, { decision: 'UNUSED' }), 400);
    assert.equal(missingNote.error, 'USAGE_CONFIRMATION_NOTE_REQUIRED');
    const released = await expectJson(await call(`/api/bookings/${bookingId}/usage-confirmation`, 'POST', requester, {
      decision: 'UNUSED', note: '议题取消，确认未到场使用'
    }), 200);
    assert.equal(released.booking.status, 'CANCELLED');
    assert.equal(released.booking.releaseType, 'UNUSED_CONFIRMED');
    assert.match(released.booking.releaseReason, /议题取消/);
    assert.ok(released.booking.accessRevokedAt);
    const repeated = await expectJson(await call(`/api/bookings/${bookingId}/usage-confirmation`, 'POST', requester, {
      decision: 'IN_USE', note: '试图改写已释放事实'
    }), 409);
    assert.equal(repeated.error, 'BOOKING_NOT_CONFIRMABLE');
    const fact = (await readCollection<BookingUsageFact>('usageFacts')).find(item => item.bookingId === bookingId)!;
    assert.equal(fact.unusedConfirmation?.status, 'UNUSED');
    assert.equal(fact.unusedConfirmation?.confirmedBy, '3');
    assert.equal(fact.actualMinutes, 0);
  });

  it('申诉恢复重检冲突，递增版本并显式调度提醒、no-show 和新工单 SLA', async () => {
    const bookingId = `appeal-${crypto.randomUUID()}`;
    const conflictId = `appeal-conflict-${crypto.randomUUID()}`;
    const start = new Date(Date.now() - 25 * 60000);
    const end = new Date(Date.now() + 35 * 60000);
    await insertApprovedBooking({ id: bookingId, start, end, purpose: '释放申诉恢复验证', tea: true });
    const orderV1 = `wo-${bookingId}-v1-TEA`;
    await waitFor(async () => (await readCollection<WorkOrder>('workOrders')).some(order => order.id === orderV1));
    await expectJson(await call(`/api/bookings/${bookingId}/release`, 'POST', coordinator, { reason: '现场异常，先行释放核查' }), 200);
    const appeal = await expectJson(await call(`/api/bookings/${bookingId}/usage-appeals`, 'POST', requester, {
      reason: '已核实为设备误报，申请人仍在现场'
    }), 201);
    const duplicate = await expectJson(await call(`/api/bookings/${bookingId}/usage-appeals`, 'POST', requester, { reason: '重复申诉' }), 409);
    assert.equal(duplicate.error, 'USAGE_APPEAL_EXISTS');
    const approverWorkspace = await expectJson(await call('/api/workspace', 'GET', approver), 200);
    assert.ok(approverWorkspace.usageAppeals.some((item: UsageAppeal) => item.id === appeal.appeal.id));
    assert.equal(approverWorkspace.bookings.find((item: Booking) => item.id === bookingId).purpose, '释放申诉恢复验证');
    assert.equal(approverWorkspace.serviceAreas, undefined);
    assert.equal(approverWorkspace.serviceInspections, undefined);

    await insertApprovedBooking({ id: conflictId, start, end, purpose: '恢复冲突重检占位' });
    const blocked = await expectJson(await call(`/api/usage-appeals/${appeal.appeal.id}`, 'POST', approver, {
      decision: 'RESTORE', note: '尝试恢复'
    }), 409);
    assert.equal(blocked.error, 'CONFLICT');
    assert.equal((await readCollection<UsageAppeal>('usageAppeals')).find(item => item.id === appeal.appeal.id)?.status, 'PENDING');
    await expectJson(await call(`/api/bookings/${conflictId}/release`, 'POST', coordinator, { reason: '解除恢复验证冲突' }), 200);
    const restored = await expectJson(await call(`/api/usage-appeals/${appeal.appeal.id}`, 'POST', approver, {
      decision: 'RESTORE', note: '核查通过，恢复本次预约'
    }), 200);
    assert.equal(restored.appeal.status, 'RESTORED');
    assert.equal(restored.booking.status, 'APPROVED');
    assert.equal(restored.booking.scheduleVersion, 2);
    assert.equal(restored.booking.checkedInAt, undefined);
    assert.ok(Date.parse(restored.booking.noShowReleaseNotBefore) > Date.now() + 19 * 60000);

    const orders = (await readCollection<WorkOrder>('workOrders')).filter(order => order.bookingId === bookingId);
    assert.equal(orders.find(order => order.id === orderV1)?.status, 'CANCELLED');
    assert.equal(orders.find(order => order.id === `wo-${bookingId}-v2-TEA`)?.status, 'TODO');
    const facts = (await readCollection<BookingUsageFact>('usageFacts')).filter(fact => fact.bookingId === bookingId);
    assert.equal(facts.length, 2);
    assert.equal(facts.find(fact => fact.scheduleVersion === 1)?.releasedAt !== undefined, true);
    assert.equal(facts.find(fact => fact.scheduleVersion === 2)?.actualStartTime, undefined);
    const jobs = await queryTestDb<any[]>(`SELECT job_key, job_type, payload, run_at FROM scheduled_jobs
      WHERE job_key IN (?, ?, ?, ?)`, [
        `reminder:${bookingId}:v2`, `check-in-reminder:${bookingId}:v2`,
        `noshow:${bookingId}:v2`, `service-sla:wo-${bookingId}-v2-TEA`
      ]);
    assert.equal(jobs.length, 4);
    for (const job of jobs) {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      assert.equal(payload.scheduleVersion, 2, job.job_key);
    }
    const noShowJob = jobs.find(job => job.job_type === 'BOOKING_NO_SHOW');
    assert.ok(Math.abs(Date.parse(noShowJob.run_at) - Date.parse(restored.booking.noShowReleaseNotBefore)) < 1000);
    assert.ok((await readCollection<UsageAppeal>('usageAppeals')).find(item => item.id === appeal.appeal.id)?.resolutionNote);
  });
});
