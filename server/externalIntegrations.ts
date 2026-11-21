import type { AccessControlPayload, CalendarSyncPayload, IntegrationEventPayload } from './integrationDomain.ts';
import { isIntegrationPayloadCurrent } from './integrationDomain.ts';
import { mutateDb, readDb } from './db.ts';
import { IS_PRODUCTION } from './config.ts';
import type { IntegrationDelivery } from '../types.ts';
import crypto from 'node:crypto';

export type IntegrationDeliveryResult =
  | { outcome: 'DELIVERED'; status: number }
  | { outcome: 'SKIPPED' | 'STALE'; reason: string };

type IntegrationEventType = 'CALENDAR_SYNC' | 'ACCESS_CONTROL';

const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validText = (value: unknown, max = 200) => typeof value === 'string' && Boolean(value) && value.length <= max;
const validBase = (value: any) => value && validText(value.bookingId, 128)
  && Number.isInteger(value.scheduleVersion) && value.scheduleVersion > 0
  && validDate(value.startTime || value.validFrom) && validDate(value.endTime || value.validTo)
  && validDate(value.occurredAt);

const validPayload = (eventType: IntegrationEventType, value: any): IntegrationEventPayload => {
  if (!validBase(value)) throw new Error('INTEGRATION_DELIVERY_PAYLOAD_INVALID');
  if (eventType === 'CALENDAR_SYNC') {
    if (!['UPSERT', 'CANCEL'].includes(value.operation) || !validText(value.title, 500)
      || (value.location !== undefined && (typeof value.location !== 'string' || value.location.length > 200))
      || !Array.isArray(value.attendees) || value.attendees.length > 1000
      || value.attendees.some((item: unknown) => !validText(item, 255))) {
      throw new Error('INTEGRATION_DELIVERY_PAYLOAD_INVALID');
    }
    const payload: CalendarSyncPayload = {
      bookingId: value.bookingId,
      scheduleVersion: value.scheduleVersion,
      operation: value.operation,
      title: value.title,
      startTime: value.startTime,
      endTime: value.endTime,
      location: value.location,
      attendees: [...value.attendees],
      occurredAt: value.occurredAt
    };
    return payload;
  }
  if (!['GRANT', 'REVOKE'].includes(value.operation) || !validText(value.resourceId, 128)
    || !['APPROVED', 'CANCELLED', 'RESCHEDULED', 'EARLY_END', 'ATTENDEE_REMOVED', 'USER_DISABLED'].includes(value.reason)
    || !Array.isArray(value.subjects) || !value.subjects.length || value.subjects.length > 1000
    || value.subjects.some((item: any) => !item || !validText(item.userId, 128) || !validText(item.externalId, 255))) {
    throw new Error('INTEGRATION_DELIVERY_PAYLOAD_INVALID');
  }
  const payload: AccessControlPayload = {
    bookingId: value.bookingId,
    scheduleVersion: value.scheduleVersion,
    operation: value.operation,
    resourceId: value.resourceId,
    validFrom: value.validFrom,
    validTo: value.validTo,
    subjects: value.subjects.map((item: any) => ({ userId: item.userId, externalId: item.externalId })),
    reason: value.reason,
    occurredAt: value.occurredAt
  };
  return payload;
};

const configFor = (eventType: IntegrationEventType) => {
  const prefix = eventType === 'CALENDAR_SYNC' ? 'SMART_OFFICE_CALENDAR' : 'SMART_OFFICE_ACCESS';
  return {
    enabled: process.env[`${prefix}_ENABLED`] === 'true',
    endpoint: process.env[`${prefix}_URL`] || '',
    authToken: process.env[`${prefix}_AUTH_TOKEN`] || ''
  };
};

const deliveryEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (IS_PRODUCTION && url.protocol !== 'https:')) throw new Error();
    return url;
  } catch {
    throw new Error('INTEGRATION_DELIVERY_CONFIG_INVALID');
  }
};

const requestBody = (payload: IntegrationEventPayload) => 'attendees' in payload
  ? {
      eventId: payload.bookingId,
      scheduleVersion: payload.scheduleVersion,
      operation: payload.operation,
      title: payload.title,
      startTime: payload.startTime,
      endTime: payload.endTime,
      location: payload.location,
      attendees: payload.attendees,
      occurredAt: payload.occurredAt
    }
  : {
      authorizationId: `${payload.bookingId}:v${payload.scheduleVersion}`,
      scheduleVersion: payload.scheduleVersion,
      operation: payload.operation,
      resourceId: payload.resourceId,
      validFrom: payload.validFrom,
      validTo: payload.validTo,
      subjects: payload.subjects.map(item => ({ subject: item.externalId })),
      reason: payload.reason,
      occurredAt: payload.occurredAt
    };

export const deliverIntegrationEvent = async (eventType: IntegrationEventType, input: unknown, idempotencyKey: string): Promise<IntegrationDeliveryResult> => {
  const payload = validPayload(eventType, input);
  const config = configFor(eventType);
  if (!config.enabled) return { outcome: 'SKIPPED', reason: 'DISABLED' };
  if (!isIntegrationPayloadCurrent(await readDb(), payload)) return { outcome: 'STALE', reason: 'BOOKING_STATE_CHANGED' };
  const endpoint = deliveryEndpoint(config.endpoint);
  const controller = new AbortController();
  const configured = Number(process.env.SMART_OFFICE_EXTERNAL_HTTP_TIMEOUT_MS);
  const timeoutMs = Number.isSafeInteger(configured) && configured >= 100 && configured <= 30000 ? configured : 5000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {})
      },
      body: JSON.stringify(requestBody(payload)),
      signal: controller.signal
    });
    const status = response.status;
    await response.body?.cancel();
    if (status < 200 || status >= 300) throw new Error(`INTEGRATION_DELIVERY_HTTP_${status}`);
    return { outcome: 'DELIVERED', status };
  } catch (error) {
    if (error instanceof Error && /^INTEGRATION_DELIVERY_HTTP_\d{3}$/.test(error.message)) throw error;
    if (controller.signal.aborted) throw new Error('INTEGRATION_DELIVERY_TIMEOUT');
    throw new Error('INTEGRATION_DELIVERY_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
};

export const recordIntegrationDelivery = async (
  eventKey: string,
  eventType: IntegrationEventType,
  input: unknown,
  result: IntegrationDeliveryResult | { outcome: 'FAILED'; reason: string }
) => mutateDb(async (db, { audit }) => {
  const payload = validPayload(eventType, input);
  const processedAt = new Date().toISOString();
  const delivery: IntegrationDelivery = {
    id: crypto.randomUUID(),
    eventKey,
    eventType,
    outcome: result.outcome,
    reason: result.outcome === 'DELIVERED' ? undefined : result.reason.slice(0, 200),
    httpStatus: result.outcome === 'DELIVERED' ? result.status : undefined,
    processedAt
  };
  db.integrationDeliveries = [delivery, ...(db.integrationDeliveries || [])].slice(0, 5000);
  if (eventType === 'ACCESS_CONTROL' && result.outcome === 'DELIVERED') {
    const access = payload as AccessControlPayload;
    if (access.operation === 'GRANT' && !isIntegrationPayloadCurrent(db, access)) {
      db.integrationDeliveries[0] = { ...delivery, outcome: 'STALE', reason: 'BOOKING_STATE_CHANGED', httpStatus: undefined };
    } else {
      db.accessAuthorizationFacts = (db.accessAuthorizationFacts || []).map(fact => {
        if (fact.bookingId !== access.bookingId || fact.scheduleVersion !== access.scheduleVersion
          || !access.subjects.some(subject => subject.userId === fact.userId)) return fact;
        if (access.operation === 'GRANT') {
          return fact.status === 'REVOKED' ? fact : { ...fact, status: 'AUTHORIZED' as const, grantAcknowledgedAt: processedAt };
        }
        return { ...fact, status: 'REVOKED' as const, revokedAt: fact.revokedAt || access.occurredAt, revocationAcknowledgedAt: processedAt };
      });
    }
  }
  await audit({
    action: 'INTEGRATION_DELIVERY_RECORDED', entityType: 'OUTBOX_EVENT', entityId: eventKey,
    details: { eventType, outcome: db.integrationDeliveries[0].outcome, reason: db.integrationDeliveries[0].reason, httpStatus: db.integrationDeliveries[0].httpStatus }
  });
  return delivery;
});
