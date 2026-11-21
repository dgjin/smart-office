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
