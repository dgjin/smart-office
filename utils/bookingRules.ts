import type { Booking, BookingDisplayStatus, Resource, RoomFeature } from '../types';

export const BOOKING_DISPLAY_STATUS_LABELS: Record<BookingDisplayStatus, string> = {
  PENDING: '待审批',
  UPCOMING: '待开始',
  IN_PROGRESS: '进行中',
  NO_SHOW: '已爽约',
  RELEASED: '已释放',
  ENDED_EARLY: '提前结束',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REJECTED: '已驳回'
};

export const getBookingDisplayStatus = (booking: Booking, now: Date | string | number = new Date()): BookingDisplayStatus => {
  if (booking.noShow || booking.releaseType === 'NO_SHOW') return 'NO_SHOW';
  if (booking.endedEarlyAt) return 'ENDED_EARLY';
  if (booking.releaseType === 'UNUSED_CONFIRMED' || booking.releaseType === 'MANUAL_EXCEPTION') return 'RELEASED';
  if (booking.status === 'CANCELLED') return 'CANCELLED';
  if (booking.status === 'REJECTED') return 'REJECTED';
  if (booking.status === 'PENDING') return 'PENDING';
  if (booking.status === 'COMPLETED') return 'COMPLETED';
  const nowMs = new Date(now).getTime();
  const startMs = Date.parse(booking.startTime);
  const endMs = Date.parse(booking.actualEndTime || booking.endTime);
  if (nowMs < startMs) return 'UPCOMING';
  if (nowMs < endMs) return 'IN_PROGRESS';
  return 'COMPLETED';
};

const CHINA_DAY_OFFSET_MS = 8 * 3600000;
export const bookingDateKey = (value: Date | string | number) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + CHINA_DAY_OFFSET_MS).toISOString().slice(0, 10);
};
export const bookingLocalTime = (value: Date | string | number) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + CHINA_DAY_OFFSET_MS).toISOString().slice(11, 16);
};
export const splitBookingByNaturalDay = (startTime: string, endTime: string) => {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const segments: Array<{ date: string; minutes: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const date = bookingDateKey(cursor);
    const nextDay = Date.parse(`${date}T00:00:00+08:00`) + 86400000;
    const segmentEnd = Math.min(end, nextDay);
    segments.push({ date, minutes: Math.round((segmentEnd - cursor) / 60000) });
    cursor = segmentEnd;
  }
  return segments;
};

export interface BookingTimeRange {
  resourceId: string;
  startTime: string;
  endTime: string;
}

export const timeRangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

export const isActiveBooking = (booking: Booking) => booking.status === 'PENDING' || booking.status === 'APPROVED';

export const isResourceAcceptingBookings = (resource: Resource) => resource.status !== 'MAINTENANCE' && resource.status !== 'PENDING';

const FEATURE_PATTERNS: Record<RoomFeature, RegExp> = {
  VIDEO: /视频|远程|会议系统/,
  DISPLAY: /投屏|显示器|屏幕/,
  WHITEBOARD: /白板/
};

export const resourceSupportsFeature = (resource: Pick<Resource, 'features'>, feature: RoomFeature) =>
  resource.features.some(label => FEATURE_PATTERNS[feature].test(label));

export const getBookingRequiredFeatures = (booking: Pick<Booking, 'requiredFeatures' | 'isVideoConference'>): RoomFeature[] =>
  [...new Set([...(booking.requiredFeatures || []), ...(booking.isVideoConference ? ['VIDEO' as const] : [])])];

export const isValidBookingPurpose = (purpose: unknown) => {
  if (typeof purpose !== 'string') return false;
  const trimmed = purpose.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && !['会议', '开会'].includes(trimmed.replace(/\s+/g, ''));
};

export interface BookingResourceRequirements {
  startTime: string;
  endTime: string;
  participants?: number;
  requiredFeatures?: RoomFeature[];
  isVideoConference?: boolean;
}

export type BookingResourceError = 'RESOURCE_NOT_FOUND' | 'RESOURCE_MAINTENANCE' | 'RESOURCE_UNAVAILABLE' | 'INVALID_TIME_RANGE' | 'INVALID_PARTICIPANTS' | 'CAPACITY_EXCEEDED' | 'REQUIRED_FEATURE_UNAVAILABLE';

export const validateBookingResource = (resource: Resource | undefined, booking: BookingResourceRequirements): BookingResourceError | null => {
  if (!resource) return 'RESOURCE_NOT_FOUND';
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 'INVALID_TIME_RANGE';
  if (resource.status === 'MAINTENANCE') return 'RESOURCE_MAINTENANCE';
  if (!isResourceAcceptingBookings(resource)) return 'RESOURCE_UNAVAILABLE';
  const participants = booking.participants;
  if (participants === undefined || !Number.isInteger(participants) || participants < 1) return 'INVALID_PARTICIPANTS';
  if (resource.type === 'ROOM' && participants > (resource.capacity || 0)) return 'CAPACITY_EXCEEDED';
  if (getBookingRequiredFeatures(booking).some(feature => !resourceSupportsFeature(resource, feature))) return 'REQUIRED_FEATURE_UNAVAILABLE';
  return null;
};

export type ResourceUpdateError = 'ACTIVE_BOOKINGS_REQUIRE_REVIEW' | 'CAPACITY_EXCEEDED' | 'REQUIRED_FEATURE_UNAVAILABLE';

export const getResourceUpdateError = (current: Resource, next: Resource, bookings: Booking[], now = new Date()): { code: ResourceUpdateError; bookings: Booking[] } | null => {
  const active = bookings.filter(booking => booking.resourceId === next.id && isActiveBooking(booking) && new Date(booking.endTime) > now);
  if (!active.length) return null;
  if (isResourceAcceptingBookings(current) && !isResourceAcceptingBookings(next)) return { code: 'ACTIVE_BOOKINGS_REQUIRE_REVIEW', bookings: active };
  if (current.capacity !== next.capacity) {
    const impacted = active.filter(booking => (booking.participants || 1) > (next.capacity || 0));
    if (impacted.length) return { code: 'CAPACITY_EXCEEDED', bookings: impacted };
  }
  if (JSON.stringify(current.features) !== JSON.stringify(next.features)) {
    const impacted = active.filter(booking => getBookingRequiredFeatures(booking).some(feature => !resourceSupportsFeature(next, feature)));
    if (impacted.length) return { code: 'REQUIRED_FEATURE_UNAVAILABLE', bookings: impacted };
  }
  return null;
};

export const findBookingConflicts = (bookings: Booking[], candidate: BookingTimeRange, excludeBookingId?: string) => {
  const start = new Date(candidate.startTime);
  const end = new Date(candidate.endTime);
  return bookings.filter(booking =>
    booking.id !== excludeBookingId
    && booking.resourceId === candidate.resourceId
    && isActiveBooking(booking)
    && timeRangesOverlap(start, end, new Date(booking.startTime), new Date(booking.endTime))
  );
};

export const hasBookingConflict = (bookings: Booking[], candidate: BookingTimeRange, excludeBookingId?: string) =>
  findBookingConflicts(bookings, candidate, excludeBookingId).length > 0;

export const findRequesterConflicts = (bookings: Booking[], candidate: Booking, excludeBookingId?: string) => {
  const start = new Date(candidate.startTime);
  const end = new Date(candidate.endTime);
  return bookings.filter(booking => booking.id !== excludeBookingId
    && booking.userId === candidate.userId
    && isActiveBooking(booking)
    && timeRangesOverlap(start, end, new Date(booking.startTime), new Date(booking.endTime)));
};

export const findAttendeeOverlaps = (bookings: Booking[], candidate: Booking, excludeBookingId?: string) => {
  const attendeeIds = new Set(candidate.attendeeIds || []);
  if (!attendeeIds.size) return [];
  const start = new Date(candidate.startTime);
  const end = new Date(candidate.endTime);
  return bookings.filter(booking => booking.id !== excludeBookingId
    && isActiveBooking(booking)
    && (attendeeIds.has(booking.userId) || (booking.attendeeIds || []).some(id => attendeeIds.has(id))
      || (booking.overlapParticipantIds || []).some(id => attendeeIds.has(id)))
    && timeRangesOverlap(start, end, new Date(booking.startTime), new Date(booking.endTime)));
};

export const findAvailableRooms = (resources: Resource[], bookings: Booking[], criteria: BookingResourceRequirements) =>
  resources.filter(resource => resource.type === 'ROOM'
    && !validateBookingResource(resource, criteria)
    && !hasBookingConflict(bookings, {
      resourceId: resource.id,
      startTime: criteria.startTime,
      endTime: criteria.endTime
    }));

export const addCalendarMonthClamped = (value: Date, months = 1) => {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
};

export const getLongTermMaxEndDate = (start: Date, maxCalendarMonths = 1) => {
  const result = addCalendarMonthClamped(start, maxCalendarMonths);
  result.setDate(result.getDate() - 1);
  return result;
};

export const getDailyOccurrenceCount = (start: Date, endDate: Date) => {
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.max(0, Math.floor((endDay - startDay) / 86400000) + 1);
};

export const isLongTermSeriesWithinLimit = (bookings: Array<Pick<Booking, 'startTime' | 'endTime'>>, maxCalendarMonths = 1) => {
  if (!bookings.length) return false;
  const sorted = [...bookings].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const firstStart = new Date(sorted[0].startTime);
  if (Number.isNaN(firstStart.getTime())) return false;
  if (!Number.isInteger(maxCalendarMonths) || maxCalendarMonths < 1) return false;
  const limit = new Date(firstStart);
  limit.setDate(1);
  limit.setMonth(limit.getMonth() + maxCalendarMonths);
  const lastDay = new Date(limit.getFullYear(), limit.getMonth() + 1, 0).getDate();
  limit.setDate(Math.min(firstStart.getDate(), lastDay));
  return sorted.every(booking => {
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start >= firstStart && end > start && end <= limit;
  });
};

export const findNextAvailableSlot = (resourceId: string, bookings: Booking[], durationMinutes: number, now = new Date()) => {
  const step = 30 * 60000;
  let pointer = new Date(now);
  pointer.setMinutes(Math.ceil(pointer.getMinutes() / 30) * 30, 0, 0);
  const horizon = pointer.getTime() + 14 * 86400000;
  const sameDayRequired = durationMinutes <= 12 * 60;

  while (pointer.getTime() < horizon) {
    const candidateEnd = new Date(pointer.getTime() + durationMinutes * 60000);
    if (sameDayRequired) {
      const hour = pointer.getHours();
      if (hour < 8 || hour >= 20) {
        const next = new Date(pointer);
        if (hour >= 20) next.setDate(next.getDate() + 1);
        next.setHours(8, 0, 0, 0);
        pointer = next;
        continue;
      }
      const endHour = candidateEnd.getHours();
      const beyondDay = candidateEnd.getDate() !== pointer.getDate()
        || endHour > 20 || (endHour === 20 && candidateEnd.getMinutes() > 0);
      if (beyondDay) {
        const next = new Date(pointer);
        next.setDate(next.getDate() + 1);
        next.setHours(8, 0, 0, 0);
        pointer = next;
        continue;
      }
    }

    const conflicts = findBookingConflicts(bookings, {
      resourceId,
      startTime: pointer.toISOString(),
      endTime: candidateEnd.toISOString()
    });
    if (conflicts.length === 0) return { start: new Date(pointer), end: candidateEnd };
    pointer = new Date(pointer.getTime() + step);
  }

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);
  return { start: fallback, end: new Date(fallback.getTime() + durationMinutes * 60000) };
};
