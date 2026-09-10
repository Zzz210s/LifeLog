import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        quick: resolve(__dirname, 'quick.html'),
      },
    },
  },
  clearScreen: false,
  // host 固定 IPv4 回环:Windows 上默认 localhost 可能只绑定 ::1,
  // 导致 tauri dev 轮询 devUrl(127.0.0.1 解析)永远连不上
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
