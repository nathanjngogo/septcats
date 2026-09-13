import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Windows 盘符大小写归一：把路径的盘符统一成大写。
 *
 * 为什么必须有：某些调用链（如 Git Bash → pnpm）传下来的 cwd 是小写盘符
 * （e:\...）。此时 vitest/vite 给源码模块生成的 file URL 也是小写盘符，
 * 而 pnpm 符号链接的 realpath 存的是大写盘符（E:\...）——Node 的模块缓存
 * 按路径字符串判身份，同一份 react 就出现两个实例（ESM 侧 e:\、require 侧
 * E:\），React hook 组件在聚合跑下集体报 "Invalid hook call"。
 * 包内单独跑（pnpm -C packages/ui test）时 pnpm 给的 cwd 是大写盘符，
 * 两侧身份一致，所以只有根聚合跑会炸。
 */
function normalizeDriveCase(p: string): string {
  return p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
}

// 配置自身所在目录（仓库根），盘符已归一
const repoRoot = normalizeDriveCase(fileURLToPath(new URL('.', import.meta.url)));

// 把进程 cwd 也切到归一后的路径，保证后续所有相对路径推导都从大写盘符出发
if (process.platform === 'win32' && process.cwd() !== repoRoot) {
  try {
    process.chdir(repoRoot);
  } catch {
    // 切换失败不拦路：单包直跑等场景 cwd 本就一致
  }
}

/**
 * 根 vitest 配置：用 projects 模式把各 workspace 包串起来。
 * 各包在自己的 vitest.config.ts 里声明 root / include / environment。
 * 覆盖面门禁按任务书 §6：packages/core 的 src 行覆盖 >= 90%。
 */
export default defineConfig({
  root: repoRoot,
  test: {
    // 显式列出各包，避免 `packages/*` 与单独条目重复跑同一个工程。
    projects: [
      'packages/core',
      'packages/schema',
      'packages/platform',
      'packages/ui',
      'packages/editor',
      'apps/desktop',
    ],
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
