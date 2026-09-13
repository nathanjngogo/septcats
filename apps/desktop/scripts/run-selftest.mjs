#!/usr/bin/env node
/**
 * 运行 apps/desktop/src/db/selftest.ts —— DbServer 的纯 Node 冒烟自测（TASK-T2-01 §5）。
 *
 *   node apps/desktop/scripts/run-selftest.mjs
 *
 * 说明：
 * - 用 `node --import tsx` 直接执行 TS 源（selftest 不需要 Electron，也不进 electron-vite 产物）；
 *   因此 tsx 是 apps/desktop 的 devDependency。若被剔除，可用
 *   `node --import tsx apps/desktop/src/db/selftest.ts` 手动跑（cwd = apps/desktop）。
 * - selftest 需要 better-sqlite3 能在**当前 Node 运行时**加载。注意：`postinstall` 里的
 *   `electron-rebuild` 会把 better-sqlite3 重编译成 Electron 的 ABI，普通 Node 将无法加载
 *   （NODE_MODULE_VERSION 不匹配）。若遇到该情况，先跑自测再 `pnpm -C apps/desktop rebuild`，
 *   或参考 src/db/README.md。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const selftestPath = join(appDir, 'src', 'db', 'selftest.ts');

if (!existsSync(selftestPath)) {
  console.error(`找不到自测入口：${selftestPath}`);
  process.exit(1);
}

const nodeRequire = createRequire(import.meta.url);
try {
  nodeRequire.resolve('tsx', { paths: [appDir] });
} catch {
  console.error('缺少 tsx：请先在仓库根执行 `pnpm install`（apps/desktop 的 devDependencies 含 tsx）。');
  process.exit(1);
}

// `--import` 的裸模块解析以 cwd 为基准，故 cwd 固定为 apps/desktop
const child = spawn(process.execPath, ['--import', 'tsx', selftestPath], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('error', (error) => {
  console.error(`启动 selftest 失败：${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`selftest 被信号终止：${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
