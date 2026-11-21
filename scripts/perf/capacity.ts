import { spawn, execFile, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  inventoryViolations,
  parseCapacityConfig,
  phaseViolations,
  summarizeSamples,
  type CapacityConfig,
  type CapacitySample
} from './capacity-lib.ts';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const argumentsFor = (argv: string[]) => {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--config', '--output'].includes(key) || !argv[index + 1] || values[key]) throw new Error('用法：node scripts/perf/capacity.ts --config <json> --output <新文件.json>');
    values[key] = argv[index + 1];
  }
  if (!values['--config'] || !values['--output'] || argv.length !== 4) throw new Error('必须同时提供 --config 和 --output');
  return { configPath: path.resolve(values['--config']), outputPath: path.resolve(values['--output']) };
};

const freePort = async () => {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('无法分配临时容量测试端口');
  const port = address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return port;
};

const parseCpuSeconds = (value: string) => {
  const parts = value.split('-');
  const days = parts.length === 2 ? Number(parts.shift()) : 0;
  const clock = parts[0]?.split(':').map(Number);
  if (!clock || clock.some(part => !Number.isFinite(part)) || !Number.isFinite(days)) throw new Error(`无法解析进程 CPU 时间 ${value}`);
  const [hours, minutes, seconds] = clock.length === 3 ? clock : [0, clock[0], clock[1]];
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
};

type ProcessSample = {
  timestamp: string;
  elapsedMs: number;
  cpuSeconds: number;
  intervalCpuPercent: number | null;
  rssBytes: number;
};

const startProcessSampler = (pid: number, intervalMs: number) => {
  const samples: ProcessSample[] = [];
  const errors: string[] = [];
  const started = performance.now();
  let stopped = false;
  let active: Promise<void> | null = null;
  const run = async () => {
    let previous: { at: number; cpuSeconds: number } | null = null;
    while (!stopped) {
      const at = performance.now();
      try {
        const { stdout } = await exec('ps', ['-o', 'time=,rss=', '-p', String(pid)], { timeout: 5000 });
        const [time, rss] = stdout.trim().split(/\s+/);
        const cpuSeconds = parseCpuSeconds(time);
        const rssKb = Number(rss);
        if (!Number.isFinite(rssKb) || rssKb < 0) throw new Error(`无法解析进程 RSS ${rss}`);
        samples.push({
          timestamp: new Date().toISOString(),
          elapsedMs: Math.round((at - started) * 1000) / 1000,
          cpuSeconds,
          intervalCpuPercent: previous ? Math.round(((cpuSeconds - previous.cpuSeconds) / ((at - previous.at) / 1000)) * 10000) / 100 : null,
          rssBytes: Math.round(rssKb * 1024)
        });
        previous = { at, cpuSeconds };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      if (!stopped) await delay(intervalMs);
    }
  };
  active = run();
  return {
    samples,
    errors,
    stop: async () => {
      stopped = true;
      await active;
    }
  };
};

type Session = { userId: string; cookie: string; roles: string[] };
type RequestAuth = { cookie?: string; bearerToken?: string };

type TimedResult = { sample: CapacitySample; body: any };

const timedRequest = async (
  baseUrl: string,
  auth: RequestAuth,
  input: { sequence: number; worker: number; operation: CapacitySample['operation']; pathname: string; method?: string; body?: unknown; timeoutMs: number; expectedStatus: number }
): Promise<TimedResult> => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let status: number | null = null;
  let body: any;
  let error: string | undefined;
  try {
    const response = await fetch(`${baseUrl}${input.pathname}`, {
      method: input.method || 'GET',
      headers: {
        ...(auth.cookie ? { Cookie: auth.cookie } : {}),
        ...(auth.bearerToken ? { Authorization: `Bearer ${auth.bearerToken}` } : {}),
        ...(input.body === undefined ? {} : { Origin: baseUrl, 'Content-Type': 'application/json' })
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs)
    });
    status = response.status;
    const text = await response.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = undefined; }
    }
    if (status !== input.expectedStatus) error = body?.error || `HTTP_${status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.name : String(cause);
  }
  return {
    sample: {
      sequence: input.sequence,
      worker: input.worker,
      operation: input.operation,
      startedAt,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
      status,
      ok: status === input.expectedStatus,
      ...(error ? { error } : {})
    },
    body
  };
};

const runLoad = async (
  phase: CapacityConfig['query'],
  handler: (worker: number, iteration: number) => Promise<CapacitySample[]>
) => {
  const samples: CapacitySample[] = [];
  const started = performance.now();
  const deadline = started + phase.durationSeconds * 1000;
  await Promise.all(Array.from({ length: phase.concurrency }, async (_, worker) => {
    let iteration = 0;
    while (performance.now() < deadline) {
      samples.push(...await handler(worker, iteration));
      iteration += 1;
    }
  }));
  return { samples, wallMs: performance.now() - started };
};

const deviceTokensFromEnv = (value: string | undefined) => {
  if (!value) return [] as string[];
  let tokens: unknown;
  try { tokens = JSON.parse(value); } catch { throw new Error('SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON 必须是设备令牌 JSON 数组'); }
  if (!Array.isArray(tokens) || tokens.some(token => typeof token !== 'string' || !/^door_[A-Za-z0-9_-]{20,200}$/.test(token))) {
    throw new Error('SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON 包含无效设备令牌');
  }
  if (new Set(tokens).size !== tokens.length) throw new Error('SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON 不能包含重复设备令牌');
  return tokens as string[];
};

const args = argumentsFor(process.argv.slice(2));
const config = parseCapacityConfig(JSON.parse(await fs.readFile(args.configPath, 'utf8')));
const deviceTokens = deviceTokensFromEnv(process.env.SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON);
if (process.env.SMART_OFFICE_TEST_MYSQL !== 'true' || !/^smart_office_test_[A-Za-z0-9_]+$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('容量测试仅允许 SMART_OFFICE_TEST_MYSQL=true 且 MYSQL_DATABASE 匹配 ^smart_office_test_[A-Za-z0-9_]+$ 的隔离库');
}
await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
const output = await fs.open(args.outputPath, 'wx');

let child: ChildProcess | null = null;
let serverOutput = '';
let baseUrl = '';
let sequence = 0;
let submissionSlot = 0;
let querySamples: CapacitySample[] = [];
let deviceSamples: CapacitySample[] = [];
let submissionSamples: CapacitySample[] = [];
let cleanupSamples: CapacitySample[] = [];
let queryWallMs = 0;
let deviceWallMs = 0;
let submissionWallMs = 0;
let inventory: any = null;
let precheckViolations: string[] = [];
const metricSnapshots: Array<{ label: string; timestamp: string; text: string }> = [];
const runErrors: string[] = [];
let sampler: ReturnType<typeof startProcessSampler> | null = null;
let revision = { commit: 'UNKNOWN', workingTreeDirty: null as boolean | null };

const snapshotMetrics = async (label: string) => {
  const response = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
  if (!response.ok) throw new Error(`指标读取失败：${response.status}`);
  metricSnapshots.push({ label, timestamp: new Date().toISOString(), text: await response.text() });
};

const stopServer = async () => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const graceful = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!graceful) {
    child.kill('SIGKILL');
    await exited;
  }
};

try {
  try {
    revision.commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    revision.workingTreeDirty = Boolean((await exec('git', ['status', '--porcelain', '--', '.'], { cwd: root })).stdout.trim());
  } catch {}

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SMART_OFFICE_DEV_AUTH: 'true',
      SMART_OFFICE_HOST: '127.0.0.1',
      SMART_OFFICE_PORT: String(port),
      SMART_OFFICE_AUTH_RATE_LIMIT: '1000000',
      SMART_OFFICE_AUTH_RATE_LIMIT_WINDOW_MS: '60000',
      SMART_OFFICE_JOB_INTERVAL_MS: '3600000',
      SMART_OFFICE_OA_CALLBACK_ENABLED: 'false',
      SMART_OFFICE_CALENDAR_ENABLED: 'false',
      SMART_OFFICE_ACCESS_ENABLED: 'false',
      SMART_OFFICE_WECOM_ENABLED: 'false',
      SMART_OFFICE_SMS_ENABLED: 'false',
      SMART_OFFICE_EMAIL_ENABLED: 'false',
      SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON: '',
      DEEPSEEK_API_KEY: '',
      OIDC_ISSUER: '',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
      OIDC_REDIRECT_URI: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.on('data', chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-32768); });
  child.stderr?.on('data', chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-32768); });

  let healthy = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`容量测试 Node 提前退出：${serverOutput}`);
    try {
      if ((await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await delay(50);
  }
  if (!healthy) throw new Error(`容量测试 Node 启动超时：${serverOutput}`);
  sampler = startProcessSampler(child.pid!, config.resourceSampleIntervalMs);

  const optionsResponse = await fetch(`${baseUrl}/api/auth/options`);
  const options = await optionsResponse.json() as any;
  if (!optionsResponse.ok || !options.development || !Array.isArray(options.users) || !options.users.length) throw new Error('隔离开发身份清单不可用');
  const sessions: Session[] = [];
  for (const user of options.users) {
    const response = await fetch(`${baseUrl}/api/auth/dev?userId=${encodeURIComponent(user.id)}`, { redirect: 'manual' });
    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
    if (response.status !== 200 || !cookie.includes('=')) throw new Error(`隔离身份登录失败：${user.id}`);
    sessions.push({ userId: user.id, cookie, roles: user.role });
  }
  const admin = sessions.find(session => session.roles.includes('SYSTEM_ADMIN'));
  if (!admin) throw new Error('隔离库缺少系统管理员');
  const precheck = await timedRequest(baseUrl, admin, {
    sequence: sequence++, worker: -1, operation: 'WORKSPACE', pathname: '/api/workspace', timeoutMs: config.requestTimeoutMs, expectedStatus: 200
  });
  if (!precheck.sample.ok) throw new Error(`工作区预检失败：${precheck.sample.error}`);
  const workspace = precheck.body;
  const activeUsers = workspace.users.filter((user: any) => user.status !== 'DISABLED');
  const meetingRooms = workspace.resources.filter((resource: any) => resource.type === 'ROOM');
  const bookableRooms = meetingRooms.filter((resource: any) => resource.status === 'AVAILABLE');
  const activeDoorDevices = (workspace.devices || []).filter((device: any) => device.status === 'ACTIVE');
  inventory = {
    employees: activeUsers.length,
    meetingRooms: meetingRooms.length,
    bookableMeetingRooms: bookableRooms.length,
    doorDevices: activeDoorDevices.length,
    accessControllers: {
      declared: config.expected?.accessControllers ?? null,
      observed: null,
      note: '门禁控制器属于外部设备清单，当前工作区不提供可核验计数'
    }
  };
  precheckViolations = inventoryViolations(config, inventory);
  if (config.deviceQuery && deviceTokens.length !== activeDoorDevices.length) {
    precheckViolations.push(`设备令牌数量 ${deviceTokens.length} 与 ACTIVE 门口屏数量 ${activeDoorDevices.length} 不一致`);
  }
  if (config.deviceQuery && config.deviceQuery.concurrency < deviceTokens.length) {
    precheckViolations.push(`deviceQuery.concurrency ${config.deviceQuery.concurrency} 无法覆盖 ${deviceTokens.length} 台门口屏`);
  }
  if (!bookableRooms.length) throw new Error('隔离库没有可预约会议室');
  await snapshotMetrics('START');

  const reportStart = new Date(Date.now() - 86400000);
  const reportEnd = new Date(reportStart.getTime() + 7 * 86400000);
  const reportPath = `/api/reports?start=${encodeURIComponent(reportStart.toISOString())}&end=${encodeURIComponent(reportEnd.toISOString())}`;
  const queryResult = await runLoad(config.query, async (worker, iteration) => {
    const session = sessions[worker % sessions.length];
    const report = session.roles.includes('SYSTEM_ADMIN') && iteration % 10 === 0;
    const result = await timedRequest(baseUrl, report ? admin : session, {
      sequence: sequence++, worker, operation: report ? 'REPORT_7D' : 'WORKSPACE', pathname: report ? reportPath : '/api/workspace', timeoutMs: config.requestTimeoutMs, expectedStatus: 200
    });
    return [result.sample];
  });
  querySamples = queryResult.samples;
  queryWallMs = queryResult.wallMs;
  await snapshotMetrics('AFTER_QUERY');

  if (config.deviceQuery && deviceTokens.length) {
    const deviceResult = await runLoad(config.deviceQuery, async (worker) => {
      const result = await timedRequest(baseUrl, { bearerToken: deviceTokens[worker % deviceTokens.length] }, {
        sequence: sequence++, worker, operation: 'DEVICE_SNAPSHOT', pathname: '/api/device/snapshot', timeoutMs: config.requestTimeoutMs, expectedStatus: 200
      });
      return [result.sample];
    });
    deviceSamples = deviceResult.samples;
    deviceWallMs = deviceResult.wallMs;
  }
  await snapshotMetrics('AFTER_DEVICE_QUERY');

  const bookingBase = new Date(Date.now() + 400 * 86400000);
  bookingBase.setUTCHours(8, 0, 0, 0);
  const submissionResult = await runLoad(config.submission, async (worker) => {
    const session = sessions[worker % sessions.length];
    const slot = submissionSlot++;
    const start = new Date(bookingBase);
    start.setUTCDate(start.getUTCDate() + Math.floor(slot / 720));
    start.setUTCMinutes(start.getUTCMinutes() + slot % 720);
    const end = new Date(start.getTime() + 60000);
    const resource = bookableRooms[slot % bookableRooms.length];
    const bookingId = crypto.randomUUID();
    const created = await timedRequest(baseUrl, session, {
      sequence: sequence++, worker, operation: 'SUBMIT', pathname: '/api/bookings', method: 'POST', timeoutMs: config.requestTimeoutMs, expectedStatus: 201,
      body: {
        booking: {
          id: bookingId,
          resourceId: resource.id,
          type: 'ROOM',
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: 'PENDING',
          purpose: `隔离容量提交 ${bookingId}`,
          participants: 1,
          createdAt: new Date().toISOString(),
          currentNodeIndex: 0,
          approvalHistory: [],
          meetingType: 'NORMAL',
          confidentialityChoice: 'NON_CONFIDENTIAL'
        }
      }
    });
    created.sample.bookingId = bookingId;
    const samples = [created.sample];
    if (created.sample.ok) {
      const cleanup = await timedRequest(baseUrl, session, {
        sequence: sequence++, worker, operation: 'CLEANUP', pathname: '/api/agent/action', method: 'POST', timeoutMs: config.requestTimeoutMs, expectedStatus: 200,
        body: { action: { type: 'PROPOSE_CANCEL', bookingId, reason: '隔离容量样本清理', summary: '取消隔离容量样本' } }
      });
      cleanup.sample.bookingId = bookingId;
      samples.push(cleanup.sample);
    }
    return samples;
  });
  submissionSamples = submissionResult.samples.filter(sample => sample.operation === 'SUBMIT');
  cleanupSamples = submissionResult.samples.filter(sample => sample.operation === 'CLEANUP');
  submissionWallMs = submissionResult.wallMs;
  await snapshotMetrics('AFTER_SUBMISSION');
} catch (error) {
  runErrors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (sampler) await sampler.stop();
  try { await stopServer(); } catch (error) { runErrors.push(`服务清理失败：${error instanceof Error ? error.message : String(error)}`); }
}

const querySummary = summarizeSamples(querySamples, queryWallMs);
const deviceSummary = summarizeSamples(deviceSamples, deviceWallMs);
const submissionSummary = summarizeSamples(submissionSamples, submissionWallMs);
const cleanupSummary = summarizeSamples(cleanupSamples, submissionWallMs);
const acceptanceViolations = config.mode === 'FORMAL' ? [
  ...precheckViolations,
  ...phaseViolations('query', config.query, querySummary),
  ...(config.deviceQuery ? phaseViolations('deviceQuery', config.deviceQuery, deviceSummary) : []),
  ...phaseViolations('submission', config.submission, submissionSummary),
  ...(cleanupSummary.failed ? [`${cleanupSummary.failed} 条预约清理失败`] : []),
  ...(sampler?.errors.length ? ['进程资源采样失败'] : []),
  ...runErrors
] : [];
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: config.mode,
  acceptance: {
    eligible: config.mode === 'FORMAL',
    verdict: config.mode === 'FORMAL' ? (acceptanceViolations.length ? 'FAIL' : 'PASS') : 'NOT_EVALUATED',
    violations: acceptanceViolations,
    statement: config.mode === 'FORMAL' ? '仅在配置输入已获责任方确认且环境具备代表性时作为验收证据' : '探索性工具验证，不构成 P9-03 性能容量验收'
  },
  config,
  revision,
  runtime: { node: process.version, platform: process.platform, arch: process.arch, database: process.env.MYSQL_DATABASE, baseUrl },
  inventory,
  precheckViolations,
  query: { summary: querySummary, samples: querySamples },
  deviceQuery: config.deviceQuery ? { summary: deviceSummary, samples: deviceSamples, authenticatedDeviceCount: deviceTokens.length } : null,
  submission: { summary: submissionSummary, samples: submissionSamples },
  cleanup: { summary: cleanupSummary, samples: cleanupSamples },
  process: { samples: sampler?.samples || [], errors: sampler?.errors || [] },
  metrics: metricSnapshots,
  runErrors,
  serverLogTail: serverOutput
};
await output.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
await output.close();
console.log(JSON.stringify({
  output: args.outputPath,
  mode: report.mode,
  verdict: report.acceptance.verdict,
  query: querySummary,
  deviceQuery: config.deviceQuery ? deviceSummary : null,
  submission: submissionSummary,
  cleanupFailures: cleanupSummary.failed,
  runErrors
}, null, 2));
if (runErrors.length || acceptanceViolations.length) process.exitCode = 1;
