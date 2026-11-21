import type { PoolConnection } from 'mysql2/promise';
import { closeDbPool, getDbPool, readSnapshot } from '../../server/db.ts';

class CliError extends Error {}

const usage = '用法: node --env-file-if-exists=.env scripts/auth/bootstrap-admin.ts --userId <已有系统管理员ID> --issuer <OIDC issuer> --subject <OIDC subject>';

const requiredValue = (value: string | undefined, name: string, maximumLength: number) => {
  if (!value || !value.trim() || value.length > maximumLength) throw new CliError(`参数无效: ${name}\n${usage}`);
  return value;
};

const parseArguments = (argv: string[]) => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || value === undefined || !['--userId', '--user-id', '--issuer', '--subject'].includes(flag) || values.has(flag)) {
      throw new CliError(usage);
    }
    values.set(flag, value);
  }
  const userFlags = ['--userId', '--user-id'].filter(flag => values.has(flag));
  if (userFlags.length !== 1 || values.size !== 3) throw new CliError(usage);
  const userId = requiredValue(values.get(userFlags[0]), 'userId', 128);
  const issuer = requiredValue(values.get('--issuer'), 'issuer', 512);
  const subject = requiredValue(values.get('--subject'), 'subject', 255);
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new CliError(`issuer 必须是有效的 HTTP(S) URL\n${usage}`);
  }
  if (!['https:', 'http:'].includes(issuerUrl.protocol) || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new CliError(`issuer 必须是有效的 OIDC issuer URL\n${usage}`);
  }
  return { userId, issuer, subject };
};

const main = async () => {
  const { userId, issuer, subject } = parseArguments(process.argv.slice(2));
  let connection: PoolConnection | null = null;
  let locked = false;
  try {
    const { db } = await readSnapshot();
    const users = db.users || [];
    if (!users.length) throw new CliError('数据库尚无企业用户，拒绝引导身份绑定');
    const administrator = users.find(user => user.id === userId);
    if (!administrator) throw new CliError('目标内部用户不存在');
    if (!administrator.role.includes('SYSTEM_ADMIN')) throw new CliError('目标用户不是系统管理员');

    connection = await getDbPool().getConnection();
    await connection.query('LOCK TABLES user_identities WRITE');
    locked = true;
    const [rows] = await connection.query<any[]>('SELECT COUNT(*) AS count FROM user_identities');
    if (Number(rows[0]?.count || 0) !== 0) throw new CliError('数据库已存在身份绑定，不能再执行管理员引导');
    await connection.query(
      'INSERT INTO user_identities (issuer, subject, user_id) VALUES (?, ?, ?)',
      [issuer, subject, userId],
    );
    console.log(`管理员初始身份绑定已完成: ${userId}`);
  } finally {
    if (connection && locked) await connection.query('UNLOCK TABLES').catch(() => {});
    connection?.release();
    await closeDbPool();
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof CliError ? error.message : '管理员初始身份绑定失败');
  process.exitCode = 1;
}
