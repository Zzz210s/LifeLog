import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 测试直接引 .tsx 模块(视图图标组件),故与 vite.config.ts 一致挂 react 插件
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
