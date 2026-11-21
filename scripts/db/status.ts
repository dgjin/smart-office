import mysql from 'mysql2/promise';
import { dbConfig, REQUIRED_MIGRATION } from '../../server/config.ts';

const connection = await mysql.createConnection(dbConfig(true));
try {
  const [rows] = await connection.query<any[]>('SELECT version, applied_at FROM schema_migrations ORDER BY version');
  console.log(JSON.stringify({ required: REQUIRED_MIGRATION, applied: rows.map(row => row.version) }, null, 2));
} finally {
  await connection.end();
}
