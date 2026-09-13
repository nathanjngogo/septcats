import { defineConfig } from 'vitest/config';

/**
 * packages/sync 的 vitest 工程：纯 Node 环境。
 * 本包铁律（任务书 §0）：不碰网络/electron/better-sqlite3，所有 fs 访问经 SyncFs 注入，
 * 测试用 MemoryFs。因此与 core/schema 同为 node 环境，而非 editor 的 jsdom。
 */
export default defineConfig({
  test: {
    name: 'sync',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
