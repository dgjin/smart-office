import type { Booking, Resource, User } from '../types';

export interface ReportRange {
  start: Date | string;
  end: Date | string;
}

export interface DailyOpeningHours {
  start: string;
  end: string;
}

export type ReportDimension = 'OVERALL' | 'RESOURCE' | 'BUILDING_FLOOR' | 'RESOURCE_TYPE' | 'ROOM_CATEGORY' | 'TIME_SLOT' | 'DEPARTMENT' | 'SERVICE' | 'USAGE';

export interface ReportRow {
  dimension: ReportDimension;
  id: string;
  name: string;
  bookingCount: number;
  usageHours: number;
  utilization: number;
  cancellationRate: number;
  noShowRate: number;
  rejectionRate: number;
  averageApprovalHours: number;
}

export interface ReportResult {
  start: Date;
  end: Date;
  overall: ReportRow;
  rows: ReportRow[];
}

export const DEFAULT_DAILY_OPENING_HOURS: Readonly<DailyOpeningHours> = Object.freeze({
  start: '08:00',
  end: '20:00'
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const roundToOneDecimal = (value: number) => Number(value.toFixed(1));

const parseClock = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours === 24 && minutes === 0 && seconds === 0) return 24 * 60;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
};

export const openingMinutesWithin = (
  start: number,
  end: number,
  opening: DailyOpeningHours
): number => {
  const openMinutes = parseClock(opening.start);
  const closeMinutes = parseClock(opening.end);
  if (openMinutes === null || closeMinutes === null || closeMinutes < openMinutes || end <= start) return 0;

  let total = 0;
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  while (day.getTime() < end) {
    const open = new Date(day);
    open.setHours(0, openMinutes, 0, 0);
    const close = new Date(day);
    close.setHours(0, closeMinutes, 0, 0);
    total += Math.max(0, Math.min(end, close.getTime()) - Math.max(start, open.getTime())) / MINUTE_MS;
    day.setDate(day.getDate() + 1);
  }
  return total;
};

const finalApprovalHours = (booking: Booking): number | null => {
  if (booking.status === 'PENDING' || booking.status === 'REJECTED') return null;
  const createdAt = new Date(booking.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return null;
  for (let index = booking.approvalHistory.length - 1; index >= 0; index -= 1) {
    const record = booking.approvalHistory[index];
    if (record.status !== 'APPROVED') continue;
    const approvedAt = new Date(record.timestamp).getTime();
    if (!Number.isFinite(approvedAt)) return null;
    const duration = (approvedAt - createdAt) / HOUR_MS;
    return duration >= 0 ? duration : null;
  }
  return null;
};

export const buildReportRow = (
  dimension: ReportDimension,
  id: string,
  name: string,
  items: Booking[],
  resourceCount: number,
  rangeStart: number,
  rangeEnd: number,
  capacityMinutes: number,
  opening: DailyOpeningHours
): ReportRow => {
  const usageMinutes = items.reduce((total, booking) => {
    const hasActualUsage = Boolean(booking.actualStartTime && booking.actualEndTime);
    if (!['APPROVED', 'COMPLETED'].includes(booking.status) && !(booking.status === 'CANCELLED' && hasActualUsage)) return total;
    const start = Math.max(rangeStart, new Date(hasActualUsage ? booking.actualStartTime! : booking.startTime).getTime());
    const end = Math.min(rangeEnd, new Date(booking.actualEndTime || booking.endedEarlyAt || booking.endTime).getTime());
    return total + openingMinutesWithin(start, end, opening);
  }, 0);
  const approvalDurations = items
    .map(finalApprovalHours)
    .filter((value): value is number => value !== null);
  const percent = (count: number) => items.length ? roundToOneDecimal(count / items.length * 100) : 0;

  return {
    dimension,
    id,
    name,
    bookingCount: items.length,
    usageHours: roundToOneDecimal(usageMinutes / 60),
    utilization: capacityMinutes > 0 && resourceCount > 0
      ? roundToOneDecimal(Math.min(100, usageMinutes / (capacityMinutes * resourceCount) * 100))
      : 0,
    cancellationRate: percent(items.filter(booking => booking.status === 'CANCELLED' && !booking.noShow).length),
    noShowRate: percent(items.filter(booking => booking.noShow).length),
    rejectionRate: percent(items.filter(booking => booking.status === 'REJECTED').length),
    averageApprovalHours: approvalDurations.length
      ? roundToOneDecimal(approvalDurations.reduce((sum, value) => sum + value, 0) / approvalDurations.length)
      : 0
  };
};

export const generateReport = (
  bookings: Booking[],
  resources: Resource[],
  users: User[],
  range: ReportRange,
  dailyOpening: DailyOpeningHours = DEFAULT_DAILY_OPENING_HOURS
): ReportResult => {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const rangeStart = start.getTime();
  const rangeEnd = end.getTime();
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    throw new RangeError('Report range must contain valid dates with end after start');
  }

  const relevant = bookings.filter(booking => {
    const bookingStart = new Date(booking.startTime).getTime();
    const bookingEnd = new Date(booking.actualEndTime || booking.endedEarlyAt || booking.endTime).getTime();
    return Number.isFinite(bookingStart)
      && Number.isFinite(bookingEnd)
      && bookingStart < rangeEnd
      && bookingEnd > rangeStart;
  });
  const capacityMinutes = openingMinutesWithin(rangeStart, rangeEnd, dailyOpening);
  const row = (
    dimension: ReportDimension,
    id: string,
    name: string,
    items: Booking[],
    resourceCount: number
  ) => buildReportRow(dimension, id, name, items, resourceCount, rangeStart, rangeEnd, capacityMinutes, dailyOpening);

  const resourceRows = resources.map(resource => row(
    'RESOURCE',
    resource.id,
    resource.name,
    relevant.filter(booking => booking.resourceId === resource.id),
    1
  ));
  const departmentRows = [...new Set(users.map(user => user.department))].map(department => {
    const userIds = new Set(users.filter(user => user.department === department).map(user => user.id));
    return row(
      'DEPARTMENT',
      department,
      department,
      relevant.filter(booking => userIds.has(booking.userId)),
      resources.length
    );
  });

  return {
    start,
    end,
    overall: row('OVERALL', 'ALL', '全公司', relevant, resources.length),
    rows: [...resourceRows, ...departmentRows]
  };
};
