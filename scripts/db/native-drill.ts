import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { DATABASE_NAME, dbConfig, REQUIRED_MIGRATION } from '../../server/config.ts';
import {
  assertNativeDatabaseName,
  createNativeBackup,
  restoreNativeBackup,
  sanitizeNativeError
} from './native-shared.ts';

const DRILL_SOURCE_PATTERN = /^smart_office_test_[A-Za-z0-9_]+$/;
const CORE_TABLES = [
  'office_state',
  'bookings',
  'notifications',
  'audit_events',
  'scheduled_jobs',
  'outbox_events',
  'user_identities',
  'user_preferences'
] as const;

let temporaryDirectory = '';
let targetDatabase = '';
let targetCreated = false;
let targetDropped = false;
let temporaryFilesRemoved = false;
let migrationVerified = false;
let operationError = '';
const cleanupErrors: string[] = [];
const rowCounts: Record<string, { source: number; target: number }> = {};
let connection: mysql.Connection | undefined;

try {
  if (!DRILL_SOURCE_PATTERN.test(DATABASE_NAME)) {
    throw new Error('隔离演练仅允许源 DATABASE_NAME 匹配 ^smart_office_test_[A-Za-z0-9_]+$');
  }

  targetDatabase = `${DATABASE_NAME}_drill_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  if (targetDatabase.length > 64) throw new Error('源数据库名过长，无法生成符合 MySQL 长度限制的唯一目标库名');
  assertNativeDatabaseName(targetDatabase);
  if (!targetDatabase.startsWith(DATABASE_NAME) || !DRILL_SOURCE_PATTERN.test(targetDatabase)) {
    throw new Error('隔离演练目标库名不符合测试库前缀约束');
  }

  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-office-native-drill-'));
  const backupPath = path.join(temporaryDirectory, 'source.sql');
  await createNativeBackup(backupPath, DATABASE_NAME);

  connection = await mysql.createConnection({
    ...dbConfig(true),
    database: undefined,
    multipleStatements: false
  });
  await connection.query(
    `CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  targetCreated = true;

  await restoreNativeBackup(backupPath, targetDatabase);

  const [migrationRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT version FROM \`${targetDatabase}\`.\`schema_migrations\` WHERE version = ?`,
    [REQUIRED_MIGRATION]
  );
  if (migrationRows.length !== 1) throw new Error(`目标库缺少迁移 ${REQUIRED_MIGRATION}`);
  migrationVerified = true;

  for (const table of CORE_TABLES) {
    const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${DATABASE_NAME}\`.\`${table}\``
    );
    const [targetRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${targetDatabase}\`.\`${table}\``
    );
    const sourceCount = Number(sourceRows[0]?.count);
    const targetCount = Number(targetRows[0]?.count);
    if (!Number.isSafeInteger(sourceCount) || !Number.isSafeInteger(targetCount)) {
      throw new Error(`核心表 ${table} 的行数读取失败`);
    }
    rowCounts[table] = { source: sourceCount, target: targetCount };
    if (sourceCount !== targetCount) {
      throw new Error(`核心表 ${table} 行数不一致（源 ${sourceCount}，目标 ${targetCount}）`);
    }
  }
} catch (error) {
  operationError = sanitizeNativeError(error);
} finally {
  if (targetCreated && targetDatabase) {
    try {
      assertNativeDatabaseName(targetDatabase);
      if (!connection) {
        connection = await mysql.createConnection({
          ...dbConfig(true),
          database: undefined,
          multipleStatements: false
        });
      }
      await connection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
      targetDropped = true;
    } catch (error) {
      cleanupErrors.push(`目标库清理失败：${sanitizeNativeError(error)}`);
    }
  }

  if (connection) {
    try {
      await connection.end();
    } catch (error) {
      cleanupErrors.push(`数据库连接清理失败：${sanitizeNativeError(error)}`);
    }
  }

  if (temporaryDirectory) {
    try {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      temporaryFilesRemoved = true;
    } catch (error) {
      cleanupErrors.push(`临时文件清理失败：${sanitizeNativeError(error)}`);
    }
  } else {
    temporaryFilesRemoved = true;
  }
}

const errors = [operationError, ...cleanupErrors].filter(Boolean);
console.log(JSON.stringify({
  ok: errors.length === 0,
  sourceDatabase: DATABASE_NAME,
  targetDatabase: targetDatabase || null,
  migration: migrationVerified ? REQUIRED_MIGRATION : null,
  rowCounts,
  cleanup: {
    targetCreated,
    targetDropped: targetCreated ? targetDropped : null,
    temporaryFilesRemoved
  },
  ...(errors.length ? { error: errors.join('；') } : {})
}, null, 2));

if (errors.length) process.exitCode = 1;
