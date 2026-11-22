import type { Booking, Resource } from '../types';
import { getBookingRequiredFeatures, hasBookingConflict, isValidBookingPurpose, validateBookingResource, type BookingResourceRequirements } from './bookingRules.ts';

export type BookingDraftInput = BookingResourceRequirements & {
  resourceId: string;
  purpose: string;
};

export const validateBookingDraft = (
  draft: BookingDraftInput,
  resources: Resource[],
  bookings: Booking[],
  now = new Date()
): string | null => {
  if (!isValidBookingPurpose(draft.purpose)) return '请填写 200 字以内且有明确主题的申请用途，不能只填写“会议”或“开会”';
  const resource = resources.find(item => item.id === draft.resourceId);
  if (!resource) return '请选择有效资源';
  const start = new Date(draft.startTime);
  const end = new Date(draft.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return '结束时间必须晚于开始时间';
  if (resource.type === 'ROOM' && start.getTime() <= now.getTime()) return '开始时间已过，请选择未来时段';
  const resourceError = validateBookingResource(resource, {
    ...draft,
    requiredFeatures: getBookingRequiredFeatures(draft)
  });
  if (resourceError === 'INVALID_PARTICIPANTS') return '参与人数必须为大于 0 的整数';
  if (resourceError === 'CAPACITY_EXCEEDED') return `${resource.name} 最多容纳 ${resource.capacity} 人`;
  if (resourceError === 'RESOURCE_MAINTENANCE' || resourceError === 'RESOURCE_UNAVAILABLE') return `${resource.name} 当前暂停预约，请选择其他资源`;
  if (resourceError === 'REQUIRED_FEATURE_UNAVAILABLE') return `${resource.name} 不满足所选设备要求，请调整设备或更换资源`;
  if (resourceError) return '预约时间、人数或资源信息无效';
  if (hasBookingConflict(bookings, draft)) return `${resource.name} 在所选时段已有待审批或已核准预约，请调整时间或更换资源`;
  return null;
};
