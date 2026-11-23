import { getDbPool } from './db.ts';

const THEMES = new Set(['coamc', 'indigo', 'emerald', 'orange', 'rose', 'purple']);

export const getPreferences = async (userId: string) => {
  const [rows] = await getDbPool().query<any[]>('SELECT theme, sidebar_collapsed FROM user_preferences WHERE user_id = ?', [userId]);
  return { theme: rows[0]?.theme || 'indigo', sidebarCollapsed: Boolean(rows[0]?.sidebar_collapsed) };
};

export const updatePreferences = async (userId: string, input: any) => {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['theme', 'sidebarCollapsed'].includes(key))) {
    throw Object.assign(new Error('INVALID_PREFERENCES'), { status: 400 });
  }
  if (input.theme !== undefined && (typeof input.theme !== 'string' || !THEMES.has(input.theme))) {
    throw Object.assign(new Error('INVALID_THEME'), { status: 400 });
  }
  if (input.sidebarCollapsed !== undefined && typeof input.sidebarCollapsed !== 'boolean') {
    throw Object.assign(new Error('INVALID_SIDEBAR_PREFERENCE'), { status: 400 });
  }
  const current = await getPreferences(userId);
  const theme = input.theme ?? current.theme;
  const sidebarCollapsed = input.sidebarCollapsed ?? current.sidebarCollapsed;
  await getDbPool().query(`INSERT INTO user_preferences (user_id, theme, sidebar_collapsed) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE theme = VALUES(theme), sidebar_collapsed = VALUES(sidebar_collapsed)`, [userId, theme, sidebarCollapsed]);
  return { theme, sidebarCollapsed };
};
