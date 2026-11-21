import type { BookingRuleSettings } from '../types.ts';

const CHINA_OFFSET_MS = 8 * 3600000;

const chinaParts = (timestamp: number) => {
  const shifted = new Date(timestamp + CHINA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10)
  };
};

const chinaTimestamp = (year: number, month: number, day: number, minutes: number) =>
  Date.UTC(year, month, day, 0, minutes, 0, 0) - CHINA_OFFSET_MS;

const isWorkingDate = (parts: ReturnType<typeof chinaParts>, settings: BookingRuleSettings) =>
  parts.weekday !== 0 && parts.weekday !== 6 && !(settings.approvalHolidays || []).includes(parts.date);

export const addApprovalWorkingMinutes = (
  value: Date | string,
  amountMinutes: number,
  settings: BookingRuleSettings
): Date => {
  if (!Number.isFinite(amountMinutes) || amountMinutes < 0) throw new RangeError('Working minutes must be non-negative');
  let remaining = Math.round(amountMinutes * 60000);
  let cursor = new Date(value).getTime();
  if (!Number.isFinite(cursor)) throw new RangeError('Invalid approval start time');

  for (let guard = 0; guard < 400; guard++) {
    const parts = chinaParts(cursor);
    if (!isWorkingDate(parts, settings)) {
      cursor = chinaTimestamp(parts.year, parts.month, parts.day + 1, settings.approvalWorkStartMinutes);
      continue;
    }
    const dayStart = chinaTimestamp(parts.year, parts.month, parts.day, settings.approvalWorkStartMinutes);
    const dayEnd = chinaTimestamp(parts.year, parts.month, parts.day, settings.approvalWorkEndMinutes);
    if (cursor < dayStart) cursor = dayStart;
    if (cursor >= dayEnd) {
      cursor = chinaTimestamp(parts.year, parts.month, parts.day + 1, settings.approvalWorkStartMinutes);
      continue;
    }
    const available = dayEnd - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
    cursor = chinaTimestamp(parts.year, parts.month, parts.day + 1, settings.approvalWorkStartMinutes);
  }
  throw new RangeError('Unable to find an approval working time');
};

export const chinaDateKey = (value: Date | string) => chinaParts(new Date(value).getTime()).date;
