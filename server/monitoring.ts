import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Booking, MeetingRoomMonitoringItem, MeetingRoomMonitoringStatus, MonitoringScope, MonitoringSnapshot, OfficeMonitoringItem, OfficeMonitoringStatus, Resource, User } from '../types.ts';
import { getBookingDisplayStatus } from '../utils/bookingRules.ts';
import { canViewMonitoring } from '../utils/monitoringAccess.ts';
import { actorFromRequest } from './auth/sessions.ts';
import { getActorDbView } from './confidentiality.ts';
import { readSnapshot } from './db.ts';
import { getHq3dSnapshot, type Hq3dSnapshot } from './hq3d.ts';
import { subscribeMonitoringChanges } from './monitoringEvents.ts';
import { HttpError, send } from './http.ts';
import { logEvent } from './observability.ts';

const OFFICE_CATEGORIES = new Set(['office', 'open', 'exec']);
const VACANT_PATTERN = /空房|空置|闲置|预留|放置家具/;

export const buildMeetingRoomMonitoring = (
  resources: Resource[],
  occupancyBookings: Booking[],
  now: Date,
  visibleBookings: Booking[] = occupancyBookings
): MeetingRoomMonitoringItem[] => {
  const nowMs = now.getTime();
  const visibleById = new Map(visibleBookings.map(booking => [booking.id, booking]));
  const usableBookings = (resourceId: string) => occupancyBookings.filter(booking => booking.resourceId === resourceId
    && booking.status === 'APPROVED' && getBookingDisplayStatus(booking, now) === 'IN_PROGRESS');
  return resources.filter(resource => resource.type === 'ROOM').map(resource => {
    const current = usableBookings(resource.id).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
    const visibleCurrent = current ? visibleById.get(current.id) : undefined;
    const next = occupancyBookings.filter(booking => booking.resourceId === resource.id && booking.status === 'APPROVED'
      && getBookingDisplayStatus(booking, now) === 'UPCOMING' && Date.parse(booking.startTime) >= nowMs)
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
    const visibleNext = next ? visibleById.get(next.id) : undefined;
    const status: MeetingRoomMonitoringStatus = resource.status === 'MAINTENANCE' ? 'MAINTENANCE'
      : resource.status === 'PENDING' ? 'PENDING'
        : current ? visibleCurrent?.checkedInAt ? 'IN_USE' : 'RESERVED' : 'IDLE';
    return {
      resourceId: resource.id,
      name: resource.name,
      location: resource.location,
      capacity: resource.capacity,
      status,
      currentBooking: visibleCurrent ? {
        purpose: visibleCurrent.purpose,
        startTime: visibleCurrent.startTime,
        endTime: visibleCurrent.actualEndTime || visibleCurrent.endTime,
        checkedIn: Boolean(visibleCurrent.checkedInAt),
        checkInTime: visibleCurrent.checkedInAt
      } : undefined,
      nextBooking: visibleNext ? { startTime: visibleNext.startTime, endTime: visibleNext.endTime } : undefined
    };
  }).sort((a, b) => a.location.localeCompare(b.location, 'zh-CN', { numeric: true }) || a.name.localeCompare(b.name, 'zh-CN'));
};

export const buildOfficeMonitoring = (snapshot: Hq3dSnapshot): OfficeMonitoringItem[] => snapshot.buildings.flatMap(building =>
  building.floors.flatMap(floor => floor.rooms.filter(room => OFFICE_CATEGORIES.has(snapshot.profiles[room.uid]?.category ?? room.cat)).map(room => {
    const profile = snapshot.profiles[room.uid];
    const person = profile?.person ?? room.person;
    const department = profile?.dept ?? room.dept;
    const text = `${person} ${department} ${profile?.notes ?? room.notes}`;
    const status: OfficeMonitoringStatus = (snapshot.maintenance[room.uid]?.records || []).some(record => ['open', 'doing'].includes(record.status)) ? 'MAINTENANCE'
      : VACANT_PATTERN.test(text) ? 'VACANT' : person.trim() || department.trim() ? 'ASSIGNED' : 'UNREGISTERED';
    return {
      uid: room.uid,
      buildingId: building.id,
      buildingName: building.name,
      floorNo: floor.floorNo,
      roomNumber: room.no,
      name: profile?.label ?? room.label,
      department,
      person,
      status
    };
  }))
).sort((a, b) => a.buildingId.localeCompare(b.buildingId) || a.floorNo - b.floorNo || a.roomNumber.localeCompare(b.roomNumber, 'zh-CN', { numeric: true }));

export const getMonitoringSnapshot = async (actor: User, scope: MonitoringScope): Promise<MonitoringSnapshot> => {
  const { db, revision } = await readSnapshot();
  if (!canViewMonitoring(actor, db.roles || [], scope)) throw new HttpError(403, 'MONITORING_FORBIDDEN');
  const generatedAt = new Date().toISOString();
  if (scope === 'MEETING_ROOMS') {
    return {
      scope,
      generatedAt,
      revision,
      meetingRooms: buildMeetingRoomMonitoring(db.resources || [], db.bookings || [], new Date(), getActorDbView(db, actor).bookings || [])
    };
  }
  return {
    scope,
    generatedAt,
    revision,
    offices: buildOfficeMonitoring(await getHq3dSnapshot()),
    officeSource: 'HQ3D_ASSIGNMENT_LEDGER'
  };
};

export const handleMonitoringEvents = async (req: IncomingMessage, res: ServerResponse, actor: User, scope: MonitoringScope) => {
  await getMonitoringSnapshot(actor, scope);
  req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let closed = false;
  let refreshing = false;
  let queued = false;
  let eventId = 0;
  let unsubscribe = () => {};
  const emit = (event: string, payload: unknown) => {
    if (closed || res.writableEnded) return;
    res.write(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(refreshClock);
    unsubscribe();
    if (!res.writableEnded) res.end();
  };
  const refresh = async () => {
    if (closed || res.writableEnded) return;
    if (refreshing) { queued = true; return; }
    refreshing = true;
    try {
      const currentActor = await actorFromRequest(req);
      if (!currentActor || currentActor.id !== actor.id) {
        emit('error', { error: 'SESSION_EXPIRED', message: '登录会话已失效，请重新登录。' });
        close();
        return;
      }
      emit('snapshot', await getMonitoringSnapshot(currentActor, scope));
    } catch (error: any) {
      if (error instanceof HttpError && error.status === 403) {
        emit('error', { error: 'MONITORING_FORBIDDEN', message: '当前角色的监控查看权限已变更，实时连接已停止。' });
        close();
        return;
      }
      logEvent('error', 'monitoring.snapshot_failed', { errorName: error?.name, code: error?.code });
      emit('error', { error: 'SNAPSHOT_UNAVAILABLE', message: '监控数据暂时不可用，正在自动重试。' });
    } finally {
      refreshing = false;
      if (queued) { queued = false; void refresh(); }
    }
  };
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': ping\n\n');
  }, 15_000);
  const refreshClock = setInterval(() => void refresh(), 30_000);
  unsubscribe = subscribeMonitoringChanges(() => void refresh());
  req.on('close', close);
  res.on('close', close);
  await refresh();
};

export const handleMonitoringSnapshot = async (res: ServerResponse, actor: User, scope: MonitoringScope) => {
  send(res, 200, await getMonitoringSnapshot(actor, scope));
};
