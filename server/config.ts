const databaseName = process.env.MYSQL_DATABASE || 'smart_office';
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) throw new Error('MYSQL_DATABASE 只能包含字母、数字和下划线');

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const DATABASE_NAME = databaseName;
export const REQUIRED_MIGRATION = '015_hq3d_stable_room_identity.sql';
export const SERVER_HOST = process.env.SMART_OFFICE_HOST || '127.0.0.1';
export const SERVER_PORT = Number(process.env.SMART_OFFICE_PORT || 3001);
export const DEV_AUTH_ENABLED = NODE_ENV === 'development' && process.env.SMART_OFFICE_DEV_AUTH === 'true';
export const SESSION_COOKIE = IS_PRODUCTION ? '__Host-smart_office_session' : 'smart_office_session';
const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
export const AUTH_RATE_LIMIT_MAX = positiveInteger(process.env.SMART_OFFICE_AUTH_RATE_LIMIT, 30);
export const AUTH_RATE_LIMIT_WINDOW_MS = positiveInteger(process.env.SMART_OFFICE_AUTH_RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000);
export const TRUST_PROXY = process.env.SMART_OFFICE_TRUST_PROXY === 'true';
export const METRICS_TOKEN = process.env.SMART_OFFICE_METRICS_TOKEN || '';

export const dbConfig = (migration = false) => ({
  host: (migration ? process.env.MYSQL_MIGRATION_HOST : '') || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number((migration ? process.env.MYSQL_MIGRATION_PORT : '') || process.env.MYSQL_PORT || 3306),
  user: (migration ? process.env.MYSQL_MIGRATION_USER : '') || process.env.MYSQL_USER || 'root',
  password: (migration ? process.env.MYSQL_MIGRATION_PASSWORD : undefined) ?? process.env.MYSQL_PASSWORD ?? '',
  database: DATABASE_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z' as const,
  dateStrings: false,
  multipleStatements: false
});

export const oidcConfig = () => ({
  issuer: process.env.OIDC_ISSUER || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.OIDC_REDIRECT_URI || ''
});
