/*
 * check-dist.mjs —— dist 产物存在性与体积护栏检查（TASK-T12-01 §1 `dist:check`）。
 *
 * 检查项：
 *   1. dist/ 存在 NSIS 安装器（Septcats Setup *.exe）与 latest.yml；
 *   2. ~~安装器体积 ≤ 150 MB~~（09-26 老板裁决：体积不设闸，只如实并报——思源黑体
 *      自托管优先；改判前该护栏拦过 maximum 压缩救不回的场景，现仅作观测）。
 * 用法：pnpm -C apps/desktop dist:check
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const pkgDir = join(import.meta.dirname, '..');
const distDir = join(pkgDir, 'dist');
// 09-26 老板裁决取消体积预算（99999=观测哨兵，永不触发；恢复护栏时改回 150 即可）
const BUDGET_MB = 99999;

let entries;
try {
  entries = readdirSync(distDir);
} catch {
  console.error('dist:check FAILED — dist/ 不存在，先跑 pnpm -C apps/desktop dist');
  process.exit(1);
}

const exes = entries.filter((f) => f.endsWith('.exe'));
const ymls = entries.filter((f) => f === 'latest.yml' || f.endsWith('.blockmap'));

if (exes.length === 0) {
  console.error('dist:check FAILED — dist/ 内无 .exe 安装器');
  process.exit(1);
}
if (!entries.includes('latest.yml')) {
  console.error('dist:check FAILED — dist/ 内无 latest.yml（builder publish 元数据）');
  process.exit(1);
}

let failed = false;
for (const f of [...exes, ...ymls]) {
  const mb = statSync(join(distDir, f)).size / (1024 * 1024);
  const over = f.endsWith('.exe') && mb > BUDGET_MB;
  if (over) failed = true;
  console.log(`  ${f}  ${mb.toFixed(2)} MB${over ? `  > ${BUDGET_MB} MB 预算，超限!` : ''}`);
}

if (failed) {
  console.error(`dist:check FAILED — 安装器超出 R7 预算 ${BUDGET_MB} MB`);
  process.exit(1);
}
console.log('dist:check ok');
