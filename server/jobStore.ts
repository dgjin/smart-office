import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';

export type JobInstruction = {
  key: string;
  type: 'BOOKING_REMINDER' | 'BOOKING_CHECK_IN_REMINDER' | 'BOOKING_NO_SHOW'
    | 'APPROVAL_REMINDER' | 'APPROVAL_ESCALATION' | 'APPROVAL_CLOSE'
    | 'SERVICE_SLA_ESCALATION' | 'SERVICE_INSPECTION';
  runAt: Date;
  payload: {
    bookingId?: string;
    workOrderId?: string;
    areaId?: string;
    inspectionId?: string;
    scheduleVersion?: number;
    nodeIndex?: number;
    submittedAt?: string;
  };
};

export const scheduleJob = async (conn: PoolConnection, job: JobInstruction) => {
  await conn.query(`INSERT IGNORE INTO scheduled_jobs (id, job_key, job_type, payload, run_at)
    VALUES (?, ?, ?, ?, ?)`, [crypto.randomUUID(), job.key, job.type, JSON.stringify(job.payload), job.runAt]);
};

export const enqueueOutbox = async (conn: PoolConnection, event: { key: string; type: string; payload: unknown }) => {
  await conn.query(`INSERT IGNORE INTO outbox_events (id, event_key, event_type, payload)
    VALUES (?, ?, ?, ?)`, [crypto.randomUUID(), event.key, event.type, JSON.stringify(event.payload)]);
};
