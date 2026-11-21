import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DATABASE_NAME, dbConfig } from '../../server/config.ts';

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const MAX_STDERR_LENGTH = 16_384;

type NativeClientConfig = ReturnType<typeof dbConfig>;

interface NativeBackupResult {
  outputPath: string;
  checksumPath: string;
  sha256: string;
}

interface NativeProcessFiles {
  inputPath?: string;
  outputPath?: string;
}

export function assertNativeDatabaseName(databaseName: string): void {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('数据库名只能包含字母、数字和下划线');
  }
}

function sensitiveValues(extraValues: Array<string | undefined> = []): string[] {
  const migrationConfig = dbConfig(true);
  const regularConfig = dbConfig(false);
  return [
    ...extraValues,
    migrationConfig.password,
    regularConfig.password,
    migrationConfig.user,
    regularConfig.user,
    migrationConfig.host,
    regularConfig.host,
    process.env.MYSQL_PASSWORD,
    process.env.MYSQL_MIGRATION_PASSWORD
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
}

export function sanitizeNativeText(value: string, extraSecrets: Array<string | undefined> = []): string {
  let sanitized = value;
  for (const secret of sensitiveValues(extraSecrets)) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
    const encodedSecret = encodeURIComponent(secret);
    if (encodedSecret !== secret) sanitized = sanitized.split(encodedSecret).join('[REDACTED]');
  }
  sanitized = sanitized.replace(
    /((?:password|passwd|pwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1[REDACTED]'
  );
  return sanitized.trim().slice(0, 4_000);
}

export function sanitizeNativeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeNativeText(message) || '未知错误';
}

function quoteOptionFileValue(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

async function withPasswordFile<T>(
  password: string,
  action: (passwordFilePath: string) => Promise<T>
): Promise<T> {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-office-native-client-'));
  const passwordFilePath = path.join(temporaryDirectory, 'client.cnf');
  try {
    await fs.writeFile(passwordFilePath, `[client]\npassword=${quoteOptionFileValue(password)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    await fs.chmod(passwordFilePath, 0o600);
    return await action(passwordFilePath);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function commonClientArguments(config: NativeClientConfig, passwordFilePath: string): string[] {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error('MySQL 端口配置无效');
  }
  return [
    `--defaults-extra-file=${passwordFilePath}`,
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`
  ];
}

async function runNativeClient(
  command: 'mysqldump' | 'mysql',
  args: string[],
  files: NativeProcessFiles,
  config: NativeClientConfig
): Promise<void> {
  const childEnvironment = { ...process.env };
  delete childEnvironment.MYSQL_PWD;

  const child = spawn(command, args, {
    env: childEnvironment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < MAX_STDERR_LENGTH) {
      stderr = (stderr + chunk).slice(0, MAX_STDERR_LENGTH);
    }
  });

  const settleStream = (streamPromise: Promise<unknown>): Promise<unknown> =>
    streamPromise.then(() => null, error => error);

  const inputResult = files.inputPath
    ? settleStream(pipeline(createReadStream(files.inputPath), child.stdin))
    : (child.stdin.end(), Promise.resolve(null));
  const outputResult = files.outputPath
    ? settleStream(pipeline(
        child.stdout,
        createWriteStream(files.outputPath, { flags: 'wx', mode: 0o600 })
      ))
    : (child.stdout.resume(), Promise.resolve(null));

  const completion = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>(resolve => {
    let spawnError: Error | undefined;
    child.once('error', error => {
      spawnError = error;
    });
    child.once('close', (code, signal) => resolve({ code, signal, error: spawnError }));
  });

  const outcome = await completion;
  const [inputError, outputError] = await Promise.all([inputResult, outputResult]);
  const secrets = [config.password, config.user, config.host];

  if (outcome.error) {
    throw new Error(`${command} 启动失败：${sanitizeNativeText(outcome.error.message, secrets)}`);
  }
  if (outcome.code !== 0 || outcome.signal) {
    const detail = sanitizeNativeText(stderr, secrets);
    const status = outcome.signal ? `被信号 ${outcome.signal} 终止` : `退出码 ${outcome.code}`;
    throw new Error(`${command} 执行失败（${status}）${detail ? `：${detail}` : ''}`);
  }

  const streamError = inputError || outputError;
  if (streamError) {
    throw new Error(`${command} 文件流处理失败：${sanitizeNativeError(streamError)}`);
  }
}

async function calculateSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function createNativeBackup(
  requestedOutputPath: string,
  databaseName = DATABASE_NAME
): Promise<NativeBackupResult> {
  assertNativeDatabaseName(databaseName);
  const outputPath = path.resolve(requestedOutputPath);
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.partial`
  );
  const config = { ...dbConfig(true), database: databaseName };

  await fs.mkdir(outputDirectory, { recursive: true });
  try {
    await withPasswordFile(config.password, async passwordFilePath => {
      await runNativeClient('mysqldump', [
        ...commonClientArguments(config, passwordFilePath),
        '--single-transaction',
        '--quick',
        '--no-tablespaces',
        '--default-character-set=utf8mb4',
        '--hex-blob',
        databaseName
      ], { outputPath: temporaryPath }, config);
    });

    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size === 0) throw new Error('mysqldump 未生成非空 SQL 文件');

    const sha256 = await calculateSha256(temporaryPath);
    await fs.rename(temporaryPath, outputPath);
    const checksumPath = `${outputPath}.sha256`;
    await fs.writeFile(checksumPath, `${sha256}  ${path.basename(outputPath)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    return { outputPath, checksumPath, sha256 };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function restoreNativeBackup(
  requestedInputPath: string,
  databaseName = DATABASE_NAME
): Promise<{ inputPath: string }> {
  assertNativeDatabaseName(databaseName);
  const inputPath = path.resolve(requestedInputPath);
  const stat = await fs.stat(inputPath);
  if (!stat.isFile() || stat.size === 0) throw new Error('恢复输入必须是非空 SQL 文件');

  const config = { ...dbConfig(true), database: databaseName };
  await withPasswordFile(config.password, async passwordFilePath => {
    await runNativeClient('mysql', [
      ...commonClientArguments(config, passwordFilePath),
      '--default-character-set=utf8mb4',
      '--binary-mode',
      databaseName
    ], { inputPath }, config);
  });
  return { inputPath };
}
