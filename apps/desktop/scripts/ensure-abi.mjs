/*
 * ensure-abi.mjs —— better-sqlite3 原生模块 ABI 守卫（T83-01 加固版）。
 *
 * 背景：electron-rebuild 会把 better_sqlite3.node 换成 Electron ABI，纯 Node
 * （vitest / selftest）因此加载失败。本脚本按目标运行时保证二进制正确：
 *   node     → 加载探针判活在位；否则 缓存 → npmmirror prebuild 下载 → pnpm rebuild 兜底
 *   electron → 标记已是 electron 且在位 → 通过；否则 缓存 → dist 回填 → electron-rebuild
 * 标记文件：<pkg>/.abi-target（node|electron），避免每次无谓重编。
 *
 * T83-01 硬不变量（09-25 两次实踩教训）：
 *  ①销毁前必先备份：任何会动 build/Release 的操作前，先把现有二进制备份为同盘
 *    `.tmp-abi-<ts>.node`；失败一律原样回填——「重建失败后二进制丢失」在任何路径
 *    下都不允许发生（pnpm rebuild 失败会先删掉整个 build/Release，即 09-25 事故根因）。
 *  ②本地缓存 apps/desktop/.abi-cache/{node,electron}.node：命中 → 直接复制，不触发
 *    rebuild/下载；成功装位后就地存缓存。
 *  ③幂等：目标已就位 → 零副作用（不复制、不下载、不重编），一行状态退出。
 *  ④electron ABI 无法在 node 进程 require 验证（必抛），electron 走「标记+存在性」口径。
 * 用法：node scripts/ensure-abi.mjs <node|electron>
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(pkgDir, '.abi-cache');
const markerPath = join(pkgDir, '.abi-target');
const require = createRequire(import.meta.url);

function log(msg) { console.log(`ensure-abi: ${msg}`); }

/** 定位安装树里 better-sqlite3 的 build/Release/better_sqlite3.node（pnpm 布局）。 */
export function findBs3Bin(cwdPkgDir = pkgDir) {
  const direct = join(cwdPkgDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (existsSync(direct)) { return direct; }
  try {
    const root = join(cwdPkgDir, '..', '..', 'node_modules', '.pnpm');
    for (const h of readdirSync(root).filter((d) => d.startsWith('better-sqlite3@'))) {
      const p = join(root, h, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
      if (existsSync(p)) { return p; }
    }
  } catch { /* 布局异常按缺失处理 */ }
  return null;
}

/** better-sqlite3 版本（读包内 package.json；失败退到仓内钉死版本）。 */
export function bs3Version(binPath, fallback = '12.11.1') {
  try {
    // .../better-sqlite3/build/Release/x.node → 上三级=包目录
    const pj = JSON.parse(readFileSync(join(dirname(dirname(dirname(binPath))), 'package.json'), 'utf8'));
    return String(pj.version ?? fallback);
  } catch { return fallback; }
}

/** prebuild 下载 URL（npmmirror 镜像；GitHub 本机不通——09-25 实测）。 */
export function buildPrebuildUrl({ version, nodeAbi, platform = process.platform, arch = process.arch }) {
  return `https://registry.npmmirror.com/-/binary/better-sqlite3/v${version}/better-sqlite3-v${version}-node-v${String(nodeAbi)}-${platform}-${arch}.tar.gz`;
}

/** 备份现存二进制 → 备份路径（无文件=null）。备份目录必须是**不会被重建摧毁**的位置
 *  （pnpm rebuild 失败会删掉整个 build/Release——备份放旁边=同归于毁，T83-01 测试钉死）。 */
export function backupBinary(binPath, bakDir = join(pkgDir, '.abi-cache')) {
  if (binPath === null || !existsSync(binPath)) { return null; }
  mkdirSync(bakDir, { recursive: true });
  const bak = join(bakDir, `.tmp-abi-${String(Date.now())}.node`);
  copyFileSync(binPath, bak);
  return bak;
}

/** 回填备份（字节原样）→ 是否发生回填。 */
export function restoreBackup(binPath, bak) {
  if (bak === null || !existsSync(bak)) { return false; }
  mkdirSync(dirname(binPath), { recursive: true });
  copyFileSync(bak, binPath);
  rmSync(bak, { force: true });
  return true;
}

function readMarker() {
  try { return readFileSync(markerPath, 'utf8').trim(); } catch { return ''; }
}
function writeMarker(t) { writeFileSync(markerPath, `${t}\n`); }

function nodeLoadable() {
  try {
    const Mod = require('better-sqlite3');
    const db = new Mod(':memory:');
    db.close();
    return true;
  } catch { return false; }
}

const cachePath = (target) => join(CACHE_DIR, `${target}.node`);

/** 目标在位判定：node=加载探针；electron=标记+文件存在（见头注④）。 */
export function inPlace(target, binPath) {
  if (binPath === null || !existsSync(binPath)) { return false; }
  if (target === 'node') { return nodeLoadable(); }
  return readMarker() === 'electron';
}

function tryCache(target, binPath) {
  const c = cachePath(target);
  if (!existsSync(c)) { return false; }
  copyFileSync(c, binPath);
  if (target === 'node' && !nodeLoadable()) {
    log('缓存副本加载失败，弃用缓存');
    rmSync(c, { force: true });
    return false;
  }
  log(`缓存命中（.abi-cache/${target}.node）`);
  return true;
}

function saveCache(target, binPath) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    copyFileSync(binPath, cachePath(target));
  } catch { /* 缓存是加速器不是正确性依赖，失败静默 */ }
}

/** electron-rebuild 不可用/失败时，从本机 dist 已验产物回填（09-25 实证路径）。 */
function seedFromDist(binPath) {
  const dist = join(pkgDir, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked',
    'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (!existsSync(dist)) { return false; }
  mkdirSync(dirname(binPath), { recursive: true });
  copyFileSync(dist, binPath);
  log('已从 dist/win-unpacked 回填 electron ABI（本机已验产物）');
  return true;
}

async function tryDownloadPrebuild(binPath) {
  const url = buildPrebuildUrl({ version: bs3Version(binPath), nodeAbi: Number(process.versions.modules) });
  try {
    log(`尝试 prebuild 下载：${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) { log(`下载失败 HTTP ${String(res.status)}`); return false; }
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = mkdtempSync(join(tmpdir(), 'abi-dl-'));
    const tgz = join(dir, 'prebuild.tar.gz');
    writeFileSync(tgz, buf);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'ignore' });
    if (r.status !== 0) { log('tar 解包失败'); rmSync(dir, { recursive: true, force: true }); return false; }
    const got = join(dir, 'build', 'Release', 'better_sqlite3.node');
    if (!existsSync(got)) { rmSync(dir, { recursive: true, force: true }); return false; }
    mkdirSync(dirname(binPath), { recursive: true });
    copyFileSync(got, binPath);
    rmSync(dir, { recursive: true, force: true });
    if (!nodeLoadable()) { log('下载的 prebuild 加载失败'); return false; }
    log('prebuild 下载并加载成功');
    return true;
  } catch (e) { log(`下载异常：${String(e).slice(0, 140)}`); return false; }
}

function rebuild(cmd, label) {
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: true, cwd: pkgDir });
  if (r.status !== 0) { log(`${label} 失败（exit ${String(r.status)}）`); return false; }
  return true;
}

export async function main(target) {
  const binPath = findBs3Bin();
  if (binPath === null) { log('找不到 better_sqlite3.node（先 pnpm install）'); return 1; }

  // ③ 幂等：目标已就位 → 零副作用。
  if (inPlace(target, binPath)) {
    if (readMarker() !== target) { writeMarker(target); }
    log(`${target} ABI 已就位（零副作用）`);
    return 0;
  }

  // ② 缓存命中。
  if (tryCache(target, binPath)) { writeMarker(target); return 0; }

  // ① 备份先行：以下任何路径都可能摧毁 build/Release。
  const bak = backupBinary(binPath);
  try {
    if (target === 'node') {
      if (!(await tryDownloadPrebuild(binPath))
        && !rebuild(['pnpm', 'rebuild', 'better-sqlite3'], 'node-gyp rebuild')) {
        throw new Error('node ABI 两条恢复路径均失败');
      }
      if (!nodeLoadable()) { throw new Error('better-sqlite3 在 node 下仍不可加载'); }
    } else {
      if (!seedFromDist(binPath)
        && !rebuild(['npx', 'electron-rebuild', '-f', '-w', 'better-sqlite3'], 'electron-rebuild')) {
        throw new Error('electron ABI 恢复路径均失败');
      }
    }
    writeMarker(target);
    saveCache(target, binPath);
    if (bak !== null) { rmSync(bak, { force: true }); }
    log(`已切换到 ${target} ABI（${String(statSync(binPath).size)} B）`);
    return 0;
  } catch (e) {
    // 硬不变量：失败原样回填，绝不留下「二进制丢失」状态。
    if (restoreBackup(binPath, bak)) {
      log(`失败已回填原二进制（字节原样 ${String(statSync(binPath).size)} B，未丢失）；原因：${String(e?.message ?? e)}`);
    } else if (target === 'electron' && seedFromDist(binPath)) {
      writeMarker('electron');
      saveCache('electron', binPath);
      log('失败且无原件可回填：改用 dist 已验产物，未丢失');
      return 0;
    } else {
      log(`失败且原状态即缺失、无备份可回填；原因：${String(e?.message ?? e)}`);
    }
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2];
  if (target !== 'node' && target !== 'electron') {
    console.error('usage: ensure-abi.mjs <node|electron>');
    process.exit(2);
  }
  main(target).then((code) => { process.exitCode = code; });
}
