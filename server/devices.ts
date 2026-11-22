import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Booking, DoorDevice, User } from '../types.ts';
import { isConfidentialBooking } from './confidentiality.ts';
import { mutateDb, readSnapshot } from './db.ts';
import { DbError } from './errors.ts';
import type { OfficeDb } from './tools.ts';
import { DOOR_SNAPSHOT_MAX_AGE_MS } from '../utils/doorDisplay.ts';
import { bookingDateKey, getBookingDisplayStatus } from '../utils/bookingRules.ts';

const text = (value: unknown, field: string, max = 100) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new DbError(`INVALID_DEVICE_${field}`, 400);
  return value.trim();
};
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => `door_${crypto.randomBytes(32).toString('base64url')}`;
const sameHash = (left: string, right: string) => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const publicDevice = (device: DoorDevice) => ({
  id: device.id,
  name: device.name,
  resourceId: device.resourceId,
  status: device.status,
  tokenPrefix: device.tokenPrefix,
  createdAt: device.createdAt,
  createdBy: device.createdBy,
  updatedAt: device.updatedAt,
  lastHeartbeatAt: device.lastHeartbeatAt,
  lastSnapshotRevision: device.lastSnapshotRevision,
  restartRequestedAt: device.restartRequestedAt,
  revokedAt: device.revokedAt
});

export const listDevices = async () => {
  const { db } = await readSnapshot();
  return (db.devices || []).map(publicDevice);
};

export const createDevice = async (actor: User, input: any) => mutateDb(async (db, { audit }) => {
  const resourceId = text(input?.resourceId, 'RESOURCE_ID', 128);
  const resource = (db.resources || []).find(item => item.id === resourceId && item.type === 'ROOM');
  if (!resource) throw new DbError('DEVICE_RESOURCE_NOT_FOUND', 404);
  if ((db.devices || []).some(item => item.resourceId === resourceId && item.status === 'ACTIVE')) {
    throw new DbError('DEVICE_RESOURCE_ALREADY_BOUND', 409);
  }
  const now = new Date().toISOString();
  const token = newToken();
  const device: DoorDevice = {
    id: `door-${crypto.randomUUID()}`,
    name: text(input?.name, 'NAME'),
    resourceId,
    status: 'ACTIVE',
    tokenHash: tokenHash(token),
    tokenPrefix: token.slice(0, 12),
    createdAt: now,
    createdBy: actor.id,
    updatedAt: now
  };
  db.devices = [device, ...(db.devices || [])];
  await audit({ actorId: actor.id, action: 'DEVICE_CREATE', entityType: 'DEVICE', entityId: device.id, details: { resourceId, tokenPrefix: device.tokenPrefix } });
  return { device: publicDevice(device), token };
});

export const rotateDevice = async (actor: User, id: string) => mutateDb(async (db, { audit }) => {
  const current = (db.devices || []).find(item => item.id === id);
  if (!current) throw new DbError('DEVICE_NOT_FOUND', 404);
  if (current.status !== 'ACTIVE') throw new DbError('DEVICE_REVOKED', 409);
  const token = newToken();
  const next: DoorDevice = { ...current, tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 12), updatedAt: new Date().toISOString() };
  db.devices = (db.devices || []).map(item => item.id === id ? next : item);
  await audit({ actorId: actor.id, action: 'DEVICE_TOKEN_ROTATE', entityType: 'DEVICE', entityId: id, details: { tokenPrefix: next.tokenPrefix } });
  return { device: publicDevice(next), token };
});

export const restartDevice = async (actor: User, id: string) => mutateDb(async (db, { audit }) => {
  const current = (db.devices || []).find(item => item.id === id);
  if (!current) throw new DbError('DEVICE_NOT_FOUND', 404);
  if (current.status !== 'ACTIVE') throw new DbError('DEVICE_REVOKED', 409);
  const now = new Date().toISOString();
  const next = { ...current, restartRequestedAt: now, updatedAt: now };
  db.devices = (db.devices || []).map(item => item.id === id ? next : item);
  await audit({ actorId: actor.id, action: 'DEVICE_RESTART_REQUEST', entityType: 'DEVICE', entityId: id });
  return publicDevice(next);
});

export const revokeDevice = async (actor: User, id: string) => mutateDb(async (db, { audit }) => {
  const current = (db.devices || []).find(item => item.id === id);
  if (!current) throw new DbError('DEVICE_NOT_FOUND', 404);
  if (current.status === 'REVOKED') return publicDevice(current);
  const now = new Date().toISOString();
  const next = { ...current, status: 'REVOKED' as const, updatedAt: now, revokedAt: now };
  db.devices = (db.devices || []).map(item => item.id === id ? next : item);
  await audit({ actorId: actor.id, action: 'DEVICE_REVOKE', entityType: 'DEVICE', entityId: id });
  return publicDevice(next);
});

const authenticate = async (req: IncomingMessage) => {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer (door_[A-Za-z0-9_-]{20,200})$/);
  if (!match) throw new DbError('DEVICE_UNAUTHENTICATED', 401);
  const hash = tokenHash(match[1]);
  const { db, revision } = await readSnapshot();
  const device = (db.devices || []).find(item => item.status === 'ACTIVE' && sameHash(item.tokenHash, hash));
  if (!device) throw new DbError('DEVICE_UNAUTHENTICATED', 401);
  return { db, revision, device };
};

const scheduleItem = (booking: Booking, now: Date, requester?: User) => {
  const confidential = isConfidentialBooking(booking);
  return {
    id: booking.id,
    startTime: booking.startTime,
    endTime: booking.actualEndTime || booking.endedEarlyAt || booking.endTime,
    purpose: confidential ? '涉密会议' : booking.purpose,
    department: confidential ? undefined : requester?.department,
    confidential,
    status: getBookingDisplayStatus(booking, now)
  };
};

const deviceSnapshot = (db: OfficeDb, revision: number, device: DoorDevice) => {
  const resource = (db.resources || []).find(item => item.id === device.resourceId);
  if (!resource) throw new DbError('DEVICE_RESOURCE_NOT_FOUND', 410);
  const generatedAt = Date.now();
  const start = Date.parse(`${bookingDateKey(generatedAt)}T00:00:00+08:00`);
  const end = start + 86400000;
  const bookings = (db.bookings || []).filter(booking => booking.resourceId === resource.id
    && ['APPROVED', 'COMPLETED', 'CANCELLED'].includes(booking.status)
    && Date.parse(booking.startTime) < end && Date.parse(booking.actualEndTime || booking.endedEarlyAt || booking.endTime) > start)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .map(booking => scheduleItem(booking, new Date(generatedAt), (db.users || []).find(user => user.id === booking.userId)));
  return {
    generatedAt: new Date(generatedAt).toISOString(),
    expiresAt: new Date(generatedAt + DOOR_SNAPSHOT_MAX_AGE_MS).toISOString(),
    revision,
    device: publicDevice(device),
    resource: {
      id: resource.id,
      code: resource.code,
      name: resource.name,
      location: resource.location,
      building: resource.building,
      floor: resource.floor,
      roomNumber: resource.roomNumber,
      capacity: resource.capacity,
      status: resource.status
    },
    bookings
  };
};

export const getDeviceSnapshot = async (req: IncomingMessage) => {
  const { db, revision, device } = await authenticate(req);
  return deviceSnapshot(db, revision, device);
};

export const heartbeatDevice = async (req: IncomingMessage, input: any) => {
  const { device } = await authenticate(req);
  if (input?.lastSnapshotRevision !== undefined && (!Number.isSafeInteger(input.lastSnapshotRevision) || input.lastSnapshotRevision < 0)) {
    throw new DbError('INVALID_DEVICE_SNAPSHOT_REVISION', 400);
  }
  return mutateDb(async (db, { audit }) => {
    const current = (db.devices || []).find(item => item.id === device.id && item.status === 'ACTIVE');
    if (!current || !sameHash(current.tokenHash, device.tokenHash)) throw new DbError('DEVICE_UNAUTHENTICATED', 401);
    const now = new Date().toISOString();
    const changed = current.lastHeartbeatAt !== now || (input?.lastSnapshotRevision !== undefined && current.lastSnapshotRevision !== input.lastSnapshotRevision);
    const next = {
      ...current,
      lastHeartbeatAt: now,
      lastSnapshotRevision: input?.lastSnapshotRevision ?? current.lastSnapshotRevision,
      updatedAt: now
    };
    db.devices = (db.devices || []).map(item => item.id === current.id ? next : item);
    if (!current.lastHeartbeatAt) await audit({ action: 'DEVICE_FIRST_HEARTBEAT', entityType: 'DEVICE', entityId: current.id });
    return { ok: true, receivedAt: now, device: publicDevice(next), changed };
  }, { snapshot: false });
};

export const validateDeviceBackup = (input: any, db: Pick<OfficeDb, 'resources' | 'users'>): DoorDevice[] => {
  if (!Array.isArray(input)) throw new DbError('INVALID_BACKUP_DEVICE', 400);
  const devices = input.map((item: any): DoorDevice => {
    if (!item || !['ACTIVE', 'REVOKED'].includes(item.status) || !/^[a-f0-9]{64}$/.test(item.tokenHash || '')
      || !(db.resources || []).some(resource => resource.id === item.resourceId && resource.type === 'ROOM')
      || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))
      || (item.lastHeartbeatAt !== undefined && !Number.isFinite(Date.parse(item.lastHeartbeatAt)))
      || (item.restartRequestedAt !== undefined && !Number.isFinite(Date.parse(item.restartRequestedAt)))
      || (item.lastSnapshotRevision !== undefined && (!Number.isSafeInteger(item.lastSnapshotRevision) || item.lastSnapshotRevision < 0))) {
      throw new DbError('INVALID_BACKUP_DEVICE', 400);
    }
    return {
      id: text(item.id, 'ID', 128), name: text(item.name, 'NAME'), resourceId: text(item.resourceId, 'RESOURCE_ID', 128),
      status: item.status, tokenHash: item.tokenHash, tokenPrefix: text(item.tokenPrefix, 'TOKEN_PREFIX', 32),
      createdAt: new Date(item.createdAt).toISOString(), createdBy: text(item.createdBy, 'CREATED_BY', 128),
      updatedAt: new Date(item.updatedAt).toISOString(), lastHeartbeatAt: item.lastHeartbeatAt ? new Date(item.lastHeartbeatAt).toISOString() : undefined,
      lastSnapshotRevision: item.lastSnapshotRevision, restartRequestedAt: item.restartRequestedAt ? new Date(item.restartRequestedAt).toISOString() : undefined,
      revokedAt: item.revokedAt ? new Date(item.revokedAt).toISOString() : undefined
    };
  });
  if (new Set(devices.map(item => item.id)).size !== devices.length) throw new DbError('INVALID_BACKUP_DEVICE', 400);
  if (new Set(devices.filter(item => item.status === 'ACTIVE').map(item => item.resourceId)).size !== devices.filter(item => item.status === 'ACTIVE').length) {
    throw new DbError('INVALID_BACKUP_DEVICE', 400);
  }
  return devices;
};
