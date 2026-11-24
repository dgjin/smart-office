import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { Booking, MonitoringSnapshot } from '../../types.ts';
import { closeDbPool } from '../../server/db.ts';
import { handleMonitoringEvents } from '../../server/monitoring.ts';
import { monitoringSubscriberCount } from '../../server/monitoringEvents.ts';
import { integrationEnabled, mutateTestCollection, queryTestDb, resetTestDb, TestServer } from '../support/testServer.ts';

const server = new TestServer();
type Session = Awaited<ReturnType<TestServer['login']>>;
type StreamEvent = { id: number; event: string; data: any };

let admin: Session;
let requester: Session;
let other: Session;
let confidentialResourceId = '';
let occupiedResourceId = '';
let releasedResourceId = '';
const otherId = 'u-monitoring-other';

const call = (pathname: string, method: string, session: Session, body?: unknown) => server.request(pathname, {
  method,
  headers: { Cookie: session.cookie },
  body: body === undefined ? undefined : JSON.stringify(body)
});
const json = async (response: Response) => response.json() as Promise<any>;
const expectJson = async (response: Response, status: number) => {
  const body = await json(response);
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const insertBooking = async (booking: Booking) => {
  await queryTestDb(`INSERT INTO bookings (id, user_id, resource_id, start_time, end_time, status, payload, created_at, schedule_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    booking.id, booking.userId, booking.resourceId, new Date(booking.startTime), new Date(booking.endTime),
    booking.status, JSON.stringify(booking), new Date(booking.createdAt), booking.scheduleVersion || 1
  ]);
};
const booking = (input: Partial<Booking> & Pick<Booking, 'id' | 'userId' | 'resourceId' | 'startTime' | 'endTime' | 'purpose'>): Booking => ({
  type: 'ROOM', status: 'APPROVED', participants: 4, createdAt: new Date().toISOString(), currentNodeIndex: 1,
  approvalHistory: [], attendeeIds: [], meetingType: 'NORMAL', confidentialityChoice: 'NON_CONFIDENTIAL',
  requesterDepartmentId: 'dpt3', scheduleVersion: 1, serviceRequirements: [], ...input
});

const readEventStream = (response: Response) => {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (): Promise<StreamEvent> => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!block || block.startsWith(':')) continue;
        let id = 0;
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) id = Number(line.slice(4));
          if (line.startsWith('event: ')) event = line.slice(7);
          if (line.startsWith('data: ')) data.push(line.slice(6));
        }
        return { id, event, data: JSON.parse(data.join('\n')) };
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('读取监控 SSE 事件超时')), Math.max(1, deadline - Date.now()));
          })
        ]);
        if (result.done) throw new Error('监控 SSE 在发送快照前关闭');
        buffer += decoder.decode(result.value, { stream: true });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw new Error('读取监控 SSE 事件超时');
  };
  return { next, close: () => reader.cancel() };
};
const connect = (session: Session) => server.request('/api/monitoring/events', { headers: { Cookie: session.cookie } }).then(readEventStream);
const nextSnapshot = async (stream: { next: () => Promise<StreamEvent> }): Promise<MonitoringSnapshot> => {
  const event = await stream.next();
  assert.equal(event.event, 'snapshot', JSON.stringify(event.data));
  assert.ok(event.id > 0);
  return event.data;
};
const waitFor = async (predicate: () => boolean, message: string) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

before(async () => {
  if (!integrationEnabled) return;
  await resetTestDb();
  await server.start();
  [admin, requester] = await Promise.all([server.login('1'), server.login('3')]);
  await expectJson(await call('/api/users', 'POST', admin, {
    user: { id: otherId, name: '监控其他员工', email: `${otherId}@company.com`, role: ['EMPLOYEE'], department: '行政部', mobile: '13800000139' }
  }), 201);
  other = await server.login(otherId);
  const workspace = await expectJson(await call('/api/workspace', 'GET', admin), 200);
  const rooms = workspace.resources.filter((item: any) => item.type === 'ROOM' && ['AVAILABLE', 'OCCUPIED'].includes(item.status)).slice(0, 2);
  assert.equal(rooms.length, 2);
  [confidentialResourceId, occupiedResourceId] = rooms.map((item: any) => item.id);
  releasedResourceId = 'r-monitoring-released';
  await expectJson(await call('/api/resources', 'POST', admin, {
    resource: { id: releasedResourceId, name: '监控释放测试会议室', type: 'ROOM', capacity: 6, location: '主楼 3层', features: [], status: 'AVAILABLE' }
  }), 201);
  const now = Date.now();
  await insertBooking(booking({
    id: 'monitor-confidential-current', userId: '3', resourceId: confidentialResourceId, purpose: '监控机密项目真实名称',
    meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', checkedInAt: new Date(now - 60000).toISOString(),
    startTime: new Date(now - 600000).toISOString(), endTime: new Date(now + 3600000).toISOString()
  }));
  await mutateTestCollection<any>('confidentialAccessGrants', items => [...items, {
    id: 'cag-monitoring-current', bookingId: 'monitor-confidential-current', userId: '3', access: 'REQUESTER', grantedBy: '1', grantedAt: new Date().toISOString()
  }]);
  await insertBooking(booking({
    id: 'monitor-own-current', userId: otherId, resourceId: occupiedResourceId, purpose: '监控本人已签到会议',
    checkedInAt: new Date(now - 60000).toISOString(),
    startTime: new Date(now - 600000).toISOString(), endTime: new Date(now + 3600000).toISOString()
  }));
  await insertBooking(booking({
    id: 'monitor-confidential-ended', userId: '3', resourceId: releasedResourceId, purpose: '监控已结束机密项目',
    meetingType: 'CONFIDENTIAL', confidentialityChoice: 'CONFIDENTIAL', endedEarlyAt: new Date(now - 60000).toISOString(), actualEndTime: new Date(now - 60000).toISOString(),
    startTime: new Date(now - 3600000).toISOString(), endTime: new Date(now + 3600000).toISOString()
  }));
});

after(async () => {
  if (integrationEnabled) await server.stop();
});

describe('监控大屏真实 API 与 SSE', { skip: !integrationEnabled, concurrency: false }, () => {
  it('拒绝未登录访问，快照按 actor 脱敏且保留真实占用时间事实', async () => {
    assert.equal((await server.request('/api/monitoring/snapshot')).status, 401);
    assert.equal((await server.request('/api/monitoring/events')).status, 401);

    const otherSnapshot = await expectJson(await call('/api/monitoring/snapshot', 'GET', other), 200) as MonitoringSnapshot;
    const confidential = otherSnapshot.meetingRooms.find(item => item.resourceId === confidentialResourceId)!;
    assert.equal(confidential.status, 'RESERVED');
    assert.equal(confidential.currentBooking?.purpose, '已预约');
    assert.equal(confidential.currentBooking?.checkedIn, false);
    assert.equal(confidential.currentBooking?.checkInTime, undefined);
    assert.equal(otherSnapshot.meetingRooms.find(item => item.resourceId === occupiedResourceId)?.status, 'IN_USE');
    assert.equal(otherSnapshot.meetingRooms.find(item => item.resourceId === releasedResourceId)?.status, 'IDLE');
    assert.equal(otherSnapshot.officeSource, 'HQ3D_ASSIGNMENT_LEDGER');
    assert.ok(otherSnapshot.offices.length > 0);
    assert.equal(JSON.stringify(otherSnapshot).includes('监控机密项目真实名称'), false);
    assert.equal(JSON.stringify(otherSnapshot).includes('监控已结束机密项目'), false);

    const ownerSnapshot = await expectJson(await call('/api/monitoring/snapshot', 'GET', requester), 200) as MonitoringSnapshot;
    const ownConfidential = ownerSnapshot.meetingRooms.find(item => item.resourceId === confidentialResourceId)!;
    assert.equal(ownConfidential.status, 'IN_USE');
    assert.equal(ownConfidential.currentBooking?.purpose, '监控机密项目真实名称');
    assert.equal(ownConfidential.currentBooking?.checkedIn, true);
  });

  it('SSE 立即推送快照，并在核心写事务提交后推送新资源', async () => {
    const stream = await connect(admin);
    try {
      const initial = await nextSnapshot(stream);
      const resource = {
        id: 'r-monitoring-live', name: '实时监控测试会议室', type: 'ROOM', capacity: 6,
        location: '主楼 3层', features: [], status: 'AVAILABLE'
      };
      await expectJson(await call('/api/resources', 'POST', admin, { resource }), 201);
      const pushed = await nextSnapshot(stream);
      assert.ok(pushed.revision > initial.revision);
      assert.equal(pushed.meetingRooms.find(item => item.resourceId === resource.id)?.status, 'IDLE');
    } finally {
      await stream.close();
    }
  });

  it('总部 3D 房间资料写成功后推送办公室台账变化', async () => {
    const stream = await connect(other);
    try {
      const initial = await nextSnapshot(stream);
      const office = initial.offices[0];
      await expectJson(await call(`/api/hq3d/rooms/${encodeURIComponent(office.uid)}`, 'PUT', admin, {
        profile: { person: '监控集成测试使用人', dept: '监控集成测试部' }
      }), 200);
      const pushed = await nextSnapshot(stream);
      const updated = pushed.offices.find(item => item.uid === office.uid)!;
      assert.equal(updated.person, '监控集成测试使用人');
      assert.equal(updated.department, '监控集成测试部');
      assert.equal(updated.status, 'ASSIGNED');
    } finally {
      await stream.close();
    }
  });

  it('SSE 客户端断连后清理事件订阅', async () => {
    await server.stop();
    const local = createServer((req, res) => { void handleMonitoringEvents(req, res, admin.body.actor); });
    await new Promise<void>((resolve, reject) => local.listen(0, '127.0.0.1', resolve).once('error', reject));
    const address = local.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const before = monitoringSubscriberCount();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/monitoring/events`, { headers: { Cookie: admin.cookie } });
      const stream = readEventStream(response);
      await nextSnapshot(stream);
      assert.equal(monitoringSubscriberCount(), before + 1);
      await stream.close();
      await waitFor(() => monitoringSubscriberCount() === before, 'SSE 断连后仍残留事件订阅');
    } finally {
      local.closeAllConnections();
      await new Promise<void>(resolve => local.close(() => resolve()));
      await closeDbPool();
    }
  });
});
