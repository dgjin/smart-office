import { DbError, getDbPool } from './db.ts';

export const listNotifications = async (userId: string, limit = 50) => {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 50;
  const [rows] = await getDbPool().query<any[]>(`SELECT n.id, n.user_id, n.title, n.content, n.timestamp,
    CASE WHEN n.user_id = 'sys' THEN read_state.read_at IS NOT NULL ELSE n.is_read END AS is_read,
    n.type, n.link_view
    FROM notifications n
    LEFT JOIN notification_read_states read_state
      ON read_state.notification_id = n.id AND read_state.user_id = ?
    WHERE n.user_id = ? OR n.user_id = 'sys'
    ORDER BY n.timestamp DESC, n.id DESC LIMIT ?`, [userId, userId, boundedLimit]);
  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    timestamp: new Date(row.timestamp).toISOString(),
    isRead: Boolean(row.is_read),
    type: row.type,
    linkView: row.link_view || undefined
  }));
};

export const markNotificationsRead = async (userId: string, ids: string[]) => {
  const target = [...new Set(ids)];
  if (!target.length) return 0;
  const conn = await getDbPool().getConnection();
  let locked = false;
  try {
    const [lockRows] = await conn.query<any[]>("SELECT GET_LOCK('smart_office_write', 10) AS acquired");
    if (!lockRows[0]?.acquired) throw new DbError('数据库正忙，请稍后重试', 503);
    locked = true;
    await conn.beginTransaction();
    const placeholders = target.map(() => '?').join(',');
    const [rows] = await conn.query<any[]>(`SELECT id, user_id, is_read FROM notifications
      WHERE id IN (${placeholders}) AND (user_id = ? OR user_id = 'sys') FOR UPDATE`, [...target, userId]);
    const directedIds = rows.filter(row => row.user_id !== 'sys' && !row.is_read).map(row => row.id);
    const broadcastIds = rows.filter(row => row.user_id === 'sys').map(row => row.id);
    let changed = 0;
    if (directedIds.length) {
      const [result] = await conn.query<any>(`UPDATE notifications SET is_read = 1
        WHERE id IN (${directedIds.map(() => '?').join(',')}) AND user_id = ? AND is_read = 0`, [...directedIds, userId]);
      changed += Number(result.affectedRows || 0);
    }
    if (broadcastIds.length) {
      const [result] = await conn.query<any>(`INSERT IGNORE INTO notification_read_states (notification_id, user_id, read_at)
        VALUES ${broadcastIds.map(() => '(?, ?, CURRENT_TIMESTAMP(3))').join(',')}`,
        broadcastIds.flatMap(id => [id, userId]));
      changed += Number(result.affectedRows || 0);
    }
    await conn.commit();
    return changed;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK('smart_office_write')").catch(() => {});
    conn.release();
  }
};
