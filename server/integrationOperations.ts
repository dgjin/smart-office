import crypto from 'node:crypto';
import type { User } from '../types.ts';
import { writeAudit } from './audit.ts';
import { getDbPool, mutateDb, readDb } from './db.ts';
import { HttpError } from './http.ts';
import { reconcileCurrentIntegrations } from './integrationDomain.ts';

const requireAdmin = (actor: User) => {
  if (!actor.role.includes('SYSTEM_ADMIN')) throw new HttpError(403, 'FORBIDDEN');
};

const safeError = (value: unknown) => {
  const text = String(value || '');
  return /^[A-Z][A-Z0-9_]{1,199}$/.test(text) ? text : text ? 'DELIVERY_FAILED' : undefined;
};

export const getIntegrationOperations = async (actor: User) => {
  requireAdmin(actor);
  const db = await readDb();
  const [rows] = await getDbPool().query<any[]>(`SELECT event_key, event_type, payload, status, attempts, max_attempts,
    available_at, processed_at, last_error, created_at FROM outbox_events
    WHERE event_type IN ('CALENDAR_SYNC', 'ACCESS_CONTROL') ORDER BY created_at DESC LIMIT 200`);
  const deliveries = db.integrationDeliveries || [];
  const events = rows.map(row => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const delivery = deliveries.find(item => item.eventKey === row.event_key);
    return {
      eventKey: row.event_key,
      eventType: row.event_type,
      bookingId: payload.bookingId,
      scheduleVersion: payload.scheduleVersion,
      operation: payload.operation,
      status: row.status,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      availableAt: row.available_at ? new Date(row.available_at).toISOString() : undefined,
      processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
      lastError: safeError(row.last_error),
      createdAt: new Date(row.created_at).toISOString(),
      delivery: delivery ? {
        outcome: delivery.outcome,
        reason: safeError(delivery.reason),
        httpStatus: delivery.httpStatus,
        processedAt: delivery.processedAt
      } : undefined
    };
  });
  return {
    summary: {
      pending: events.filter(item => ['PENDING', 'RUNNING'].includes(item.status)).length,
      failed: events.filter(item => item.status === 'FAILED').length,
      stale: events.filter(item => item.delivery?.outcome === 'STALE').length,
      accessPendingAcknowledgement: (db.accessAuthorizationFacts || []).filter(item =>
        item.status === 'PENDING' || (item.revokedAt && !item.revocationAcknowledgedAt)).length
    },
    events,
    callbacks: (db.externalCallbacks || []).slice(0, 100).map(({ payloadHash: _payloadHash, nonce: _nonce, ...callback }) => callback),
    compensations: (db.externalCompensations || []).slice(0, 100),
    accessFacts: (db.accessAuthorizationFacts || []).slice(0, 200)
  };
};

export const reconcileIntegrations = async (actor: User) => {
  requireAdmin(actor);
  return mutateDb(async (db, { enqueueOutbox, audit }) => {
    const result = await reconcileCurrentIntegrations(db, enqueueOutbox);
    await audit({ actorId: actor.id, action: 'INTEGRATION_RECONCILE', entityType: 'INTEGRATION', entityId: 'CURRENT', details: result });
    return result;
  });
};

export const replayIntegrationEvent = async (actor: User, eventKey: string) => {
  requireAdmin(actor);
  const conn = await getDbPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<any[]>('SELECT event_key, event_type, status FROM outbox_events WHERE event_key = ? FOR UPDATE', [eventKey]);
    const event = rows[0];
    if (!event || !['CALENDAR_SYNC', 'ACCESS_CONTROL'].includes(event.event_type)) throw new HttpError(404, 'INTEGRATION_EVENT_NOT_FOUND');
    if (event.status !== 'FAILED') throw new HttpError(409, 'INTEGRATION_EVENT_NOT_REPLAYABLE');
    await conn.query(`UPDATE outbox_events SET status = 'PENDING', attempts = 0, available_at = UTC_TIMESTAMP(3),
      lease_owner = NULL, lease_expires_at = NULL, processed_at = NULL, last_error = NULL WHERE event_key = ?`, [eventKey]);
    await writeAudit(conn, { actorId: actor.id, action: 'INTEGRATION_EVENT_REPLAY', entityType: 'OUTBOX_EVENT', entityId: eventKey, details: { eventType: event.event_type } });
    await conn.commit();
    return { eventKey, status: 'PENDING' as const };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

export const recordIntegrationCompensation = async (actor: User, input: any) => {
  requireAdmin(actor);
  const eventKey = typeof input?.eventKey === 'string' ? input.eventKey : '';
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (!eventKey || eventKey.length > 255 || note.length < 2 || note.length > 1000) throw new HttpError(400, 'INTEGRATION_COMPENSATION_INVALID');
  const [rows] = await getDbPool().query<any[]>('SELECT event_key FROM outbox_events WHERE event_key = ? AND event_type IN (?, ?)', [eventKey, 'CALENDAR_SYNC', 'ACCESS_CONTROL']);
  if (!rows.length) throw new HttpError(404, 'INTEGRATION_EVENT_NOT_FOUND');
  return mutateDb(async (db, { audit }) => {
    const compensation = {
      id: `compensation-${crypto.randomUUID()}`,
      eventKey,
      note,
      createdAt: new Date().toISOString(),
      createdBy: actor.id
    };
    db.externalCompensations = [compensation, ...(db.externalCompensations || [])].slice(0, 1000);
    await audit({ actorId: actor.id, action: 'INTEGRATION_COMPENSATION_RECORDED', entityType: 'OUTBOX_EVENT', entityId: eventKey, details: { compensationId: compensation.id } });
    return compensation;
  });
};
