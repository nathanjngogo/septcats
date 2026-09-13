import { defineConfig } from 'vitest/config';

/**
 * packages/editor 的 vitest 工程。
 *
 * 工程划分裁决（任务书 §1 允许二选一）：**单 jsdom 工程全收**。
 * 理由：5a 的纯函数测试在 jsdom 下结果与 node 完全一致（不读 DOM），
 * 而 5b 的「真 PM + IME」测试必须 jsdom；拆两个 project 只会让同一份
 * 导入图跑两遍，收益为零。5a 仍保持「不 import react」的硬纪律（由 index
 * 与 react/** 的 exports 分离保证，见 src/index.ts 顶部注释）。
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    name: 'editor',
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
