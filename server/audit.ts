import crypto from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getDbPool } from './db.ts';
import { DbError } from './errors.ts';

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

export type AuditQuery = {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  start?: string;
  end?: string;
  limit?: number;
};

const filterValue = (value: string | undefined, field: string) => {
  const normalized = value?.trim();
  if (normalized && normalized.length > 200) throw new DbError(`INVALID_AUDIT_${field}`, 400);
  return normalized || undefined;
};
const filterDate = (value: string | undefined, field: string) => {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new DbError(`INVALID_AUDIT_${field}`, 400);
  return new Date(time);
};

export const listAuditEvents = async (query: AuditQuery = {}) => {
  const filters = {
    actorId: filterValue(query.actorId, 'ACTOR'),
    action: filterValue(query.action, 'ACTION'),
    entityType: filterValue(query.entityType, 'ENTITY_TYPE'),
    entityId: filterValue(query.entityId, 'ENTITY_ID'),
    start: filterDate(query.start, 'START'),
    end: filterDate(query.end, 'END')
  };
  if (filters.start && filters.end && filters.end <= filters.start) throw new DbError('INVALID_AUDIT_RANGE', 400);
  const clauses: string[] = [];
  const params: Array<string | Date | number> = [];
  const addExact = (column: string, value?: string) => {
    if (!value) return;
    clauses.push(`${column} = ?`);
    params.push(value);
  };
  addExact('actor_id', filters.actorId);
  addExact('action', filters.action);
  addExact('entity_type', filters.entityType);
  addExact('entity_id', filters.entityId);
  if (filters.start) { clauses.push('created_at >= ?'); params.push(filters.start); }
  if (filters.end) { clauses.push('created_at < ?'); params.push(filters.end); }
  if (query.limit !== undefined && !Number.isSafeInteger(query.limit)) throw new DbError('INVALID_AUDIT_LIMIT', 400);
  const limit = Math.min(Math.max(query.limit || 200, 1), 500);
  params.push(limit);
  const [rows] = await getDbPool().query<any[]>(`SELECT id, actor_id, action, entity_type, entity_id, details, created_at
    FROM audit_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC LIMIT ?`, params);
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
