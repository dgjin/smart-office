import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getDbPool, readDb } from '../db.ts';
import { IS_PRODUCTION, SESSION_COOKIE } from '../config.ts';
import type { User } from '../../types.ts';

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const cookieMap = (req: IncomingMessage) => Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const index = part.indexOf('=');
  return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
}));

export const sessionCookie = (token: string, clear = false) => {
  const parts = [`${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (IS_PRODUCTION) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : 'Max-Age=604800');
  return parts.join('; ');
};

export const createSession = async (userId: string) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  await getDbPool().query(`INSERT INTO sessions (id, token_hash, user_id, idle_expires_at, absolute_expires_at)
    VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL 8 HOUR), DATE_ADD(NOW(3), INTERVAL 7 DAY))`, [id, hash(token), userId]);
  return token;
};

export const revokeSession = async (req: IncomingMessage) => {
  const token = cookieMap(req)[SESSION_COOKIE];
  if (!token) return;
  await getDbPool().query('UPDATE sessions SET revoked_at = NOW(3) WHERE token_hash = ? AND revoked_at IS NULL', [hash(token)]);
};

export const actorFromRequest = async (req: IncomingMessage): Promise<User | null> => {
  const token = cookieMap(req)[SESSION_COOKIE];
  if (!token) return null;
  const [rows] = await getDbPool().query<any[]>(`SELECT id, user_id FROM sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND idle_expires_at > NOW(3) AND absolute_expires_at > NOW(3)`, [hash(token)]);
  if (!rows[0]) return null;
  const db = await readDb();
  const user = (db.users || []).find(item => item.id === rows[0].user_id);
  if (!user || user.status === 'DISABLED') return null;
  await getDbPool().query(`UPDATE sessions SET last_seen_at = NOW(3),
    idle_expires_at = LEAST(absolute_expires_at, DATE_ADD(NOW(3), INTERVAL 8 HOUR)) WHERE id = ?`, [rows[0].id]);
  return user;
};
