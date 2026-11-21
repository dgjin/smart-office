import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
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

const insertApprovedBooking = async (input: { id: string; resourceId: string; start: Date; end: Date; purpose: string; tea?: boolean }) => {
  const payload = {
    id: input.id, userId: '3', resourceId: input.resourceId, type: 'ROOM', startTime: input.start.toISOString(), endTime: input.end.toISOString(),
    status: 'APPROVED', purpose: input.purpose, participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
    approvalHistory: [], attendeeIds: ['4'], needsTeaService: Boolean(input.tea)
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

  it('双 Worker 在浏览器关闭时幂等提醒、补建工单、释放 no-show 并恢复过期租约', async () => {
    const state = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'resources'");
    const resources = typeof state[0].payload === 'string' ? JSON.parse(state[0].payload) : state[0].payload;
    const resource = resources.find((item: any) => item.name === 'Alpha 战略会议室');
    const reminderId = `job-reminder-${crypto.randomUUID()}`;
    const noShowId = `job-noshow-${crypto.randomUUID()}`;
    await insertApprovedBooking({ id: reminderId, resourceId: resource.id, start: new Date(Date.now() + 10 * 60000), end: new Date(Date.now() + 70 * 60000), purpose: '双 Worker 会前提醒' });
    await insertApprovedBooking({ id: noShowId, resourceId: resource.id, start: new Date(Date.now() - 16 * 60000), end: new Date(Date.now() + 44 * 60000), purpose: '双 Worker no-show', tea: true });
    await queryTestDb(`INSERT INTO scheduled_jobs (id, job_key, job_type, payload, run_at, status, attempts, lease_owner, lease_expires_at)
      VALUES (?, ?, 'BOOKING_REMINDER', ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE), 'RUNNING', 1, 'crashed-worker', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND))`,
      [crypto.randomUUID(), `reminder:${reminderId}`, JSON.stringify({ bookingId: reminderId })]);

    await waitFor(async () => {
      const rows = await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [noShowId]);
      const notices = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`reminder-${reminderId}-%`]);
      return rows[0]?.status === 'CANCELLED' && notices.length === 2;
    });
    const reminders = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ? ORDER BY id', [`reminder-${reminderId}-%`]);
    assert.deepEqual(reminders.map(row => row.id), [`reminder-${reminderId}-3`, `reminder-${reminderId}-4`]);
    const noShows = await queryTestDb<any[]>('SELECT id FROM notifications WHERE id LIKE ?', [`noshow-${noShowId}-%`]);
    assert.equal(noShows.length, 2);
    const booking = await queryTestDb<any[]>('SELECT status, payload FROM bookings WHERE id = ?', [noShowId]);
    assert.equal(booking[0].status, 'CANCELLED');
    assert.equal((typeof booking[0].payload === 'string' ? JSON.parse(booking[0].payload) : booking[0].payload).noShow, true);
    const workOrderState = await queryTestDb<any[]>("SELECT payload FROM office_state WHERE state_key = 'workOrders'");
    const workOrders = typeof workOrderState[0].payload === 'string' ? JSON.parse(workOrderState[0].payload) : workOrderState[0].payload;
    assert.equal(workOrders.filter((item: any) => item.id === `wo-${noShowId}-TEA`).length, 1);
    const audits = await queryTestDb<any[]>(`SELECT action, actor_id FROM audit_events
      WHERE (action = 'WORK_ORDER_AUTO_CREATE' AND entity_id = ?)
        OR (action = 'BOOKING_NO_SHOW_CANCEL' AND entity_id = ?)`, [`wo-${noShowId}-TEA`, noShowId]);
    assert.deepEqual(audits.map(row => row.action).sort(), ['BOOKING_NO_SHOW_CANCEL', 'WORK_ORDER_AUTO_CREATE']);
    assert.ok(audits.every(row => row.actor_id === null));
    const jobs = await queryTestDb<any[]>('SELECT job_key, status FROM scheduled_jobs WHERE job_key IN (?, ?)', [`reminder:${reminderId}`, `noshow:${noShowId}`]);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => job.status === 'DONE'));
    await waitFor(async () => {
      const events = await queryTestDb<any[]>("SELECT status FROM outbox_events WHERE event_key LIKE 'notification:%' AND status != 'DONE'");
      return events.length === 0;
    });
    const outbox = await queryTestDb<any[]>('SELECT event_key FROM outbox_events WHERE event_key IN (?, ?)', [`notification:reminder-${reminderId}-3`, `notification:noshow-${noShowId}-3`]);
    assert.equal(outbox.length, 2);

    await queryTestDb(`INSERT INTO outbox_events (id, event_key, event_type, payload, max_attempts) VALUES (?, ?, 'UNSUPPORTED_DELIVERY', '{}', 1)`, [crypto.randomUUID(), `test-failure-${Date.now()}`]);
    await waitFor(async () => {
      const rows = await queryTestDb<any[]>("SELECT status FROM outbox_events WHERE event_type = 'UNSUPPORTED_DELIVERY'");
      return rows[0]?.status === 'FAILED';
    });
    assert.equal((await queryTestDb<any[]>('SELECT status FROM bookings WHERE id = ?', [reminderId]))[0].status, 'APPROVED');
  });
});
