import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ApprovalNode, Booking } from '../../types.ts';
import { integrationEnabled, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const serverA = new TestServer();
const serverB = new TestServer();
const waitFor = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待 MySQL Job Worker 超时');
};

const defaultApprovalWorkflow: ApprovalNode[] = [
  { id: 'job-review', name: '行政审批', approverRole: 'APPROVAL_ADMIN' },
  { id: 'job-final', name: '最终核准', approverRole: 'SYSTEM_ADMIN' }
];

const insertPendingBooking = async (input: {
  id: string; resourceId: string; start: Date; end: Date; purpose: string;
  submittedAt: Date; currentNodeIndex?: number; meetingType?: Booking['meetingType'];
}) => {
  const payload: Booking = {
    id: input.id, userId: '3', resourceId: input.resourceId, type: 'ROOM',
    startTime: input.start.toISOString(), endTime: input.end.toISOString(), status: 'PENDING',
    purpose: input.purpose, participants: 4, createdAt: input.submittedAt.toISOString(),
    currentNodeIndex: input.currentNodeIndex || 0, approvalHistory: [], attendeeIds: ['4'],
    meetingType: input.meetingType || 'NORMAL',
    confidentialityChoice: input.meetingType === 'CONFIDENTIAL' ? 'CONFIDENTIAL' : 'NON_CONFIDENTIAL',
    approvalSubmittedAt: input.submittedAt.toISOString(), approvalWorkflow: defaultApprovalWorkflow,
    requesterDepartmentId: 'dpt3'
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at)
    VALUES (?, '3', ?, ?, ?, 'PENDING', ?, ?)`, [input.id, input.resourceId, input.start, input.end, JSON.stringify(payload), input.submittedAt]);
};

const readBookingStatus = async (bookingId: string) => {
  const rows = await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [bookingId]);
  return rows[0]?.status;
};

const insertDueApprovalJob = async (bookingId: string, type: 'APPROVAL_REMINDER' | 'APPROVAL_ESCALATION' | 'APPROVAL_CLOSE', payload: { nodeIndex?: number; submittedAt: string }) => {
  const token = String(Date.parse(payload.submittedAt));
  const suffix = type === 'APPROVAL_CLOSE' ? '' : `:${payload.nodeIndex}`;
  const keyPrefix = type === 'APPROVAL_REMINDER' ? 'approval-reminder' : type === 'APPROVAL_ESCALATION' ? 'approval-escalation' : 'approval-close';
  await queryTestDb(`INSERT INTO scheduled_jobs (id, job_key, job_type, payload, run_at)
    VALUES (?, ?, ?, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND))
    ON DUPLICATE KEY UPDATE job_type = VALUES(job_type), payload = VALUES(payload),
      run_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND), status = 'PENDING', attempts = 0,
      lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, completed_at = NULL`,
    [crypto.randomUUID(), `${keyPrefix}:${bookingId}:${token}${suffix}`, type, JSON.stringify({ bookingId, ...payload })]);
};

const insertApprovedBooking = async (input: { id: string; resourceId: string; start: Date; end: Date; purpose: string; tea?: boolean; exclusive?: boolean; checkedIn?: boolean; scheduleVersion?: number }) => {
  const checkedInAt = input.checkedIn ? new Date(input.start.getTime() + 5 * 60000).toISOString() : undefined;
  const payload = {
    id: input.id, userId: '3', resourceId: input.resourceId, type: 'ROOM', startTime: input.start.toISOString(), endTime: input.end.toISOString(),
    status: 'APPROVED', purpose: input.purpose, participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
    approvalHistory: [], attendeeIds: ['4'], needsTeaService: Boolean(input.tea), scheduleVersion: input.scheduleVersion || 1,
    checkedInAt, actualStartTime: checkedInAt,
    exclusiveAccessType: input.exclusive ? 'TEMPORARY' : undefined, exclusiveRequestReason: input.exclusive ? '专属临时授权' : undefined,
    hasLeader: input.exclusive ? true : undefined
  };
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at)
    VALUES (?, '3', ?, ?, ?, 'APPROVED', ?, ?)`, [input.id, input.resourceId, input.start, input.end, JSON.stringify(payload), new Date()]);
};

describe('MySQL Job Worker 与 Outbox', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    const env = { SMART_OFFICE_JOB_INTERVAL_MS: '50', SMART_OFFICE_JOB_LEASE_MS: '1000' };
    await serverA.start(env);
    await serverB.start(env);
  });

  after(async () => {
    await Promise.all([serverA.stop(), serverB.stop()]);
  });

  it('双 Worker 幂等执行会前与签到提醒、no-show 释放、工单撤销和过期租约恢复', async () => {
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const resource = resources.find((item: any) => item.name === 'Alpha 战略会议室');
    const reminderId = `job-reminder-${crypto.randomUUID()}`;
    const noShowId = `job-noshow-${crypto.randomUUID()}`;
    const exclusiveId = `job-exclusive-${crypto.randomUUID()}`;
    await insertApprovedBooking({ id: reminderId, resourceId: resource.id, start: new Date(Date.now() + 10 * 60000), end: new Date(Date.now() + 70 * 60000), purpose: '双 Worker 会前提醒' });
    await insertApprovedBooking({ id: noShowId, resourceId: resource.id, start: new Date(Date.now() - 21 * 60000), end: new Date(Date.now() + 39 * 60000), purpose: '双 Worker no-show', tea: true });
    await insertApprovedBooking({ id: exclusiveId, resourceId: resource.id, start: new Date(Date.now() - 21 * 60000), end: new Date(Date.now() + 39 * 60000), purpose: '专属预约统一 no-show', exclusive: true });
    await queryTestDb(`INSERT INTO scheduled_jobs (id, job_key, job_type, payload, run_at, status, attempts, lease_owner, lease_expires_at)
      VALUES (?, ?, 'BOOKING_REMINDER', ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE), 'RUNNING', 1, 'crashed-worker', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND))
      ON DUPLICATE KEY UPDATE job_type = VALUES(job_type), payload = VALUES(payload), run_at = VALUES(run_at),
        status = 'RUNNING', attempts = 1, lease_owner = 'crashed-worker', lease_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND),
        last_error = NULL, completed_at = NULL`,
      [crypto.randomUUID(), `reminder:${reminderId}:v1`, JSON.stringify({ bookingId: reminderId, scheduleVersion: 1 })]);

    await waitFor(async () => {
      const rows = await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [noShowId]);
      const notices = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`reminder-${reminderId}-%`]);
      const checkInNotices = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`check-in-reminder-${noShowId}-%`]);
      const exclusiveRows = await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [exclusiveId]);
      const exclusiveJobs = await queryTestDb<any[]>('SELECT status FROM scheduled_jobs WHERE job_key = ?', [`noshow:${exclusiveId}:v1`]);
      return rows[0]?.status === 'CANCELLED' && notices.length === 2 && checkInNotices.length === 2
        && exclusiveRows[0]?.status === 'CANCELLED' && exclusiveJobs[0]?.status === 'DONE';
    });
    const reminders = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ? ORDER BY id', [`reminder-${reminderId}-%`]);
    assert.deepEqual(reminders.map(row => row.id), [`reminder-${reminderId}-v1-3`, `reminder-${reminderId}-v1-4`]);
    const checkInReminders = await queryTestDb<any[]>('SELECT id, content FROM notifications WHERE id LIKE ? ORDER BY id', [`check-in-reminder-${noShowId}-%`]);
    assert.deepEqual(checkInReminders.map(row => row.id), [`check-in-reminder-${noShowId}-v1-3`, `check-in-reminder-${noShowId}-v1-4`]);
    assert.ok(checkInReminders.every(row => row.content.includes('已开始 10 分钟') && row.content.includes('20 分钟释放')));
    const noShows = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`noshow-${noShowId}-%`]);
    assert.equal(noShows.length, 2);
    const booking = await queryTestDb<any[]>('SELECT status, payload FROM bookings WHERE id = ?', [noShowId]);
    assert.equal(booking[0].status, 'CANCELLED');
    const noShowPayload = typeof booking[0].payload === 'string' ? JSON.parse(booking[0].payload) : booking[0].payload;
    assert.equal(noShowPayload.noShow, true);
    assert.equal(noShowPayload.releaseType, 'NO_SHOW');
    assert.ok(noShowPayload.releasedAt && noShowPayload.accessRevokedAt);
    const exclusiveBooking = await queryTestDb<any[]>('SELECT status, payload FROM bookings WHERE id = ?', [exclusiveId]);
    assert.equal(exclusiveBooking[0].status, 'CANCELLED');
    const exclusivePayload = typeof exclusiveBooking[0].payload === 'string' ? JSON.parse(exclusiveBooking[0].payload) : exclusiveBooking[0].payload;
    assert.equal(exclusivePayload.noShow, true);
    assert.equal(exclusivePayload.releaseType, 'NO_SHOW');
    assert.ok(exclusivePayload.releasedAt && exclusivePayload.accessRevokedAt);
    assert.equal((await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`noshow-${exclusiveId}-%`])).length, 2);
    assert.equal((await queryTestDb<any[]>('SELECT id FROM audit_events WHERE action = ? AND entity_id = ?', ['BOOKING_NO_SHOW_CANCEL', exclusiveId])).length, 1);
    const usageState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'usageFacts'");
    const usageFacts = typeof usageState[0].payload === 'string' ? JSON.parse(usageState[0].payload) : usageState[0].payload;
    const exclusiveFact = usageFacts.find((fact: any) => fact.bookingId === exclusiveId);
    assert.match(exclusiveFact.releaseReason, /20 分钟后仍未签到/);
    assert.ok(exclusiveFact.releasedAt);
    assert.equal(exclusiveFact.source, 'SYSTEM');
    const workOrderState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'workOrders'");
    const workOrders = typeof workOrderState[0].payload === 'string' ? JSON.parse(workOrderState[0].payload) : workOrderState[0].payload;
    const noShowOrders = workOrders.filter((item: any) => item.id === `wo-${noShowId}-v1-TEA`);
    assert.equal(noShowOrders.length, 1);
    assert.equal(noShowOrders[0].status, 'CANCELLED');
    assert.match(noShowOrders[0].cancellationReason, /20 分钟/);
    const audits = await queryTestDb<any[]>(`SELECT action, actor_id FROM audit_events
      WHERE (action = 'WORK_ORDER_AUTO_CREATE' AND entity_id = ?)
        OR (action = 'BOOKING_NO_SHOW_CANCEL' AND entity_id = ?)`, [`wo-${noShowId}-v1-TEA`, noShowId]);
    assert.deepEqual(audits.map(row => row.action).sort(), ['BOOKING_NO_SHOW_CANCEL', 'WORK_ORDER_AUTO_CREATE']);
    assert.ok(audits.every(row => row.actor_id === null));
    const jobs = await queryTestDb<any[]>('SELECT job_key, status FROM scheduled_jobs WHERE job_key IN (?, ?, ?)', [`reminder:${reminderId}:v1`, `check-in-reminder:${noShowId}:v1`, `noshow:${noShowId}:v1`]);
    assert.equal(jobs.length, 3);
    assert.ok(jobs.every(job => job.status === 'DONE'));
    await waitFor(async () => {
      const events = await queryTestDb<any[]>("SELECT status FROM outbox_events WHERE event_key LIKE 'notification:%' AND status != 'DONE'");
      return events.length === 0;
    });
    const outbox = await queryTestDb<any[]>('SELECT event_key FROM outbox_events WHERE event_key IN (?, ?, ?)', [`notification:reminder-${reminderId}-v1-3`, `notification:check-in-reminder-${noShowId}-v1-3`, `notification:noshow-${noShowId}-v1-3`]);
    assert.equal(outbox.length, 3);

    await queryTestDb(`INSERT INTO outbox_events (id, event_key, event_type, payload, max_attempts) VALUES (?, ?, 'UNSUPPORTED_DELIVERY', '{}', 1)`, [crypto.randomUUID(), `test-failure-${Date.now()}`]);
    await waitFor(async () => {
      const rows = await queryTestDb<any[]>("SELECT status FROM outbox_events WHERE event_type = 'UNSUPPORTED_DELIVERY'");
      return rows[0]?.status === 'FAILED';
    });
    assert.equal((await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [reminderId]))[0].status, 'APPROVED');
  });

  it('双 Worker 按计划结束时间幂等正常结算，旧排期版本任务安全失效', async () => {
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const completedId = `job-complete-${crypto.randomUUID()}`;
    const staleId = `job-complete-stale-${crypto.randomUUID()}`;
    const start = new Date(Date.now() - 70 * 60000);
    const end = new Date(Date.now() - 10 * 60000);
    await insertApprovedBooking({ id: completedId, resourceId: resources[0].id, start, end, purpose: '正常结束结算', checkedIn: true });
    await insertApprovedBooking({ id: staleId, resourceId: resources[1].id, start, end, purpose: '旧版本正常结束任务', checkedIn: true, scheduleVersion: 2 });
    await queryTestDb(`INSERT INTO scheduled_jobs (id, job_key, job_type, payload, run_at)
      VALUES (?, ?, 'BOOKING_COMPLETION', ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND))`,
      [crypto.randomUUID(), `completion:${staleId}:v1`, JSON.stringify({ bookingId: staleId, scheduleVersion: 1 })]);

    await waitFor(async () => {
      const bookings = await queryTestDb<any[]>('SELECT id, status FROM bookings WHERE id IN (?, ?)', [completedId, staleId]);
      const jobs = await queryTestDb<any[]>('SELECT job_key, status FROM scheduled_jobs WHERE job_key IN (?, ?, ?)',
        [`completion:${completedId}:v1`, `completion:${staleId}:v1`, `completion:${staleId}:v2`]);
      return bookings.length === 2 && bookings.every(booking => booking.status === 'COMPLETED')
        && jobs.length === 3 && jobs.every(job => job.status === 'DONE');
    });

    for (const [id, scheduleVersion] of [[completedId, 1], [staleId, 2]] as const) {
      const rows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [id]);
      const booking = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      assert.equal(booking.status, 'COMPLETED');
      assert.equal(booking.scheduleVersion, scheduleVersion);
      assert.equal(booking.actualEndTime, end.toISOString());
      assert.equal(booking.accessRevokedAt, end.toISOString());
      assert.equal(booking.endedEarlyAt, undefined);
      assert.equal(booking.releasedAt, undefined);
      assert.equal((await queryTestDb<any[]>('SELECT id FROM audit_events WHERE action = ? AND entity_id = ?', ['BOOKING_COMPLETE', id])).length, 1);
      assert.equal((await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`completion-${id}-%`])).length, 2);
    }
    const usageState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'usageFacts'");
    const usageFacts = typeof usageState[0].payload === 'string' ? JSON.parse(usageState[0].payload) : usageState[0].payload;
    for (const id of [completedId, staleId]) {
      const fact = usageFacts.find((item: any) => item.bookingId === id);
      assert.equal(fact.actualEndTime, end.toISOString());
      assert.equal(fact.actualMinutes, 55);
      assert.equal(fact.source, 'SYSTEM');
      assert.equal(fact.revision, 1);
    }
  });

  it('双 Worker 幂等执行审批提醒、升级和会前未核准自动关闭', async () => {
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const resourceId = resources[0].id;
    const submittedAt = new Date();
    const reminderId = `approval-reminder-${crypto.randomUUID()}`;
    const closeId = `approval-close-${crypto.randomUUID()}`;
    await insertPendingBooking({
      id: reminderId, resourceId, start: new Date(Date.now() + 6 * 3600000), end: new Date(Date.now() + 7 * 3600000),
      purpose: '审批超时提醒升级', submittedAt
    });
    await insertPendingBooking({
      id: closeId, resourceId, start: new Date(Date.now() + 20 * 60000), end: new Date(Date.now() + 80 * 60000),
      purpose: '会前未核准关闭', submittedAt, meetingType: 'CONFIDENTIAL'
    });
    await insertDueApprovalJob(reminderId, 'APPROVAL_REMINDER', { nodeIndex: 0, submittedAt: submittedAt.toISOString() });
    await insertDueApprovalJob(reminderId, 'APPROVAL_ESCALATION', { nodeIndex: 0, submittedAt: submittedAt.toISOString() });
    await insertDueApprovalJob(closeId, 'APPROVAL_CLOSE', { submittedAt: submittedAt.toISOString() });

    await waitFor(async () => {
      const reminders = await queryTestDb<any[]>('SELECT user_id FROM notifications WHERE id LIKE ?', [`approval-reminder-${reminderId}-%`]);
      const escalations = await queryTestDb<any[]>('SELECT user_id FROM notifications WHERE id LIKE ?', [`approval-escalation-${reminderId}-%`]);
      const closed = await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [closeId]);
      return reminders.length === 1 && escalations.length === 2 && closed[0]?.status === 'CANCELLED';
    });
    const reminders = await queryTestDb<any[]>('SELECT user_id, content FROM notifications WHERE id LIKE ?', [`approval-reminder-${reminderId}-%`]);
    assert.equal(reminders[0].user_id, '2');
    assert.match(reminders[0].content, /审批提醒时限/);
    const escalations = await queryTestDb<any[]>('SELECT user_id FROM notifications WHERE id LIKE ? ORDER BY user_id', [`approval-escalation-${reminderId}-%`]);
    assert.deepEqual(escalations.map(row => row.user_id), ['1', '2']);
    assert.equal((await queryTestDb<any[]>('SELECT id FROM audit_events WHERE action = ? AND entity_id = ?', ['APPROVAL_ESCALATED', reminderId])).length, 1);

    const closedRows = await queryTestDb<any[]>('SELECT payload FROM bookings WHERE id = ?', [closeId]);
    const closed = typeof closedRows[0].payload === 'string' ? JSON.parse(closedRows[0].payload) : closedRows[0].payload;
    assert.equal(closed.approvalCloseReason, 'UNAPPROVED_BEFORE_START');
    assert.ok(closed.approvalClosedAt);
    const closeNotices = await queryTestDb<any[]>('SELECT user_id, content FROM notifications WHERE id LIKE ? ORDER BY user_id', [`approval-close-${closeId}-%`]);
    assert.deepEqual(closeNotices.map(row => row.user_id), ['2', '3', '4']);
    assert.ok(closeNotices.every(row => row.content.includes('涉密会议')));
    assert.ok(closeNotices.every(row => !row.content.includes('会前未核准关闭')));
    assert.equal((await queryTestDb<any[]>('SELECT id FROM audit_events WHERE action = ? AND entity_id = ?', ['APPROVAL_AUTO_CLOSE', closeId])).length, 1);
    const approvalJobs = await queryTestDb<any[]>('SELECT status FROM scheduled_jobs WHERE job_key LIKE ? OR job_key LIKE ?', [`approval-reminder:${reminderId}:%`, `approval-escalation:${reminderId}:%`]);
    assert.equal(approvalJobs.length, 2);
    assert.ok(approvalJobs.every(job => job.status === 'DONE'));
    await waitFor(async () => {
      const events = await queryTestDb<any[]>(`SELECT status FROM outbox_events
        WHERE event_key LIKE ? OR event_key LIKE ? OR event_key LIKE ?`,
        [`notification:approval-reminder-${reminderId}-%`, `notification:approval-escalation-${reminderId}-%`, `notification:approval-close-${closeId}-%`]);
      return events.length === 6 && events.every(event => event.status === 'DONE');
    });
  });

  it('旧提交和旧节点任务失效，当前节点任务只通知当前审批人', async () => {
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const resourceId = resources[0].id;
    const currentSubmission = new Date();
    const oldSubmission = new Date(currentSubmission.getTime() - 3600000);
    const resubmittedId = `approval-resubmitted-${crypto.randomUUID()}`;
    const nodeChangedId = `approval-node-changed-${crypto.randomUUID()}`;
    await insertPendingBooking({
      id: resubmittedId, resourceId, start: new Date(Date.now() + 8 * 3600000), end: new Date(Date.now() + 9 * 3600000),
      purpose: '编辑重提旧任务', submittedAt: currentSubmission
    });
    await insertPendingBooking({
      id: nodeChangedId, resourceId, start: new Date(Date.now() + 10 * 3600000), end: new Date(Date.now() + 11 * 3600000),
      purpose: '节点变化旧任务', submittedAt: currentSubmission, currentNodeIndex: 1
    });
    await insertDueApprovalJob(resubmittedId, 'APPROVAL_REMINDER', { nodeIndex: 0, submittedAt: oldSubmission.toISOString() });
    await insertDueApprovalJob(nodeChangedId, 'APPROVAL_REMINDER', { nodeIndex: 0, submittedAt: currentSubmission.toISOString() });
    await insertDueApprovalJob(nodeChangedId, 'APPROVAL_REMINDER', { nodeIndex: 1, submittedAt: currentSubmission.toISOString() });
    await queryTestDb(`UPDATE scheduled_jobs SET run_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
      WHERE job_key = ?`, [`approval-reminder:${nodeChangedId}:${String(currentSubmission.getTime())}:1`]);

    await waitFor(async () => {
      const jobs = await queryTestDb<any[]>('SELECT status FROM scheduled_jobs WHERE job_key LIKE ? OR job_key LIKE ?', [`approval-reminder:${resubmittedId}:%`, `approval-reminder:${nodeChangedId}:%`]);
      const currentNotices = await queryTestDb<any[]>('SELECT user_id FROM notifications WHERE id LIKE ?', [`approval-reminder-${nodeChangedId}-%`]);
      return jobs.filter(job => job.status === 'DONE').length === 3 && currentNotices.length === 1;
    });
    assert.equal((await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`approval-reminder-${resubmittedId}-%`])).length, 0);
    const currentNotices = await queryTestDb<any[]>('SELECT user_id FROM notifications WHERE id LIKE ?', [`approval-reminder-${nodeChangedId}-%`]);
    assert.deepEqual(currentNotices.map(row => row.user_id), ['1']);
    assert.equal((await readBookingStatus(resubmittedId)), 'PENDING');
    assert.equal((await readBookingStatus(nodeChangedId)), 'PENDING');
  });

  it('审批任务按工作时间跨班、周末和节假日调度', async () => {
    const admin = await serverA.login('1');
    const configurationResponse = await serverA.request('/api/rules', { headers: { Cookie: admin.cookie } });
    assert.equal(configurationResponse.status, 200);
    const configuration = await configurationResponse.json() as any;
    const publishResponse = await serverA.request('/api/rules', {
      method: 'PUT', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ settings: { ...configuration.current, approvalHolidays: ['2030-11-25'] } })
    });
    assert.equal(publishResponse.status, 200, await publishResponse.clone().text());
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const scheduleId = `approval-schedule-${crypto.randomUUID()}`;
    const submittedAt = new Date('2030-11-22T09:30:00.000Z');
    await insertPendingBooking({
      id: scheduleId, resourceId: resources[0].id,
      start: new Date('2030-11-27T02:00:00.000Z'), end: new Date('2030-11-27T03:00:00.000Z'),
      purpose: '跨班周末节假日调度', submittedAt
    });
    await waitFor(async () => {
      const jobs = await queryTestDb<any[]>('SELECT job_type FROM scheduled_jobs WHERE job_key LIKE ?', [`approval-%:${scheduleId}:%`]);
      return jobs.length === 3;
    });
    const jobs = await queryTestDb<any[]>('SELECT job_type, run_at, status FROM scheduled_jobs WHERE job_key LIKE ?', [`approval-%:${scheduleId}:%`]);
    const runAt = (type: string) => new Date(jobs.find(job => job.job_type === type).run_at).toISOString();
    assert.equal(runAt('APPROVAL_REMINDER'), '2030-11-26T01:30:00.000Z');
    assert.equal(runAt('APPROVAL_ESCALATION'), '2030-11-26T02:30:00.000Z');
    assert.equal(runAt('APPROVAL_CLOSE'), '2030-11-27T01:30:00.000Z');
    assert.ok(jobs.every(job => job.status === 'PENDING'));
  });
});
