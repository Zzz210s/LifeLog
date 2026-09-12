import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** 构建期取应用版本(真源 tauri.conf.json;缺失时退回 package.json),供设置页显示 */
function appVersion(): string {
  const read = (p: string): string =>
    JSON.parse(readFileSync(resolve(__dirname, p), 'utf8')).version as string;
  try {
    return read('src-tauri/tauri.conf.json');
  } catch {
    return read('package.json');
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        input: resolve(__dirname, 'input.html'),
      },
    },
  },
  clearScreen: false,
  // host 固定 IPv4 回环:Windows 上默认 localhost 可能只绑定 ::1,
  // 导致 tauri dev 轮询 devUrl(127.0.0.1 解析)永远连不上
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
