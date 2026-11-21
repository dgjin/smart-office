import { spawn, execFile, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';

const root = path.resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);

export const integrationEnabled = process.env.SMART_OFFICE_TEST_MYSQL === 'true'
  && /^smart_office_test_[A-Za-z0-9_]+$/.test(process.env.MYSQL_DATABASE || '');

const connection = async () => mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE,
  timezone: 'Z'
});

export const queryTestDb = async <T = any>(sql: string, values: any[] = []): Promise<T> => {
  if (!integrationEnabled) throw new Error('集成测试数据库未显式启用');
  const db = await connection();
  try {
    const [rows] = await db.query(sql, values);
    return rows as T;
  } finally {
    await db.end();
  }
};

export const resetTestDb = async () => {
  if (!integrationEnabled) throw new Error('只允许清理由 smart_office_test_ 前缀标识的测试数据库');
  const db = await connection();
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['oidc_auth_requests', 'user_identities', 'sessions', 'user_preferences', 'chatdock_conversations', 'scheduled_jobs', 'outbox_events', 'audit_events', 'notifications', 'bookings', 'office_state']) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    await db.query('UPDATE office_snapshot_meta SET revision = 1 WHERE id = 1');
  } finally {
    await db.end();
  }
  await exec(process.execPath, ['scripts/db/seed.ts'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 30_000
  });
};

const freePort = async () => {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('无法分配测试端口');
  const port = address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return port;
};

export class TestServer {
  private child: ChildProcess | null = null;
  private output = '';
  private port: number | null = null;
  baseUrl = '';

  async start(extraEnv: NodeJS.ProcessEnv | ((baseUrl: string) => NodeJS.ProcessEnv) = {}) {
    if (!integrationEnabled) throw new Error('集成测试未启用');
    const port = this.port ?? await freePort();
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.output = '';
    const resolvedEnv = typeof extraEnv === 'function' ? extraEnv(this.baseUrl) : extraEnv;
    this.child = spawn(process.execPath, ['server/index.ts'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        SMART_OFFICE_DEV_AUTH: 'true',
        SMART_OFFICE_HOST: '127.0.0.1',
        SMART_OFFICE_PORT: String(port),
        ...resolvedEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child.stdout?.on('data', chunk => { this.output = `${this.output}${chunk}`.slice(-8000); });
    this.child.stderr?.on('data', chunk => { this.output = `${this.output}${chunk}`.slice(-8000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (this.child.exitCode !== null) throw new Error(`测试 Node 提前退出：${this.output}`);
      try {
        const response = await fetch(`${this.baseUrl}/healthz`);
        if (response.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`测试 Node 启动超时：${this.output}`);
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('测试 Node 未优雅退出')), 5000))]);
    this.child = null;
  }

  async request(pathname: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
      headers.set('Origin', this.baseUrl);
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${this.baseUrl}${pathname}`, { ...options, headers, redirect: 'manual' });
  }

  async login(userId: string) {
    const response = await this.request(`/api/auth/dev?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error(`开发身份登录失败：${response.status}`);
    const rawCookie = response.headers.get('set-cookie') || '';
    const cookie = rawCookie.split(';')[0];
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    return { cookie, token, body: await response.json() as any };
  }
}
