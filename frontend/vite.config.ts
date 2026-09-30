import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3224,
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        // 浏览器请求 /api/xxx -> Vite 服务端转发到后端 xxx（去掉 /api 前缀）
        // 服务端转发不受浏览器 CORS / Private Network Access 限制
        '/api': {
          target: env.API_PROXY_TARGET || 'http://127.0.0.1:8121',
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  };
});
