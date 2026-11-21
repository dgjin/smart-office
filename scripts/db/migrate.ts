import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { DATABASE_NAME, dbConfig } from '../../server/config.ts';

const migrationsDir = path.resolve('server/migrations');
const config = dbConfig(true);
const connection = await mysql.createConnection({
  ...config,
  database: undefined,
  multipleStatements: true
});

try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${DATABASE_NAME}\``);
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    execution_ms INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB`);
  const [lockRows] = await connection.query<any[]>("SELECT GET_LOCK('smart_office_migration', 30) AS acquired");
  if (!lockRows[0]?.acquired) throw new Error('无法获取数据库迁移锁');
  try {
    const files = (await fs.readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
    const [appliedRows] = await connection.query<any[]>('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.map(row => [row.version, row.checksum]));
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`已执行迁移的内容发生变化：${file}`);
        continue;
      }
      const startedAt = Date.now();
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (version, checksum, execution_ms) VALUES (?, ?, ?)', [file, checksum, Date.now() - startedAt]);
      console.log(`已执行迁移 ${file}`);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('smart_office_migration')");
  }
} finally {
  await connection.end();
}
