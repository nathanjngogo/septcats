import { defineConfig } from 'vitest/config';

/**
 * 根 vitest 配置：用 projects 模式把各 workspace 包串起来。
 * 各包在自己的 vitest.config.ts 里声明 root / include / environment。
 * 覆盖面门禁按任务书 §6：packages/core 的 src 行覆盖 >= 90%。
 */
export default defineConfig({
  test: {
    // 显式列出各包，避免 `packages/*` 与单独条目重复跑同一个工程。
    projects: ['packages/core', 'packages/schema', 'packages/platform', 'packages/ui', 'apps/desktop'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // 只统计纯逻辑核心的源码；测试文件与 barrel 入口不计入分母。
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 90,
      },
    },
  },
});
