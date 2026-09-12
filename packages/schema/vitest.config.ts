import { defineConfig } from 'vitest/config';

/**
 * packages/schema 的 vitest 工程：纯 Node 环境。
 * 由根 vitest.config.ts 的 projects 聚合。
 */
export default defineConfig({
  test: {
    name: 'schema',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
