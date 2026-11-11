// 独立于主应用(LifeLog/vitest.config.ts)的测试范围：插件用例都在 test/ 下
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
