import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Booking, Notification } from '../../types.ts';
import { closeDbPool, getDbPool, mutateDb, readSnapshot, type MutationContext } from '../../server/db.ts';
import type { OfficeDb } from '../../server/tools.ts';
import { listNotifications, markNotificationsRead } from '../../server/notifications.ts';
import { integrationEnabled, queryTestDb, resetTestDb } from '../support/testServer.ts';

const bookingIds = ['bk-r6-diff-a', 'bk-r6-diff-b'];
const notificationIds = ['nt-r6-a', 'nt-r6-b', 'nt-r6-other', 'nt-r6-sys'];
let resourceId = '';
let userId = '';
let otherUserId = '';

const captureMutation = async (
  mutator: (db: OfficeDb, context: MutationContext) => void | Promise<void>,
  options: { snapshot?: boolean; replaceBookings?: boolean } = {}
) => {
  const statements: Array<{ sql: string; values: any[] }> = [];
  let connection: any;
  let originalQuery: any;
  try {
    await mutateDb(async (db, context) => {
      connection = context.connection;
      originalQuery = connection.query.bind(connection);
      connection.query = (sql: any, ...args: any[]) => {
        if (typeof sql === 'string') statements.push({ sql, values: Array.isArray(args[0]) ? args[0] : [] });
        return originalQuery(sql, ...args);
      };
      await mutator(db, context);
    }, options);
  } finally {
    if (connection && originalQuery) connection.query = originalQuery;
  }
  return statements;
};

const statementsFor = (statements: Array<{ sql: string; values: any[] }>, table: string) =>
  statements.filter(statement => statement.sql.startsWith(`INSERT INTO ${table} `));

describe('R6 MySQL 变更行写入与通知轻量读取', { skip: !integrationEnabled, concurrency: false }, () => {
  before(async () => {
    await resetTestDb();
    const { db } = await readSnapshot();
    resourceId = (db.resources || []).find(resource => resource.type === 'ROOM')!.id;
    userId = (db.users || [])[0].id;
    otherUserId = (db.users || [])[1].id;
    const booking = (id: string, offset: number): Booking => {
      const start = new Date(Date.now() + (80 + offset) * 86400000);
      start.setHours(10, 0, 0, 0);
      return {
        id,
        userId,
        resourceId,
        type: 'ROOM',
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 3600000).toISOString(),
        status: 'APPROVED',
        purpose: `R6 差异写入 ${id}`,
        participants: 2,
        meetingType: 'NORMAL',
        confidentialityChoice: 'NON_CONFIDENTIAL',
        createdAt: new Date().toISOString(),
        currentNodeIndex: 0,
        approvalHistory: [],
        scheduleVersion: 1
      };
    };
    const notice = (id: string, owner: string): Notification => ({
      id, userId: owner, title: `R6 ${id}`, content: id, timestamp: new Date().toISOString(), isRead: false, type: 'INFO'
    });
    await mutateDb(db => {
      db.bookings = [booking(bookingIds[0], 0), booking(bookingIds[1], 1), ...(db.bookings || [])];
      db.notifications = [
        notice(notificationIds[0], userId), notice(notificationIds[1], userId),
        notice(notificationIds[2], otherUserId), notice(notificationIds[3], 'sys'),
        ...(db.notifications || [])
      ];
    });
  });

  after(async () => {
    await closeDbPool();
  });

  it('空变更不写集合、预约或通知，也不推进快照版本', async () => {
    const before = await readSnapshot();
    const statements = await captureMutation(() => {}, { snapshot: false });
    assert.equal(statementsFor(statements, 'office_state').length, 0);
    assert.equal(statementsFor(statements, 'bookings').length, 0);
    assert.equal(statementsFor(statements, 'notifications').length, 0);
    assert.equal(statements.filter(statement => statement.sql.startsWith('DELETE FROM bookings')).length, 0);
    assert.equal((await readSnapshot()).revision, before.revision);
  });

  it('单行变化仅写目标行，已读更新不发新通知 outbox，新通知正常入箱', async () => {
    const before = await readSnapshot();
    const newNotificationId = 'nt-r6-new';
    const statements = await captureMutation(db => {
      db.departments = (db.departments || []).map((department, index) => index ? department : { ...department, name: `${department.name} R6` });
      db.bookings = (db.bookings || []).map(booking => booking.id === bookingIds[0] ? { ...booking, purpose: 'R6 仅修改目标预约' } : booking);
      db.notifications = [{
        id: newNotificationId, userId, title: 'R6 新通知', content: newNotificationId,
        timestamp: new Date().toISOString(), isRead: false, type: 'INFO'
      }, ...(db.notifications || []).map(notification => notification.id === notificationIds[0] ? { ...notification, isRead: true } : notification)];
    });
    const collections = statementsFor(statements, 'office_state');
    assert.equal(collections.length, 1);
    assert.equal(collections[0].values[0], 'departments');
    const bookings = statementsFor(statements, 'bookings');
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].values[0], bookingIds[0]);
    const notifications = statementsFor(statements, 'notifications');
    assert.deepEqual(notifications.map(statement => statement.values[0]).sort(), [notificationIds[0], newNotificationId].sort());
    const outbox = await queryTestDb<any[]>('SELECT event_key FROM outbox_events WHERE event_key IN (?, ?)', [
      `notification:${notificationIds[0]}`, `notification:${newNotificationId}`
    ]);
    assert.equal(outbox.filter(row => row.event_key === `notification:${notificationIds[0]}`).length, 1);
    assert.equal(outbox.filter(row => row.event_key === `notification:${newNotificationId}`).length, 1);
    assert.equal((await readSnapshot()).revision, before.revision + 1);
  });

  it('备份替换仍删除缺席预约并只重建保留集合', async () => {
    const statements = await captureMutation(db => {
      db.bookings = (db.bookings || []).filter(booking => booking.id !== bookingIds[0]);
    }, { replaceBookings: true });
    assert.equal(statements.filter(statement => statement.sql.startsWith('DELETE FROM bookings')).length, 1);
    const writes = statementsFor(statements, 'bookings');
    assert.equal(writes.filter(statement => bookingIds.includes(statement.values[0])).length, 1);
    assert.equal(writes.find(statement => bookingIds.includes(statement.values[0])).values[0], bookingIds[1]);
    const rows = await queryTestDb<any[]>('SELECT id FROM bookings WHERE id IN (?, ?)', bookingIds);
    assert.deepEqual(rows.map(row => row.id), [bookingIds[1]]);
  });

  it('通知列表只查询关系表，已读只能修改本人或系统通知且保持快照版本', async () => {
    const before = await readSnapshot();
    const pool = getDbPool() as any;
    const originalQuery = pool.query.bind(pool);
    const queries: string[] = [];
    pool.query = (sql: any, ...args: any[]) => {
      queries.push(String(sql));
      return originalQuery(sql, ...args);
    };
    let notifications: Notification[] = [];
    try {
      notifications = await listNotifications(userId, 2);
    } finally {
      pool.query = originalQuery;
    }
    assert.equal(queries.length, 1);
    assert.match(queries[0], /FROM notifications/);
    assert.doesNotMatch(queries[0], /office_state|FROM bookings/);
    assert.equal(notifications!.length, 2);
    assert.ok(notifications!.every(notification => notification.userId === userId || notification.userId === 'sys'));
    assert.equal(await markNotificationsRead(otherUserId, [notificationIds[1]]), 0);
    assert.equal(await markNotificationsRead(userId, [notificationIds[1]]), 1);
    assert.equal(await markNotificationsRead(userId, [notificationIds[1]]), 0);
    assert.equal((await readSnapshot()).revision, before.revision);
  });

  it('系统广播按用户独立已读，重复标记幂等且不推进快照版本', async () => {
    const before = await readSnapshot();
    const broadcastId = notificationIds[3];
    const readState = async (id: string) => (await listNotifications(id, 1000)).find(item => item.id === broadcastId)?.isRead;
    assert.equal(await readState(userId), false);
    assert.equal(await readState(otherUserId), false);
    assert.equal(await markNotificationsRead(userId, [broadcastId]), 1);
    assert.equal(await readState(userId), true);
    assert.equal(await readState(otherUserId), false);
    assert.equal(await markNotificationsRead(userId, [broadcastId]), 0);
    assert.equal(await markNotificationsRead(otherUserId, [broadcastId]), 1);
    assert.equal(await readState(userId), true);
    assert.equal(await readState(otherUserId), true);
    assert.equal(await markNotificationsRead(otherUserId, [broadcastId]), 0);
    const rows = await queryTestDb<any[]>('SELECT user_id FROM notification_read_states WHERE notification_id = ? ORDER BY user_id', [broadcastId]);
    assert.deepEqual(rows.map(row => row.user_id), [userId, otherUserId].sort());
    assert.equal((await readSnapshot()).revision, before.revision);
  });
});
