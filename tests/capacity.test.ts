import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inventoryViolations,
  parseCapacityConfig,
  phaseViolations,
  summarizeSamples,
  type CapacitySample
} from '../scripts/perf/capacity-lib.ts';

const phase = { concurrency: 2, durationSeconds: 10, p95Ms: 500, p99Ms: 1000, maxErrorRate: 0.01 };
const sample = (durationMs: number, ok = true, operation: CapacitySample['operation'] = 'WORKSPACE'): CapacitySample => ({
  sequence: 0, worker: 0, operation, startedAt: '2026-11-21T00:00:00.000Z', durationMs, status: ok ? 200 : 500, ok
});

describe('容量配置与原始样本统计', () => {
  it('解析探索性配置并应用采样默认值', () => {
    const config = parseCapacityConfig({ mode: 'EXPLORATORY', query: phase, submission: phase });
    assert.equal(config.requestTimeoutMs, 30000);
    assert.equal(config.resourceSampleIntervalMs, 250);
    assert.equal(config.expected, undefined);
  });

  it('正式模式必须提供真实规模、设备数和模型确认依据', () => {
    assert.throws(() => parseCapacityConfig({ mode: 'FORMAL', query: phase, submission: phase }), /expected/);
    assert.throws(() => parseCapacityConfig({
      mode: 'FORMAL', query: phase, deviceQuery: phase, submission: phase,
      expected: { employees: 364, meetingRooms: 28, bookableMeetingRooms: 18, doorDevices: 5, accessControllers: 5 }
    }), /modelEvidence/);
    const config = parseCapacityConfig({
      mode: 'FORMAL', query: phase, deviceQuery: phase, submission: phase, modelEvidence: '责任方确认记录编号',
      expected: { employees: 364, meetingRooms: 28, bookableMeetingRooms: 18, doorDevices: 5, accessControllers: 5 }
    });
    assert.equal(config.expected?.meetingRooms, 28);
    assert.equal(config.expected?.bookableMeetingRooms, 18);
    assert.throws(() => parseCapacityConfig({
      mode: 'FORMAL', query: phase, submission: phase, modelEvidence: '责任方确认记录编号',
      expected: { employees: 364, meetingRooms: 28, bookableMeetingRooms: 18, doorDevices: 5, accessControllers: 5 }
    }), /deviceQuery/);
    assert.throws(() => parseCapacityConfig({
      mode: 'FORMAL', query: phase, deviceQuery: phase, submission: phase, modelEvidence: '责任方确认记录编号',
      expected: { employees: 364, meetingRooms: 28, bookableMeetingRooms: 29, doorDevices: 5, accessControllers: 5 }
    }), /bookableMeetingRooms/);
  });

  it('拒绝非隔离友好的并发、时长和错误率输入', () => {
    assert.throws(() => parseCapacityConfig({ mode: 'EXPLORATORY', query: { ...phase, concurrency: 0 }, submission: phase }), /concurrency/);
    assert.throws(() => parseCapacityConfig({ mode: 'EXPLORATORY', query: phase, submission: { ...phase, durationSeconds: 0 } }), /durationSeconds/);
    assert.throws(() => parseCapacityConfig({ mode: 'EXPLORATORY', query: { ...phase, maxErrorRate: 1.1 }, submission: phase }), /maxErrorRate/);
  });

  it('使用最近秩计算 P95/P99，并保留状态与操作分布', () => {
    const samples = Array.from({ length: 100 }, (_, index) => sample(index + 1, index !== 99, index % 10 ? 'WORKSPACE' : 'REPORT_7D'));
    const summary = summarizeSamples(samples, 2000);
    assert.equal(summary.latencyMs.p95, 95);
    assert.equal(summary.latencyMs.p99, 99);
    assert.equal(summary.latencyMs.max, 100);
    assert.equal(summary.errorRate, 0.01);
    assert.equal(summary.throughputPerSecond, 50);
    assert.equal(summary.statuses['500'], 1);
    assert.equal(summary.operations.REPORT_7D, 10);
  });

  it('空样本和阈值越界不能被判定为通过', () => {
    const empty = summarizeSamples([], 0);
    assert.equal(empty.errorRate, 1);
    assert.equal(phaseViolations('query', phase, empty).length, 4);
    const summary = summarizeSamples([sample(100, false)], 1000);
    assert.ok(phaseViolations('query', { ...phase, maxErrorRate: 0 }, summary).some(item => item.includes('错误率')));
  });

  it('正式台账分别比对人员、会议室总量、可预约量和门口屏数量', () => {
    const config = parseCapacityConfig({
      mode: 'FORMAL', query: phase, deviceQuery: phase, submission: phase, modelEvidence: '确认记录',
      expected: { employees: 364, meetingRooms: 28, bookableMeetingRooms: 18, doorDevices: 5, accessControllers: 8 }
    });
    assert.deepEqual(inventoryViolations(config, { employees: 364, meetingRooms: 28, bookableMeetingRooms: 18, doorDevices: 5 }), []);
    assert.deepEqual(inventoryViolations(config, { employees: 366, meetingRooms: 29, bookableMeetingRooms: 28, doorDevices: 4 }), [
      'employees 预期 364，实际 366',
      'meetingRooms 预期 28，实际 29',
      'bookableMeetingRooms 预期 18，实际 28',
      'doorDevices 预期 5，实际 4'
    ]);
  });
});
