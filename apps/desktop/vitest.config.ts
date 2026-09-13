import { defineConfig } from 'vitest/config';

/**
 * apps/desktop 的测试跑在纯 Node 环境（任务书 §6：只测 db 纯函数层与 better-sqlite3 直连，
 * 不依赖 Electron；Electron 集成链路由 PM 真机验收）。
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
