import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
let admin: Awaited<ReturnType<TestServer['login']>>;
let requester: Awaited<ReturnType<TestServer['login']>>;
let outsider: Awaited<ReturnType<TestServer['login']>>;
let stranger: Awaited<ReturnType<TestServer['login']>>;
let adminId = '';
let requesterId = '';
const outsiderId = 'u-mrp2-outsider';
const strangerId = 'u-mrp2-stranger';
const mainResourceId = 'r-mrp2-main';
const otherResourceId = 'r-mrp2-other';
const auditoriumResourceId = 'r-mrp2-auditorium';
const exclusiveResourceId = 'r-mrp2-exclusive';

const readJson = async (response: Response) => response.json() as Promise<any>;
const call = (pathname: string, method: string, session: Awaited<ReturnType<TestServer['login']>>, body?: unknown) =>
  server.request(pathname, { method, headers: { Cookie: session.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const at = (daysAhead: number, hour: number, minute = 0) => {
  const value = new Date(Date.now() + daysAhead * 86400000);
  value.setUTCHours(hour, minute, 0, 0);
  return value;
};
const makeBooking = (resourceId: string, start: Date, end: Date, overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), resourceId, type: 'ROOM', startTime: start.toISOString(), endTime: end.toISOString(),
  status: 'APPROVED', purpose: 'MRP2 核心规则集成验证', participants: 4, createdAt: new Date().toISOString(),
  currentNodeIndex: 99, approvalHistory: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL', ...overrides
});
const createBooking = (session: Awaited<ReturnType<TestServer['login']>>, booking: Record<string, unknown>) =>
  call('/api/bookings', 'POST', session, { booking });
const createBatch = (session: Awaited<ReturnType<TestServer['login']>>, bookings: Record<string, unknown>[]) =>
  call('/api/bookings/batch', 'POST', session, { bookings });
const readBooking = async (id: string): Promise<Booking> => {
  const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [id]);
  assert.equal(rows.length, 1);
  return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
};
const cancelBooking = (session: Awaited<ReturnType<TestServer['login']>>, bookingId: string) =>
  call('/api/agent/action', 'POST', session, { action: { type: 'PROPOSE_CANCEL', bookingId, summary: '取消预约' } });

describe('MRP2 核心预约规则真实 API 集成验证', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    await server.start();
    const options = await readJson(await server.request('/api/auth/options'));
    adminId = options.users.find((user: any) => user.role.includes('SYSTEM_ADMIN'))?.id;
    requesterId = options.users.find((user: any) => user.name === '李员工')?.id;
    assert.ok(adminId && requesterId);
    admin = await server.login(adminId);
    requester = await server.login(requesterId);

    const departmentResponse = await call('/api/departments', 'POST', admin, {
      department: { id: 'dpt-mrp2-integration', name: 'MRP2集成验证部' }
    });
    assert.equal(departmentResponse.status, 201);
    for (const [id, name, mobile] of [[outsiderId, 'MRP2参会同事', '13800000112'], [strangerId, 'MRP2无关同事', '13800000113']]) {
      const response = await call('/api/users', 'POST', admin, {
        user: {
          id, name, email: `${id}@company.com`, role: ['EMPLOYEE'], department: 'MRP2集成验证部',
          landline: '010-88889999', mobile
        }
      });
      assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    }
    [outsider, stranger] = await Promise.all([server.login(outsiderId), server.login(strangerId)]);

    const resources = [
      {
        id: mainResourceId, code: 'MRP2-MAIN-101', name: 'MRP2主会议室', type: 'ROOM', capacity: 12,
        location: '1号楼 10层 · M101', building: 'MAIN', floor: 10, roomNumber: 'M101', features: ['投屏显示器'],
        status: 'AVAILABLE', isPublic: true, isExclusive: false, openStart: '08:00', openEnd: '20:00'
      },
      {
        id: otherResourceId, code: 'MRP2-OTHER-102', name: 'MRP2跨日会议室', type: 'ROOM', capacity: 12,
        location: '1号楼 10层 · M102', building: 'MAIN', floor: 10, roomNumber: 'M102', features: [],
        status: 'AVAILABLE', isPublic: true, isExclusive: false
      },
      {
        id: auditoriumResourceId, code: 'MRP2-HALL-201', name: 'MRP2集成礼堂', type: 'ROOM', capacity: 100,
        location: '2号楼 2层 · H201', building: 'ANNEX', floor: 2, roomNumber: 'H201', roomCategory: 'AUDITORIUM',
        features: [], status: 'AVAILABLE', isPublic: true, isExclusive: false
      },
      {
        id: exclusiveResourceId, code: 'MRP2-EXCLUSIVE-202', name: 'MRP2专属会议室', type: 'ROOM', capacity: 8,
        location: '2号楼 2层 · E202', building: 'ANNEX', floor: 2, roomNumber: 'E202', features: [],
        status: 'AVAILABLE', isPublic: false, isExclusive: true, exclusiveLeaderLevel: '集成测试授权'
      }
    ];
    for (const resource of resources) {
      const response = await call('/api/resources', 'POST', admin, { resource });
      assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    }
  });

  after(async () => {
    await server.stop();
  });

  it('必选字段由服务端强制，联系人快照、规则版本与敏感字段读模型正确落库和脱敏', async () => {
    const missing = makeBooking(mainResourceId, at(120, 2), at(120, 3));
    delete (missing as any).meetingType;
    const missingResponse = await createBooking(requester, missing);
    assert.equal(missingResponse.status, 400);
    assert.equal((await readJson(missingResponse)).error, 'MEETING_TYPE_REQUIRED');

    const booking = makeBooking(mainResourceId, at(120, 2), at(120, 3), {
      userId: adminId,
      meetingType: 'IMPORTANT',
      contactSnapshot: { userId: adminId, name: '伪造联系人', landline: '12345', mobile: '13800000000' },
      serviceRequirements: [{ type: 'TEA' }, { type: 'SIGNAGE', details: '一楼入口指引' }],
      attendeeIds: [outsiderId]
    });
    const response = await createBooking(requester, booking);
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const created = (await readJson(response)).booking as Booking;
    assert.equal(created.userId, requesterId);
    assert.equal(created.currentNodeIndex, 0);
    assert.deepEqual(created.approvalHistory, []);
    assert.deepEqual(created.contactSnapshot, {
      userId: requesterId, name: '李员工', landline: '010-88886668', mobile: '13800000003'
    });
    assert.equal(created.needsTeaService, true);
    assert.deepEqual(created.serviceRequirements?.map(item => item.type), ['TEA', 'SIGNAGE']);
    assert.equal(created.serviceRequirements?.[1].details, '一楼入口指引');
    assert.deepEqual(created.serviceRequirements?.[1].fieldValues, { notes: '一楼入口指引' });
    assert.ok(created.serviceRequirements?.every(item => item.catalogSnapshot?.catalogVersion === 1));
    assert.equal(created.ruleVersion, 1);
    assert.equal(created.ruleSettingsSnapshot?.departmentDailyNetMinutes, 240);
    const persistedRows = await queryTestDb<any[]>('SELECT rule_version, payload FROM bookings WHERE id = ?', [created.id]);
    assert.equal(Number(persistedRows[0].rule_version), 1);
    assert.equal((typeof persistedRows[0].payload === 'string' ? JSON.parse(persistedRows[0].payload) : persistedRows[0].payload).contactSnapshot.mobile, '13800000003');

    const readableWorkspace = await readJson(await call('/api/workspace', 'GET', outsider));
    assert.equal(readableWorkspace.bookings.find((item: Booking) => item.id === created.id).contactSnapshot.mobile, '13800000003');
    const strangerWorkspace = await readJson(await call('/api/workspace', 'GET', stranger));
    const redacted = strangerWorkspace.bookings.find((item: Booking) => item.id === created.id);
    assert.equal(redacted.purpose, '已预约');
    assert.equal(redacted.meetingType, undefined);
    assert.equal(redacted.confidentialityChoice, undefined);
    assert.equal(redacted.contactSnapshot, undefined);
    assert.deepEqual(redacted.serviceRequirements, []);
    assert.deepEqual(redacted.quotaDetails, []);
    assert.deepEqual(redacted.attendeeWarnings, []);
  });

  it('礼堂布置和完整服务需求通过同一提交规则保存', async () => {
    const response = await createBooking(requester, makeBooking(auditoriumResourceId, at(121, 2), at(121, 4), {
      meetingType: 'IMPORTANT',
      serviceRequirements: [
        { type: 'VIDEO' }, { type: 'SECURITY', details: '南门值守' }, { type: 'OTHER', details: '席卡与桌签' }
      ],
      auditoriumSetup: { seatingLayout: 'CLASSROOM', stageRequired: true, rehearsalMinutes: 45, notes: '前排预留' }
    }));
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const created = (await readJson(response)).booking as Booking;
    assert.equal(created.isVideoConference, true);
    assert.equal(created.auditoriumSetup?.seatingLayout, 'CLASSROOM');
    assert.equal(created.auditoriumSetup?.stageRequired, true);
    assert.equal(created.auditoriumSetup?.rehearsalMinutes, 45);
    assert.deepEqual(created.serviceRequirements?.map(item => item.type), ['VIDEO', 'SECURITY', 'OTHER']);
  });

  it('专属资源仅开放会前窗口内临时申请并记录授权审计', async () => {
    const tooEarly = await createBooking(requester, makeBooking(exclusiveResourceId, at(122, 2), at(122, 3), {
      exclusiveRequestReason: '临时重要接待'
    }));
    assert.equal(tooEarly.status, 409);
    assert.equal((await readJson(tooEarly)).error, 'EXCLUSIVE_REQUEST_WINDOW_CLOSED');

    const start = new Date(Date.now() + 12 * 3600000);
    const missingReason = await createBooking(requester, makeBooking(exclusiveResourceId, start, new Date(start.getTime() + 3600000)));
    assert.equal(missingReason.status, 400);
    assert.equal((await readJson(missingReason)).error, 'EXCLUSIVE_REQUEST_REASON_REQUIRED');

    const response = await createBooking(requester, makeBooking(exclusiveResourceId, start, new Date(start.getTime() + 3600000), {
      exclusiveRequestReason: '临时重要接待'
    }));
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const created = (await readJson(response)).booking as Booking;
    assert.equal(created.exclusiveAccessType, 'TEMPORARY');
    assert.equal(created.exclusiveRequestReason, '临时重要接待');
    const audits = await queryTestDb<any[]>('SELECT actor_id, details FROM audit_events WHERE action = ? AND entity_id = ?', ['EXCLUSIVE_ACCESS_REQUEST', created.id]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_id, requesterId);
    const details = typeof audits[0].details === 'string' ? JSON.parse(audits[0].details) : audits[0].details;
    assert.equal(details.reason, '临时重要接待');
  });

  it('不同申请人并发争抢同一资源时至多一个成功', async () => {
    const first = makeBooking(mainResourceId, at(123, 2), at(123, 3), { purpose: '并发资源冲突A' });
    const second = makeBooking(mainResourceId, at(123, 2), at(123, 3), { purpose: '并发资源冲突B' });
    const responses = await Promise.all([createBooking(requester, first), createBooking(stranger, second)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const rejected = responses.find(response => response.status === 409)!;
    assert.equal((await readJson(rejected)).error, 'CONFLICT');
    const rows = await queryTestDb<any[]>('SELECT id FROM bookings WHERE resource_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, "$.purpose")) IN (?, ?)', [mainResourceId, '并发资源冲突A', '并发资源冲突B']);
    assert.equal(rows.length, 1);
  });

  it('同一申请人并发预约不同资源的重叠时段仍强互斥', async () => {
    const first = makeBooking(mainResourceId, at(124, 2), at(124, 3), { purpose: '申请人互斥A' });
    const second = makeBooking(otherResourceId, at(124, 2), at(124, 3), { purpose: '申请人互斥B' });
    const responses = await Promise.all([createBooking(requester, first), createBooking(requester, second)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const rejected = responses.find(response => response.status === 409)!;
    assert.equal((await readJson(rejected)).error, 'REQUESTER_TIME_CONFLICT');
    const rows = await queryTestDb<any[]>('SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, "$.purpose")) IN (?, ?)', ['申请人互斥A', '申请人互斥B']);
    assert.equal(rows.length, 1);
  });

  it('并发提交不能绕过部门每日净额度且失败请求不产生部分落库', async () => {
    const first = makeBooking(mainResourceId, at(125, 0), at(125, 3), { purpose: '并发额度三小时' });
    const second = makeBooking(otherResourceId, at(125, 5), at(125, 7), { purpose: '并发额度两小时' });
    const responses = await Promise.all([createBooking(requester, first), createBooking(requester, second)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const rejected = responses.find(response => response.status === 409)!;
    assert.equal((await readJson(rejected)).error, 'DEPARTMENT_DAILY_QUOTA_EXCEEDED');
    const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, "$.purpose")) IN (?, ?)', ['并发额度三小时', '并发额度两小时']);
    assert.equal(rows.length, 1);
    const saved = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    assert.ok([120, 180].includes(saved.quotaDetails[0].usedBeforeMinutes + saved.quotaDetails[0].requestedMinutes));
  });

  it('跨日额度按自然日拆分，改期排除原预约且取消后返还额度', async () => {
    const crossDayResponse = await createBooking(requester, makeBooking(otherResourceId, at(126, 15), at(126, 17), {
      purpose: '跨日额度明细'
    }));
    assert.equal(crossDayResponse.status, 201, JSON.stringify(await readJson(crossDayResponse.clone())));
    const crossDay = (await readJson(crossDayResponse)).booking as Booking;
    assert.deepEqual(crossDay.quotaDetails?.map(item => ({ date: item.date, requested: item.requestedMinutes, remaining: item.remainingMinutes })), [
      { date: crossDay.quotaDetails?.[0].date, requested: 60, remaining: 180 },
      { date: crossDay.quotaDetails?.[1].date, requested: 60, remaining: 180 }
    ]);
    assert.notEqual(crossDay.quotaDetails?.[0].date, crossDay.quotaDetails?.[1].date);

    const originalResponse = await createBooking(requester, makeBooking(otherResourceId, at(128, 0), at(128, 3), {
      purpose: '改期与取消返还'
    }));
    assert.equal(originalResponse.status, 201);
    const original = (await readJson(originalResponse)).booking as Booking;
    const editedResponse = await call(`/api/bookings/${original.id}`, 'PUT', requester, {
      booking: { ...original, startTime: at(128, 0).toISOString(), endTime: at(128, 4).toISOString() }
    });
    assert.equal(editedResponse.status, 200, JSON.stringify(await readJson(editedResponse.clone())));
    const edited = (await readJson(editedResponse)).booking as Booking;
    assert.equal(edited.quotaDetails?.[0].usedBeforeMinutes, 0);
    assert.equal(edited.quotaDetails?.[0].requestedMinutes, 240);
    assert.equal(edited.quotaDetails?.[0].remainingMinutes, 0);

    const additional = makeBooking(mainResourceId, at(128, 5), at(128, 6), { purpose: '取消后返还的一小时' });
    const exceeded = await createBooking(requester, additional);
    assert.equal(exceeded.status, 409);
    assert.equal((await readJson(exceeded)).error, 'DEPARTMENT_DAILY_QUOTA_EXCEEDED');
    assert.equal((await cancelBooking(requester, original.id)).status, 200);
    assert.equal((await readBooking(original.id)).status, 'CANCELLED');
    const returned = await createBooking(requester, additional);
    assert.equal(returned.status, 201, JSON.stringify(await readJson(returned.clone())));
    assert.equal((await readJson(returned)).booking.quotaDetails[0].usedBeforeMinutes, 0);
  });

  it('参会人重叠只生成不泄露会议用途的提示，不阻断申请', async () => {
    const existingResponse = await createBooking(outsider, makeBooking(otherResourceId, at(129, 2), at(129, 3), {
      purpose: '不应泄露的其他会议用途', attendeeIds: [requesterId]
    }));
    assert.equal(existingResponse.status, 201);
    const response = await createBooking(requester, makeBooking(mainResourceId, at(129, 2), at(129, 3), {
      purpose: '参会人重叠提示', attendeeIds: [outsiderId]
    }));
    assert.equal(response.status, 201, JSON.stringify(await readJson(response.clone())));
    const created = (await readJson(response)).booking as Booking;
    assert.deepEqual(created.attendeeWarnings, ['MRP2参会同事在该时段已有其他预约']);
    assert.ok(!created.attendeeWarnings?.some(item => item.includes('不应泄露')));
  });

  it('长期系列保存规则版本，超限不落库，续期重新审批且不能重复提交', async () => {
    const overLimit = [
      makeBooking(mainResourceId, at(140, 2), at(140, 3), { seriesId: 's-mrp2-over-limit', seriesKind: 'LONG_TERM', recurrenceIndex: 0 }),
      makeBooking(mainResourceId, at(175, 2), at(175, 3), { seriesId: 's-mrp2-over-limit', seriesKind: 'LONG_TERM', recurrenceIndex: 1 })
    ];
    const overLimitResponse = await createBatch(requester, overLimit);
    assert.equal(overLimitResponse.status, 400);
    assert.equal((await readJson(overLimitResponse)).error, 'LONG_TERM_LIMIT_EXCEEDED');
    assert.equal((await queryTestDb<any[]>('SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, "$.seriesId")) = ?', ['s-mrp2-over-limit'])).length, 0);

    const publishInitial = await call('/api/rules', 'PUT', admin, { settings: { departmentDailyNetMinutes: 240 } });
    assert.equal(publishInitial.status, 200);
    const initialVersion = (await readJson(publishInitial)).ruleVersion.version;
    const initial = [
      makeBooking(mainResourceId, at(130, 2), at(130, 3), { seriesId: 's-mrp2-initial', seriesKind: 'LONG_TERM', recurrenceIndex: 0 }),
      makeBooking(mainResourceId, at(131, 2), at(131, 3), { seriesId: 's-mrp2-initial', seriesKind: 'LONG_TERM', recurrenceIndex: 1 })
    ];
    const initialResponse = await createBatch(requester, initial);
    assert.equal(initialResponse.status, 201, JSON.stringify(await readJson(initialResponse.clone())));
    const initialSaved = (await readJson(initialResponse)).bookings as Booking[];
    assert.equal(initialSaved.length, 2);
    assert.ok(initialSaved.every(booking => booking.ruleVersion === initialVersion && booking.status === 'PENDING'));

    const publishRenewal = await call('/api/rules', 'PUT', admin, { settings: { longTermMaxCalendarMonths: 2 } });
    assert.equal(publishRenewal.status, 200);
    const renewalVersion = (await readJson(publishRenewal)).ruleVersion.version;
    const renewal = [
      makeBooking(mainResourceId, at(132, 2), at(132, 3), {
        seriesId: 's-mrp2-renewal', seriesKind: 'LONG_TERM', recurrenceIndex: 0,
        renewalOfSeriesId: 's-mrp2-initial', rootSeriesId: 's-mrp2-initial'
      }),
      makeBooking(mainResourceId, at(133, 2), at(133, 3), {
        seriesId: 's-mrp2-renewal', seriesKind: 'LONG_TERM', recurrenceIndex: 1,
        renewalOfSeriesId: 's-mrp2-initial', rootSeriesId: 's-mrp2-initial'
      })
    ];
    const renewalResponse = await createBatch(requester, renewal);
    assert.equal(renewalResponse.status, 201, JSON.stringify(await readJson(renewalResponse.clone())));
    const renewed = (await readJson(renewalResponse)).bookings as Booking[];
    assert.ok(renewed.every(booking => booking.ruleVersion === renewalVersion));
    assert.ok(renewed.every(booking => booking.status === 'PENDING' && booking.currentNodeIndex === 0 && booking.approvalHistory.length === 0));
    assert.ok(renewed.every(booking => booking.ruleSettingsSnapshot?.longTermMaxCalendarMonths === 2));
    assert.ok((await readBooking(initialSaved[0].id)).ruleVersion === initialVersion);

    const duplicate = await createBatch(requester, renewal.map(booking => ({ ...booking, id: crypto.randomUUID() })));
    assert.equal(duplicate.status, 409);
    assert.equal((await readJson(duplicate)).error, 'RENEWAL_EXISTS');
    assert.equal((await queryTestDb<any[]>('SELECT id FROM bookings WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, "$.renewalOfSeriesId")) = ?', ['s-mrp2-initial'])).length, 2);
  });
});
