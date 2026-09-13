import { defineConfig } from 'vitest/config';

/**
 * packages/dbview 的 vitest 工程（任务书 §1：node+jsdom 双工程）。
 *
 * 拆法与 editor 不同，理由：
 * - `test/*.test.ts` 是**纯逻辑**（types/values/view/csv），不含 DOM，跑 node 更快；
 * - `test/react.test.tsx` 需要 jsdom（render + fireEvent）。
 * 两个工程的 include 互斥（tsx vs ts），不会重复跑同一份用例。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'dbview-logic',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
        test: {
          name: 'dbview-react',
          environment: 'jsdom',
          include: ['test/**/*.test.tsx'],
          setupFiles: ['./test/setup.ts'],
        },
      },
    ],
  },
});
