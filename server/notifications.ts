import { mutateDb, readDb } from './db.ts';

export const listNotifications = async (userId: string, limit = 50) => {
  const db = await readDb();
  return (db.notifications || [])
    .filter(n => n.userId === userId || n.userId === 'sys')
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
    .slice(0, limit);
};

export const markNotificationsRead = async (userId: string, ids: string[]) => mutateDb(db => {
  const target = new Set(ids);
  let changed = 0;
  db.notifications = (db.notifications || []).map(n => {
    if (!target.has(n.id) || (n.userId !== userId && n.userId !== 'sys') || n.isRead) return n;
    changed += 1;
    return { ...n, isRead: true };
  });
  return changed;
}, { snapshot: false });
