export type CheckInQr = { bookingId: string; scheduleVersion: number };

const valid = (bookingId: string, rawVersion: string | null): CheckInQr | null => {
  const scheduleVersion = Number(rawVersion);
  if (!bookingId || bookingId.length > 128 || /[\u0000-\u001f]/.test(bookingId)
    || !Number.isSafeInteger(scheduleVersion) || scheduleVersion < 1) return null;
  return { bookingId, scheduleVersion };
};

export const formatCheckInQr = (bookingId: string, scheduleVersion: number) =>
  `smart-office:check-in:${encodeURIComponent(bookingId)}:v${scheduleVersion}`;

export const parseCheckInQr = (rawValue: string): CheckInQr | null => {
  const value = rawValue.trim();
  const prefix = value.match(/^smart-office:check-in:([^:]+):v([1-9][0-9]*)$/);
  if (prefix) {
    try { return valid(decodeURIComponent(prefix[1]), prefix[2]); } catch { return null; }
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return valid(url.searchParams.get('bookingId') || '', url.searchParams.get('scheduleVersion'));
  } catch { return null; }
};
