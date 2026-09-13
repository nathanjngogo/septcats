import { defineConfig } from 'vitest/config';

/**
 * packages/importer 的 vitest 工程：纯 Node 环境。
 * 本包铁律（任务书 §0）：纯逻辑零 IO——输入是注入的 ImportSourceFs，
 * 输出是 ImportPlan（不直接写库/网络/electron/better-sqlite3），与 sync 同为 node 环境。
 */
export default defineConfig({
  test: {
    name: 'importer',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
