import { defineConfig } from 'vitest/config';

/**
 * packages/platform 的 vitest 工程：纯 Node 环境，不依赖 Electron。
 * 由根 vitest.config.ts 的 projects 聚合。
 */
export default defineConfig({
  test: {
    name: 'platform',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
