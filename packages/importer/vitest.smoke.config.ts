import { defineConfig } from 'vitest/config';
/** PM 金标准核对专用（不在 test/** 口径内，pnpm -r test 不跑它）：
 *  node vitest --config vitest.smoke.config.ts —— 需要本机 _scratch/real-notion 存在。 */
export default defineConfig({
  test: { name: 'importer-golden', environment: 'node', include: ['test-real/**/*.test.ts'] },
});
