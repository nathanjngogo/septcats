import { defineConfig } from 'vitest/config';

/**
 * packages/ui 的 vitest 工程：jsdom + @testing-library/react。
 * 由根 vitest.config.ts 的 projects 聚合，也被 `pnpm -r test` 单独拉起。
 * CSS 不参与计算（默认 css:false），组件测试用 `?raw` 读样式文本做 token 纪律断言。
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
