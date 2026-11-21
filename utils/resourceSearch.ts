import type { Resource, ResourceStatus, ResourceType } from '../types';

export interface ResourceSearchFilters {
  type: 'ALL' | ResourceType;
  status: 'ALL' | ResourceStatus;
  minCapacity: number;
}

const TYPE_LABELS = { ROOM: '会议室', DESK: '工位' } as const;
const STATUS_LABELS = { AVAILABLE: '空闲', OCCUPIED: '占用', MAINTENANCE: '维护中' } as const;
const normalize = (value: unknown) => String(value ?? '').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');

export const filterResources = (resources: Resource[], query: string, filters: ResourceSearchFilters) => {
  const keywords = query.trim().split(/\s+/).filter(Boolean).map(normalize);
  return resources.filter(resource => {
    if (filters.type !== 'ALL' && resource.type !== filters.type) return false;
    if (filters.status !== 'ALL' && resource.status !== filters.status) return false;
    if ((resource.capacity || 0) < filters.minCapacity) return false;
    const searchable = normalize([
      resource.name,
      resource.location,
      resource.features.join(' '),
      TYPE_LABELS[resource.type],
      STATUS_LABELS[resource.status],
      resource.capacity,
      `${resource.capacity}人`
    ].join(' '));
    return keywords.every(keyword => searchable.includes(keyword));
  });
};
