import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function smartOfficeApi() {
  const register = async (server: any) => {
    const { registerApi } = await import('./server/api');
    registerApi(server.middlewares);
  };
  return {
    name: 'smart-office-api',
    configureServer(server: any) { return register(server); },
    configurePreviewServer(server: any) { return register(server); },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // DeepSeek Key 只保留在 Node 进程内供 /api/ai 使用，不注入前端 bundle。
    for (const key of [
      'DEEPSEEK_API_KEY', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
      'SMART_OFFICE_DEV_AUTH', 'SMART_OFFICE_AUTH_RATE_LIMIT', 'SMART_OFFICE_AUTH_RATE_LIMIT_WINDOW_MS',
      'SMART_OFFICE_TRUST_PROXY', 'SMART_OFFICE_METRICS_TOKEN',
      'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI',
      'OIDC_TOKEN_ENCRYPTION_KEY',
      'SMART_OFFICE_WECOM_ENABLED', 'SMART_OFFICE_WECOM_URL', 'SMART_OFFICE_WECOM_AUTH_TOKEN',
      'SMART_OFFICE_SMS_ENABLED', 'SMART_OFFICE_SMS_URL', 'SMART_OFFICE_SMS_AUTH_TOKEN',
      'SMART_OFFICE_EMAIL_ENABLED', 'SMART_OFFICE_EMAIL_URL', 'SMART_OFFICE_EMAIL_AUTH_TOKEN',
      'SMART_OFFICE_EXTERNAL_HTTP_TIMEOUT_MS',
      'SMART_OFFICE_OA_CALLBACK_ENABLED', 'SMART_OFFICE_OA_CALLBACK_SECRET',
      'SMART_OFFICE_CALENDAR_ENABLED', 'SMART_OFFICE_CALENDAR_URL', 'SMART_OFFICE_CALENDAR_AUTH_TOKEN',
      'SMART_OFFICE_ACCESS_ENABLED', 'SMART_OFFICE_ACCESS_URL', 'SMART_OFFICE_ACCESS_AUTH_TOKEN'
    ]) {
      if (env[key] !== undefined) process.env[key] = env[key];
    }
    return {
      server: {
        port: 3001,
        strictPort: true,
        host: '127.0.0.1',
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              'react-vendor': ['react', 'react-dom', 'react-dom/client', 'scheduler']
            }
          }
        }
      },
      plugins: [react(), smartOfficeApi()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
