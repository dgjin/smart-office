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
      'OIDC_TOKEN_ENCRYPTION_KEY'
    ]) {
      if (env[key] !== undefined) process.env[key] = env[key];
    }
    return {
      server: {
        port: 3001,
        strictPort: true,
        host: '127.0.0.1',
      },
      plugins: [react(), smartOfficeApi()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
