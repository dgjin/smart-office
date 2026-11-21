import test from 'node:test';
import assert from 'node:assert/strict';
import type { Resource } from '../types.ts';
import { filterResources } from '../utils/resourceSearch.ts';

const resources: Resource[] = [
  { id: 'r1', name: 'Alpha 战略会议室', type: 'ROOM', capacity: 12, location: '1号楼 10层 · 东侧', features: ['视频会议', '投屏'], status: 'AVAILABLE' },
  { id: 'r2', name: 'Beta 灵感会议室', type: 'ROOM', capacity: 6, location: '2号楼 2层', features: ['白板'], status: 'MAINTENANCE' },
  { id: 'r3', name: '工位 A-101', type: 'DESK', capacity: 1, location: 'A办公区', features: [], status: 'AVAILABLE' }
];
const filters = { type: 'ALL', status: 'ALL', minCapacity: 0 } as const;

test('资源搜索支持名称、位置、设备和多关键词 AND 匹配', () => {
  assert.deepEqual(filterResources(resources, 'alpha 视频 10层', filters).map(resource => resource.id), ['r1']);
  assert.deepEqual(filterResources(resources, '2号楼 白板', filters).map(resource => resource.id), ['r2']);
});

test('资源搜索支持中文类型、容量和状态', () => {
  assert.deepEqual(filterResources(resources, '会议室 12人 空闲', filters).map(resource => resource.id), ['r1']);
  assert.deepEqual(filterResources(resources, '工位 空闲', filters).map(resource => resource.id), ['r3']);
});

test('组合筛选支持类型、状态和最少容量', () => {
  assert.deepEqual(filterResources(resources, '', { type: 'ROOM', status: 'AVAILABLE', minCapacity: 8 }).map(resource => resource.id), ['r1']);
  assert.deepEqual(filterResources(resources, '', { ...filters, minCapacity: 20 }), []);
});

test('空白搜索不过滤资源', () => {
  assert.equal(filterResources(resources, '   ', filters).length, 3);
});
