import { Booking, Resource, ResourceType } from '../types';
import { findBookingConflicts } from '../utils/bookingRules';

export interface RecommendationRequirements {
  video?: boolean;
  display?: boolean;
  whiteboard?: boolean;
}

export interface SmartRecommendationRequest {
  purpose: string;
  participants: number;
  resources: Resource[];
  bookings: Booking[];
  startTime: string;
  endTime: string;
  requirements: RecommendationRequirements;
  resourceType?: ResourceType;
  excludeBookingId?: string;
}

export interface SmartRecommendation {
  resourceId: string | null;
  reason: string;
  source: 'AI' | 'LOCAL';
}

const hasFeature = (resource: Resource, pattern: RegExp) => resource.features.some(feature => pattern.test(feature));

const eligibleResources = (input: SmartRecommendationRequest) => {
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];

  return input.resources.filter(resource => {
    if (resource.status !== 'AVAILABLE' || (input.resourceType && resource.type !== input.resourceType)) return false;
    if ((resource.capacity || 1) < input.participants) return false;
    if (input.requirements.video && !hasFeature(resource, /视频|远程|会议系统/)) return false;
    if (input.requirements.display && !hasFeature(resource, /投屏|显示器|屏幕|投影/)) return false;
    if (input.requirements.whiteboard && !hasFeature(resource, /白板/)) return false;
    return findBookingConflicts(input.bookings, {
      resourceId: resource.id,
      startTime: start.toISOString(),
      endTime: end.toISOString()
    }, input.excludeBookingId).length === 0;
  }).sort((a, b) => ((a.capacity || 1) - (b.capacity || 1)) || a.name.localeCompare(b.name, 'zh-CN'));
};

export const recommendLocally = (input: SmartRecommendationRequest): SmartRecommendation => {
  const picked = eligibleResources(input)[0];
  if (!picked) {
    return { resourceId: null, reason: '当前时段没有同时满足人数、类型和设备要求的资源，请调整条件后重试。', source: 'LOCAL' };
  }
  return {
    resourceId: picked.id,
    reason: `可容纳 ${picked.capacity || 1} 人，位于${picked.location}，满足当前时段与设备要求。`,
    source: 'LOCAL'
  };
};

export const getSmartRecommendation = async (input: SmartRecommendationRequest): Promise<SmartRecommendation> => {
  const candidates = eligibleResources(input);
  if (candidates.length === 0) return recommendLocally(input);

  try {
    const res = await fetch('/api/ai/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        resources: candidates,
        bookings: input.bookings.map(({ id, resourceId, startTime, endTime, status }) => ({ id, resourceId, startTime, endTime, status }))
      }),
    });
    if (!res.ok) return recommendLocally(input);
    const data = await res.json();
    if (!candidates.some(resource => resource.id === data.resourceId)) return recommendLocally(input);
    return {
      resourceId: data.resourceId,
      reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason : '符合当前人数、时段与设备要求。',
      source: 'AI'
    };
  } catch {
    return recommendLocally(input);
  }
};
