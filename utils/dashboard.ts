import type { Booking, BookingRuleSettings, ExecutiveDashboardSnapshot, Resource } from '../types.ts';
import { getBookingDisplayStatus } from './bookingRules.ts';

export const startOfLocalDay = (value: Date | string | number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const addLocalDays = (value: Date | string | number, days: number) => {
  const date = startOfLocalDay(value);
  date.setDate(date.getDate() + days);
  return date;
};

export const localDateKey = (value: Date | string | number) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const timeMinutes = (value: string | undefined, fallback: number) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60 && (hours < 24 || minutes === 0)
    ? hours * 60 + minutes : fallback;
};

export const resourceOpenMinutes = (resource: Resource) => ({
  start: timeMinutes(resource.openStart, 8 * 60),
  end: timeMinutes(resource.openEnd, 20 * 60)
});

export const isEnabledRoom = (resource: Resource) => resource.type === 'ROOM'
  && (resource.status === 'AVAILABLE' || resource.status === 'OCCUPIED');

export const countsTowardOccupancy = (booking: Booking, now: Date) =>
  ['UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'ENDED_EARLY'].includes(getBookingDisplayStatus(booking, now));

export const bookingEffectiveEnd = (booking: Booking) => booking.actualEndTime || booking.endTime;

export const calculateResourceOccupancy = (resource: Resource, bookings: Booking[], day: Date, now = new Date()) => {
  const dayStart = startOfLocalDay(day);
  const dayEnd = addLocalDays(dayStart, 1);
  const { start: openStart, end: openEnd } = resourceOpenMinutes(resource);
  const availableMinutes = isEnabledRoom(resource) ? Math.max(0, openEnd - openStart) : 0;
  const windowStart = dayStart.getTime() + openStart * 60000;
  const windowEnd = Math.min(dayEnd.getTime(), dayStart.getTime() + openEnd * 60000);
  const dailyBookings = bookings.filter(booking => booking.resourceId === resource.id
    && countsTowardOccupancy(booking, now)
    && Date.parse(booking.startTime) < windowEnd && Date.parse(bookingEffectiveEnd(booking)) > windowStart);
  const bookedMinutes = dailyBookings.reduce((total, booking) => {
    const start = Math.max(windowStart, Date.parse(booking.startTime));
    const end = Math.min(windowEnd, Date.parse(bookingEffectiveEnd(booking)));
    return total + Math.max(0, end - start) / 60000;
  }, 0);
  const importantBookingCount = dailyBookings.filter(booking => booking.meetingType === 'IMPORTANT' || booking.hasLeader).length;
  return {
    bookedMinutes,
    availableMinutes,
    utilization: availableMinutes ? Math.min(100, Math.round(bookedMinutes / availableMinutes * 1000) / 10) : 0,
    importantBookingCount,
    dailyBookings
  };
};

export const buildExecutiveDashboard = (
  resources: Resource[],
  bookings: Booking[],
  now: Date,
  settings: BookingRuleSettings
): ExecutiveDashboardSnapshot => {
  const rooms = resources.filter(isEnabledRoom);
  const roomIds = new Set(rooms.map(room => room.id));
  const scopedBookings = bookings.filter(booking => roomIds.has(booking.resourceId));
  const dayStart = startOfLocalDay(now);
  const dayEnd = addLocalDays(dayStart, 1);
  const todayBookings = scopedBookings.filter(booking => countsTowardOccupancy(booking, now)
    && Date.parse(booking.startTime) < dayEnd.getTime() && Date.parse(bookingEffectiveEnd(booking)) > dayStart.getTime());
  const today = rooms.reduce((totals, room) => {
    const occupancy = calculateResourceOccupancy(room, scopedBookings, dayStart, now);
    return { booked: totals.booked + occupancy.bookedMinutes, available: totals.available + occupancy.availableMinutes };
  }, { booked: 0, available: 0 });
  const weekTotals = { booked: 0, available: 0 };
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(dayStart, index);
    const totals = rooms.reduce((sum, room) => {
      const occupancy = calculateResourceOccupancy(room, scopedBookings, date, now);
      return {
        booked: sum.booked + occupancy.bookedMinutes,
        available: sum.available + occupancy.availableMinutes,
        important: sum.important + occupancy.importantBookingCount
      };
    }, { booked: 0, available: 0, important: 0 });
    weekTotals.booked += totals.booked;
    weekTotals.available += totals.available;
    return {
      date: localDateKey(date),
      utilization: totals.available ? Math.min(100, Math.round(totals.booked / totals.available * 1000) / 10) : 0,
      importantBookingCount: totals.important
    };
  });
  const currentInUse = rooms.filter(room => scopedBookings.some(booking => booking.resourceId === room.id
    && getBookingDisplayStatus(booking, now) === 'IN_PROGRESS')).length;
  const currentReserved = rooms.filter(room => scopedBookings.some(booking => booking.resourceId === room.id
    && countsTowardOccupancy(booking, now)
    && Date.parse(booking.startTime) <= now.getTime() && Date.parse(bookingEffectiveEnd(booking)) > now.getTime())).length;
  const overdueReleaseCount = scopedBookings.filter(booking => {
    if (booking.status !== 'APPROVED' || booking.checkedInAt || getBookingDisplayStatus(booking, now) !== 'IN_PROGRESS') return false;
    const bookingSettings = booking.ruleSettingsSnapshot || settings;
    const releaseAt = Math.max(
      Date.parse(booking.startTime) + bookingSettings.noShowReleaseAfterStartMinutes * 60000,
      Date.parse(booking.noShowReleaseNotBefore || '') || 0
    );
    return now.getTime() >= releaseAt;
  }).length;
  return {
    roomCount: rooms.length,
    currentInUse,
    currentIdle: Math.max(0, rooms.length - currentReserved),
    todayBookingCount: todayBookings.length,
    todayUtilization: today.available ? Math.min(100, Math.round(today.booked / today.available * 1000) / 10) : 0,
    weekAverageUtilization: weekTotals.available ? Math.min(100, Math.round(weekTotals.booked / weekTotals.available * 1000) / 10) : 0,
    todayNoShowCount: scopedBookings.filter(booking => {
      if (getBookingDisplayStatus(booking, now) !== 'NO_SHOW') return false;
      const occurredAt = Date.parse(booking.releasedAt || booking.endTime);
      return occurredAt >= dayStart.getTime() && occurredAt < dayEnd.getTime();
    }).length,
    overdueReleaseCount,
    week
  };
};
