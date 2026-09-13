import { defineConfig } from 'vitest/config';

/**
 * apps/desktop 的测试跑在纯 Node 环境（任务书 §6：只测 db 纯函数层与 better-sqlite3 直连，
 * 不依赖 Electron；Electron 集成链路由 PM 真机验收）。
 */
export default defineConfig({
  // jsdom 用例（test/db-bridge.test.ts）经文件头 `@vitest-environment jsdom` 覆盖环境；
  // 这里统一开 React 自动 JSX 转换，供 .tsx 源码（renderer/dbview）在测试里被 import 时转译。
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
