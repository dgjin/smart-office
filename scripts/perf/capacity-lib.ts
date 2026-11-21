export type CapacityMode = 'EXPLORATORY' | 'FORMAL';

export interface CapacityPhaseConfig {
  concurrency: number;
  durationSeconds: number;
  p95Ms: number;
  p99Ms: number;
  maxErrorRate: number;
}

export interface CapacityConfig {
  mode: CapacityMode;
  modelEvidence?: string;
  query: CapacityPhaseConfig;
  submission: CapacityPhaseConfig;
  requestTimeoutMs: number;
  resourceSampleIntervalMs: number;
  deviceQuery?: CapacityPhaseConfig;
  expected?: {
    employees: number;
    meetingRooms: number;
    bookableMeetingRooms: number;
    doorDevices: number;
    accessControllers: number;
  };
}

export interface CapacitySample {
  sequence: number;
  worker: number;
  operation: 'WORKSPACE' | 'REPORT_7D' | 'DEVICE_SNAPSHOT' | 'SUBMIT' | 'CLEANUP';
  startedAt: string;
  durationMs: number;
  status: number | null;
  ok: boolean;
  bookingId?: string;
  error?: string;
}

export interface CapacityPhaseSummary {
  count: number;
  succeeded: number;
  failed: number;
  errorRate: number;
  wallMs: number;
  throughputPerSecond: number;
  latencyMs: {
    min: number | null;
    mean: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
  };
  statuses: Record<string, number>;
  operations: Record<string, number>;
}

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
};

const integer = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} 必须是 ${minimum}—${maximum} 的整数`);
  }
  return Number(value);
};

const positiveNumber = (value: unknown, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
  return value;
};

const phase = (value: unknown, name: string): CapacityPhaseConfig => {
  const input = record(value, name);
  const maxErrorRate = input.maxErrorRate;
  if (typeof maxErrorRate !== 'number' || !Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate > 1) {
    throw new Error(`${name}.maxErrorRate 必须位于 0—1`);
  }
  return {
    concurrency: integer(input.concurrency, `${name}.concurrency`, 1, 10000),
    durationSeconds: integer(input.durationSeconds, `${name}.durationSeconds`, 1, 86400),
    p95Ms: positiveNumber(input.p95Ms, `${name}.p95Ms`),
    p99Ms: positiveNumber(input.p99Ms, `${name}.p99Ms`),
    maxErrorRate
  };
};

export const parseCapacityConfig = (value: unknown): CapacityConfig => {
  const input = record(value, '配置');
  if (input.mode !== 'EXPLORATORY' && input.mode !== 'FORMAL') throw new Error('mode 必须是 EXPLORATORY 或 FORMAL');
  const config: CapacityConfig = {
    mode: input.mode,
    query: phase(input.query, 'query'),
    submission: phase(input.submission, 'submission'),
    requestTimeoutMs: input.requestTimeoutMs === undefined ? 30000 : integer(input.requestTimeoutMs, 'requestTimeoutMs', 100, 120000),
    resourceSampleIntervalMs: input.resourceSampleIntervalMs === undefined ? 250 : integer(input.resourceSampleIntervalMs, 'resourceSampleIntervalMs', 50, 60000)
  };
  if (input.modelEvidence !== undefined) {
    if (typeof input.modelEvidence !== 'string' || !input.modelEvidence.trim()) throw new Error('modelEvidence 必须是非空字符串');
    config.modelEvidence = input.modelEvidence.trim();
  }
  if (input.deviceQuery !== undefined) config.deviceQuery = phase(input.deviceQuery, 'deviceQuery');
  if (input.expected !== undefined) {
    const expected = record(input.expected, 'expected');
    config.expected = {
      employees: integer(expected.employees, 'expected.employees', 1, 1000000),
      meetingRooms: integer(expected.meetingRooms, 'expected.meetingRooms', 1, 100000),
      bookableMeetingRooms: integer(expected.bookableMeetingRooms, 'expected.bookableMeetingRooms', 1, 100000),
      doorDevices: integer(expected.doorDevices, 'expected.doorDevices', 0, 1000000),
      accessControllers: integer(expected.accessControllers, 'expected.accessControllers', 0, 1000000)
    };
    if (config.expected.bookableMeetingRooms > config.expected.meetingRooms) {
      throw new Error('expected.bookableMeetingRooms 不能超过 expected.meetingRooms');
    }
  }
  if (config.mode === 'FORMAL' && (!config.expected || !config.modelEvidence)) {
    throw new Error('FORMAL 模式必须提供 expected 人员/资源/设备数和 modelEvidence 确认依据');
  }
  if (config.mode === 'FORMAL' && config.expected!.doorDevices > 0 && !config.deviceQuery) {
    throw new Error('FORMAL 模式存在门口屏时必须提供 deviceQuery 设备刷新负载');
  }
  return config;
};

const percentile = (sorted: number[], quantile: number) => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
const rounded = (value: number) => Math.round(value * 1000) / 1000;

export const summarizeSamples = (samples: CapacitySample[], wallMs: number): CapacityPhaseSummary => {
  const durations = samples.map(sample => sample.durationMs).sort((left, right) => left - right);
  const succeeded = samples.filter(sample => sample.ok).length;
  const statuses: Record<string, number> = {};
  const operations: Record<string, number> = {};
  for (const sample of samples) {
    const status = sample.status === null ? 'NETWORK_ERROR' : String(sample.status);
    statuses[status] = (statuses[status] || 0) + 1;
    operations[sample.operation] = (operations[sample.operation] || 0) + 1;
  }
  const latency = durations.length ? {
    min: rounded(durations[0]),
    mean: rounded(durations.reduce((total, value) => total + value, 0) / durations.length),
    p50: rounded(percentile(durations, 0.5)),
    p95: rounded(percentile(durations, 0.95)),
    p99: rounded(percentile(durations, 0.99)),
    max: rounded(durations[durations.length - 1])
  } : { min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  return {
    count: samples.length,
    succeeded,
    failed: samples.length - succeeded,
    errorRate: samples.length ? rounded((samples.length - succeeded) / samples.length) : 1,
    wallMs: rounded(wallMs),
    throughputPerSecond: wallMs > 0 ? rounded(samples.length / (wallMs / 1000)) : 0,
    latencyMs: latency,
    statuses,
    operations
  };
};

export const phaseViolations = (name: string, config: CapacityPhaseConfig, summary: CapacityPhaseSummary) => {
  const violations: string[] = [];
  if (!summary.count) violations.push(`${name} 没有有效样本`);
  if (summary.latencyMs.p95 === null || summary.latencyMs.p95 > config.p95Ms) violations.push(`${name} P95 超过 ${config.p95Ms}ms`);
  if (summary.latencyMs.p99 === null || summary.latencyMs.p99 > config.p99Ms) violations.push(`${name} P99 超过 ${config.p99Ms}ms`);
  if (summary.errorRate > config.maxErrorRate) violations.push(`${name} 错误率超过 ${config.maxErrorRate}`);
  return violations;
};

export const inventoryViolations = (
  config: CapacityConfig,
  actual: { employees: number; meetingRooms: number; bookableMeetingRooms: number; doorDevices: number }
) => {
  if (!config.expected) return [];
  return (['employees', 'meetingRooms', 'bookableMeetingRooms', 'doorDevices'] as const).flatMap(key =>
    actual[key] === config.expected![key] ? [] : [`${key} 预期 ${config.expected![key]}，实际 ${actual[key]}`]
  );
};
