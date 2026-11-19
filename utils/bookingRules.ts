import type { Booking } from '../types';

export interface BookingTimeRange {
  resourceId: string;
  startTime: string;
  endTime: string;
}

export const timeRangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

export const isActiveBooking = (booking: Booking) => booking.status === 'PENDING' || booking.status === 'APPROVED';

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
