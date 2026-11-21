import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RULE_SETTINGS } from '../constants.ts';
import { DbError } from '../server/errors.ts';
import {
  assertCancellationAuthorized, createBookingWorkOrders, freezeServiceRequirements,
  syncWorkOrdersForBookingChange
} from '../server/serviceDomain.ts';
import { applyWorkOrderTransition } from '../server/serviceOperations.ts';
import type { OfficeDb } from '../server/tools.ts';
import { completeBookingUsage, recordCheckIn, releaseBooking } from '../server/usageDomain.ts';
import type { Booking, Resource, User, WorkOrder } from '../types.ts';

const requester: User = {
  id: 'u1', name: '申请人', email: 'u1@example.com', role: ['EMPLOYEE'], department: '市场部',
  landline: '010-88886668', mobile: '13800000003'
};
const operator: User = { ...requester, id: 'op1', role: ['FRONT_DESK'] };
const approver: User = { ...requester, id: 'ap1', role: ['APPROVAL_ADMIN'] };
const coordinator: User = { ...requester, id: 'sc1', role: ['SERVICE_COORDINATOR'] };
const resource: Resource = {
  id: 'r1', code: 'R1', name: 'Alpha 会议室', type: 'ROOM', capacity: 10,
  location: '主楼 10层', roomCategory: 'SMALL', features: [], status: 'AVAILABLE'
};

const makeBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b1', userId: requester.id, resourceId: resource.id, type: 'ROOM',
  startTime: '2026-11-21T02:00:00.000Z', endTime: '2026-11-21T03:00:00.000Z',
  status: 'APPROVED', purpose: '项目会议', participants: 4, createdAt: '2026-11-21T01:00:00.000Z',
  currentNodeIndex: 1, approvalHistory: [], attendeeIds: ['u2'], scheduleVersion: 1,
  meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', ...overrides
});

const makeDb = (booking = makeBooking()): OfficeDb => ({
  users: [requester, operator, approver], resources: [resource], bookings: [booking], workOrders: []
});

const assertDbError = (code: string, run: () => unknown) => assert.throws(run, (error: any) => {
  assert.ok(error instanceof DbError);
  assert.equal(error.message, code);
  return true;
});

const makeOrder = (booking: Booking, overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id: `wo-${booking.id}-v1-TEA`, bookingId: booking.id, type: 'TEA', title: '茶水服务',
  assigneeRole: 'SERVICE_COORDINATOR', status: 'TODO', createdAt: booking.createdAt,
  scheduleVersion: 1, requirementSnapshot: { type: 'TEA', catalogSnapshot: {
    catalogItemId: 'service-tea', catalogVersion: 1, name: '茶水服务', fields: [],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: false, cancellable: true
  } },
  statusHistory: [{ to: 'TODO', at: booking.createdAt }], ...overrides
});

test('服务目录在提交时冻结，字段和资源范围严格校验且升级不改写历史快照', () => {
  const db = makeDb();
  const [frozen] = freezeServiceRequirements(db, [{ type: 'SIGNAGE', details: '入口指引' }], resource);
  assert.deepEqual(frozen.fieldValues, { notes: '入口指引' });
  assert.equal(frozen.catalogSnapshot?.catalogVersion, 1);
  assert.equal(frozen.catalogSnapshot?.name, '引导与标识');
  db.serviceCatalog!.find(item => item.type === 'SIGNAGE')!.version = 2;
  db.serviceCatalog!.find(item => item.type === 'SIGNAGE')!.name = '新版标识';
  assert.equal(frozen.catalogSnapshot?.catalogVersion, 1);
  assert.equal(frozen.catalogSnapshot?.name, '引导与标识');
  assertDbError('SERVICE_FIELD_REQUIRED', () => freezeServiceRequirements(db, [{ type: 'SIGNAGE' }], resource));
  assertDbError('INVALID_SERVICE_FIELD_VALUE', () => freezeServiceRequirements(db, [{ type: 'TEA', fieldValues: { servings: '-1' } }], resource));
  assertDbError('SERVICE_NOT_AVAILABLE_FOR_RESOURCE', () => freezeServiceRequirements(db, [{ type: 'TEA' }], { ...resource, type: 'DESK' }));
});

test('工单按预约版本幂等补建，SLA 任务携带版本且历史取消单保留', async () => {
  const booking = makeBooking({ serviceRequirements: [{ type: 'TEA', fieldValues: { servings: '4' } }] });
  const db = makeDb(booking);
  const jobs: any[] = [];
  const audits: any[] = [];
  const context = {
    scheduleJob: async (job: any) => { jobs.push(job); },
    audit: async (event: any) => { audits.push(event); }
  };
  const created = await createBookingWorkOrders(db, booking, context);
  assert.equal(created.length, 1);
  assert.equal(created[0].id, 'wo-b1-v1-TEA');
  assert.deepEqual(created[0].fieldValues, { servings: '4' });
  assert.equal(jobs[0].payload.scheduleVersion, 1);
  assert.equal((await createBookingWorkOrders(db, booking, context)).length, 0);
  assert.equal(jobs.length, 1);

  syncWorkOrdersForBookingChange(db, booking, '改期撤销旧版本', requester.id, '2026-11-21T01:30:00.000Z');
  const rescheduled = { ...booking, scheduleVersion: 2 };
  const next = await createBookingWorkOrders(db, rescheduled, context);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'wo-b1-v2-TEA');
  assert.equal(jobs[1].payload.scheduleVersion, 2);
  assert.equal(db.workOrders!.find(order => order.id === 'wo-b1-v1-TEA')?.status, 'CANCELLED');
  assert.equal(db.workOrders!.length, 2);
  assert.equal(audits.length, 2);
});

test('预约释放按执行状态撤销或异常化工单，已完成记录不可改写', () => {
  const booking = makeBooking();
  const done = makeOrder(booking, { id: 'done', status: 'DONE', executionResult: '已送达', costAmount: 20 });
  const started = makeOrder(booking, { id: 'started', status: 'IN_PROGRESS', startedAt: '2026-11-21T01:50:00.000Z' });
  const security = makeOrder(booking, {
    id: 'security', type: 'SECURITY', requirementSnapshot: { type: 'SECURITY', catalogSnapshot: {
      catalogItemId: 'service-security', catalogVersion: 1, name: '现场安保', fields: [],
      responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true, cancellable: false
    } }
  });
  const db = makeDb(booking);
  db.workOrders = [makeOrder(booking), done, started, security];
  syncWorkOrdersForBookingChange(db, booking, '会议取消', requester.id, '2026-11-21T01:40:00.000Z');
  assert.equal(db.workOrders[0].status, 'CANCELLED');
  assert.equal(db.workOrders[1].status, 'DONE');
  assert.equal(db.workOrders[1].executionResult, '已送达');
  assert.equal(db.workOrders[2].status, 'EXCEPTION');
  assert.equal(db.workOrders[3].status, 'EXCEPTION');
  assert.equal(db.workOrders[0].statusHistory?.at(-1)?.reason, '会议取消');
});

test('普通与重服务取消分别执行 30/120 分钟授权路径', () => {
  const now = Date.parse('2026-11-21T00:30:00.000Z');
  const ordinary = makeBooking();
  const heavy = makeBooking({ serviceRequirements: [{ type: 'VIDEO' }] });
  assert.equal(assertCancellationAuthorized(ordinary, resource, DEFAULT_RULE_SETTINGS, requester, now).cutoffMinutes, 30);
  assertDbError('CANCELLATION_AUTHORIZATION_REQUIRED', () => assertCancellationAuthorized(heavy, resource, DEFAULT_RULE_SETTINGS, requester, now));
  assert.deepEqual(assertCancellationAuthorized(heavy, resource, DEFAULT_RULE_SETTINGS, approver, now), { cutoffMinutes: 120, authorizedLateCancel: true });
});

test('待定信息必须补齐后才能执行，工单完整保存响应、结果、成本与状态历史', () => {
  const booking = makeBooking();
  const order = makeOrder(booking);
  order.requirementSnapshot!.catalogSnapshot!.fields = [{ key: 'notes', label: '服务说明', type: 'TEXTAREA', required: true }];
  const db = makeDb(booking);
  db.workOrders = [order];
  const pending = applyWorkOrderTransition(db, order, coordinator, { action: 'REQUEST_INFO', reason: '请补充服务说明' }, '2026-11-21T01:10:00.000Z');
  assert.equal(pending.status, 'PENDING_INFO');
  assertDbError('INVALID_WORK_ORDER_TRANSITION', () => applyWorkOrderTransition(db, pending, coordinator, { action: 'START' }));
  assertDbError('FORBIDDEN', () => applyWorkOrderTransition(db, pending, operator, { action: 'PROVIDE_INFO', fieldValues: { notes: '越权补充' } }));
  assertDbError('SERVICE_FIELD_REQUIRED', () => applyWorkOrderTransition(db, pending, requester, { action: 'PROVIDE_INFO', fieldValues: { notes: ' ' } }));
  const provided = applyWorkOrderTransition(db, pending, requester, { action: 'PROVIDE_INFO', fieldValues: { notes: '四楼入口指引' } }, '2026-11-21T01:20:00.000Z');
  assert.equal(provided.status, 'TODO');
  assert.equal(provided.fieldValues?.notes, '四楼入口指引');
  assert.equal(provided.requirementSnapshot?.details, '四楼入口指引');
  const started = applyWorkOrderTransition(db, provided, coordinator, { action: 'START' }, '2026-11-21T01:30:00.000Z');
  assert.equal(started.respondedAt, '2026-11-21T01:30:00.000Z');
  assert.equal(started.assigneeId, coordinator.id);
  const completed = applyWorkOrderTransition(db, started, coordinator, {
    action: 'COMPLETE', executionResult: '标识已摆放并拍照确认', costAmount: 120, costNote: '物料费'
  }, '2026-11-21T01:50:00.000Z');
  assert.equal(completed.status, 'DONE');
  assert.equal(completed.executionResult, '标识已摆放并拍照确认');
  assert.equal(completed.costAmount, 120);
  assert.equal(completed.statusHistory?.length, 5);
  assertDbError('INVALID_WORK_ORDER_TRANSITION', () => applyWorkOrderTransition(db, completed, coordinator, { action: 'COMPLETE', executionResult: '重复完成' }));

  const security = makeOrder(booking, { id: 'security', requirementSnapshot: { type: 'SECURITY', catalogSnapshot: {
    catalogItemId: 'service-security', catalogVersion: 1, name: '现场安保', fields: [],
    responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true, cancellable: false
  } } });
  assertDbError('WORK_ORDER_NOT_CANCELLABLE', () => applyWorkOrderTransition(db, security, coordinator, { action: 'CANCEL', reason: '尝试撤销安保' }));
  assertDbError('INVALID_WORK_ORDER_TRANSITION', () => applyWorkOrderTransition(db, order, coordinator, { action: 'UNKNOWN' } as any));
});

test('旧二维码、改期前版本和代扫均不能生成签到事实', () => {
  const db = makeDb();
  const booking = db.bookings![0];
  assertDbError('INVALID_QR_CHECK_IN', () => recordCheckIn(db, booking, requester, { source: 'QR', at: '2026-11-21T01:50:00.000Z' }));
  assertDbError('QR_CHECK_IN_SCHEDULE_STALE', () => recordCheckIn(db, booking, requester, { source: 'QR', scheduleVersion: 2, at: '2026-11-21T01:50:00.000Z' }));
  assertDbError('QR_CHECK_IN_REQUIRES_SELF', () => recordCheckIn(db, booking, operator, { source: 'QR', scheduleVersion: 1, subjectUserId: requester.id, at: '2026-11-21T01:50:00.000Z' }));
  assertDbError('FORBIDDEN', () => recordCheckIn(db, booking, requester, { source: 'QR', scheduleVersion: 1, subjectUserId: 'u2', at: '2026-11-21T01:50:00.000Z' }));
  assert.equal(booking.checkedInAt, undefined);
  assert.deepEqual(db.checkInEvents, []);
  assert.deepEqual(db.usageFacts, []);
});

test('扫码签到、人工纠错与撤销只追加事件并递增实际使用事实版本', () => {
  const db = makeDb();
  const checked = recordCheckIn(db, db.bookings![0], requester, { source: 'QR', scheduleVersion: 1, at: '2026-11-21T01:50:00.000Z' });
  assert.equal(checked.booking.checkedInAt, '2026-11-21T01:50:00.000Z');
  assert.equal(checked.booking.actualStartTime, '2026-11-21T01:50:00.000Z');
  assert.equal(db.usageFacts![0].revision, 1);
  assertDbError('BOOKING_ALREADY_CHECKED_IN', () => recordCheckIn(db, checked.booking, requester, { source: 'QR', scheduleVersion: 1, at: '2026-11-21T01:51:00.000Z' }));
  assertDbError('CHECK_IN_CORRECTION_REASON_REQUIRED', () => recordCheckIn(db, checked.booking, operator, { source: 'MANUAL', subjectUserId: requester.id, mode: 'CORRECT', checkedInAt: '2026-11-21T01:55:00.000Z' }));

  const corrected = recordCheckIn(db, checked.booking, operator, {
    source: 'MANUAL', subjectUserId: requester.id, mode: 'CORRECT', checkedInAt: '2026-11-21T01:55:00.000Z',
    reason: '扫码时间偏差', at: '2026-11-21T02:05:00.000Z'
  });
  assert.equal(corrected.event.supersedesId, checked.event.id);
  assert.equal(corrected.booking.checkInSource, 'CORRECTION');
  assert.equal(corrected.booking.checkInOperatorId, operator.id);
  assert.equal(db.usageFacts![0].revision, 2);
  const revoked = recordCheckIn(db, corrected.booking, operator, {
    source: 'MANUAL', subjectUserId: requester.id, mode: 'REVOKE', reason: '误签到', at: '2026-11-21T02:06:00.000Z'
  });
  assert.equal(revoked.booking.checkedInAt, undefined);
  assert.equal(revoked.booking.actualStartTime, undefined);
  assert.equal(db.checkInEvents!.length, 3);
  assert.equal(db.usageFacts![0].revision, 3);
});

test('no-show 与提前结束分别保存释放、门禁和实际时长事实并联动工单', () => {
  const noShowBooking = makeBooking();
  const noShowDb = makeDb(noShowBooking);
  noShowDb.workOrders = [makeOrder(noShowBooking)];
  const released = releaseBooking(noShowDb, noShowBooking, {
    reason: '会议开始 20 分钟后仍未签到，系统自动释放', type: 'NO_SHOW', noShow: true,
    source: 'SYSTEM', at: '2026-11-21T02:20:00.000Z'
  });
  assert.equal(released.status, 'CANCELLED');
  assert.equal(released.noShow, true);
  assert.equal(released.accessRevokedAt, '2026-11-21T02:20:00.000Z');
  assert.equal(noShowDb.workOrders![0].status, 'CANCELLED');
  assert.equal(noShowDb.usageFacts![0].source, 'SYSTEM');
  assert.equal(noShowDb.usageFacts![0].actualMinutes, 0);
  assert.equal(noShowDb.usageFacts![0].releasedAt, released.releasedAt);

  const earlyDb = makeDb();
  const checked = recordCheckIn(earlyDb, earlyDb.bookings![0], requester, { source: 'MANUAL', at: '2026-11-21T01:55:00.000Z' });
  earlyDb.bookings = [checked.booking];
  earlyDb.workOrders = [makeOrder(checked.booking)];
  const completed = completeBookingUsage(earlyDb, checked.booking, requester.id, '2026-11-21T02:30:00.000Z');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.endedEarlyAt, '2026-11-21T02:30:00.000Z');
  assert.equal(completed.actualEndTime, '2026-11-21T02:30:00.000Z');
  assert.equal(completed.accessRevokedAt, '2026-11-21T02:30:00.000Z');
  assert.equal(earlyDb.usageFacts![0].actualMinutes, 35);
  assert.equal(earlyDb.usageFacts![0].scheduledMinutes, 60);
  assert.equal(earlyDb.workOrders![0].status, 'CANCELLED');
});
