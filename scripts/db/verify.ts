import mysql from 'mysql2/promise';
import { dbConfig, REQUIRED_MIGRATION } from '../../server/config.ts';

const connection = await mysql.createConnection(dbConfig());
try {
  const [migration] = await connection.query<any[]>('SELECT version FROM schema_migrations WHERE version = ?', [REQUIRED_MIGRATION]);
  if (!migration.length) throw new Error(`缺少迁移 ${REQUIRED_MIGRATION}`);
  const [[meta]] = await connection.query<any[]>('SELECT revision FROM office_snapshot_meta WHERE id = 1');
  if (!meta || Number(meta.revision) < 1) throw new Error('快照 revision 未初始化');
  const counts: Record<string, number> = {};
  for (const table of ['office_state', 'bookings', 'notifications', 'user_identities', 'sessions', 'user_preferences', 'audit_events']) {
    const [rows] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(rows[0].count);
  }
  console.log(JSON.stringify({ ok: true, migration: REQUIRED_MIGRATION, revision: Number(meta.revision), counts }, null, 2));
} finally {
  await connection.end();
}
