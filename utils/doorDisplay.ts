export const DOOR_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
export const DOOR_CACHE_KEY_PREFIX = 'SMART_OFFICE_DOOR_LAST_SNAPSHOT';

export type DoorSnapshotTiming = {
  generatedAt: string;
  expiresAt: string;
};

export const doorCacheKey = (token: string) => `${DOOR_CACHE_KEY_PREFIX}:${token.slice(0, 12)}`;

export const doorSnapshotStatus = (snapshot: DoorSnapshotTiming | null, now = Date.now()) => {
  if (!snapshot) return 'MISSING' as const;
  const generatedAt = Date.parse(snapshot.generatedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)
    || expiresAt - generatedAt !== DOOR_SNAPSHOT_MAX_AGE_MS
    || generatedAt > now + 30_000) return 'INVALID' as const;
  return now < expiresAt ? 'FRESH' as const : 'EXPIRED' as const;
};

export const formatDoorCountdown = (target: string, now: number, prefix: '剩余' | '距开始') => {
  const remaining = Date.parse(target) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return prefix === '剩余' ? '已结束' : '即将开始';
  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${prefix} ${hours ? `${hours} 小时 ` : ''}${rest} 分钟`;
};

export const upcomingDoorBookings = <T extends { status: string; endTime: string }>(bookings: T[], now: number) =>
  bookings.filter(item => ['IN_PROGRESS', 'UPCOMING'].includes(item.status) && Date.parse(item.endTime) > now);
