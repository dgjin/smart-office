import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { registerApi } from './server/api';

function smartOfficeApi() {
  return {
    name: 'smart-office-api',
    configureServer(server: any) { registerApi(server.middlewares); },
    configurePreviewServer(server: any) { registerApi(server.middlewares); },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // DeepSeek Key 只保留在 Node 进程内供 /api/ai 使用，不注入前端 bundle。
    if (env.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), smartOfficeApi()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
