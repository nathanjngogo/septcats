/*
 * ensure-abi.mjs —— better-sqlite3 原生模块 ABI 守卫（PM 修复）。
 *
 * 背景：electron-rebuild 会把 better_sqlite3.node 换成 Electron ABI，纯 Node
 * （vitest / selftest）因此加载失败。本脚本按目标运行时保证二进制正确：
 *   node   → 若当前 Node 进程可加载 → 标记 node，通过；否则 pnpm rebuild better-sqlite3
 *   electron → 若标记已是 electron → 通过；否则 npx electron-rebuild -f -w better-sqlite3
 * 标记文件：<pkg>/.abi-target（node|electron），用于避免每次无谓重编。
 * 用法：node scripts/ensure-abi.mjs <node|electron>
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('usage: ensure-abi.mjs <node|electron>');
  process.exit(2);
}

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const markerPath = join(pkgDir, '.abi-target');
const require = createRequire(import.meta.url);

function readMarker() {
  try { return readFileSync(markerPath, 'utf8').trim(); } catch { return ''; }
}

function nodeLoadable() {
  try {
    const Mod = require('better-sqlite3');
    const db = new Mod(':memory:');
    db.close();
    return true;
  } catch { return false; }
}

function rebuild(args, label) {
  const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit', shell: true, cwd: pkgDir });
  if (r.status !== 0) { console.error(`ensure-abi: ${label} failed`); process.exit(1); }
}

if (target === 'node') {
  if (nodeLoadable()) { writeFileSync(markerPath, 'node\n'); process.exit(0); }
  rebuild(['pnpm', 'rebuild', 'better-sqlite3'], 'node-gyp rebuild');
  if (!nodeLoadable()) { console.error('ensure-abi: better-sqlite3 still not loadable in node'); process.exit(1); }
  writeFileSync(markerPath, 'node\n');
} else {
  if (readMarker() === 'electron') { process.exit(0); }
  rebuild(['npx', 'electron-rebuild', '-f', '-w', 'better-sqlite3'], 'electron-rebuild');
  writeFileSync(markerPath, 'electron\n');
}
