import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getDbPool } from './db.ts';

export type AuditInput = {
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
};

export const writeAudit = async (conn: PoolConnection, input: AuditInput) => {
  await conn.query(`INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)`, [
    crypto.randomUUID(), input.actorId || null, input.action, input.entityType, input.entityId,
    JSON.stringify(input.details || {})
  ]);
};

export const recordAudit = async (input: AuditInput) => {
  const conn = await getDbPool().getConnection();
  try {
    await writeAudit(conn, input);
  } finally {
    conn.release();
  }
};

export const listAuditEvents = async (limit = 200) => {
  const [rows] = await getDbPool().query<any[]>(`SELECT id, actor_id, action, entity_type, entity_id, details, created_at
    FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?`, [Math.min(Math.max(limit, 1), 500)]);
  return rows.map(row => ({
    id: row.id,
    actorId: row.actor_id || undefined,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
    createdAt: new Date(row.created_at).toISOString()
  }));
};
