// dist-win-cross.mjs —— 在 Linux/macOS 上交叉打 Windows NSIS 安装包（一条命令版）。
// 背景（10-02 老板定方案 B）：网关迁到 Linux 本机后没有 Windows shell，
//   原 `pnpm -C apps/desktop dist` 的 ensure-abi 环节会强制 node-gyp 现编当前平台模块，
//   跨平台被拒（node-gyp does not support cross-compiling）。
// 本脚本绕开该环节：builder 收编**预置的 win 版原生模块** + `-c.npmRebuild=false`。
// 前提（均一次性，本机已就绪）：
//   ① 系统 wine 含 32 位（NSIS 卸载器 dump 这一步固定走 wine；makensis 本身是 Linux 原生）；
//   ② 可达 npmmirror（electron 包 / better-sqlite3 win prebuild / builder 工具链）。
// 用法：pnpm -C apps/desktop dist:win-cross
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..'); // apps/desktop
const REPO = join(APP, '..', '..');
const PNPMPKGS = join(REPO, 'node_modules', '.pnpm');
const run = (cmd, args, opts = {}) => {
  console.log(`\$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: APP, stdio: 'inherit', env: process.env, ...opts });
  if (r.status !== 0) throw new Error(`命令失败（rc=${String(r.status)}）：${cmd} ${args.join(' ')}`);
};

if (process.platform === 'win32') {
  throw new Error('本机就是 Windows：直接用原流程 pnpm -C apps/desktop dist，不要用本脚本。');
}

// —— ① 前置：wine 在场（一次性安装：sudo apt install wine64 wine32:i386）——
const wine = spawnSync('wine', ['--version'], { encoding: 'utf8' });
if (wine.status !== 0) {
  throw new Error('未找到 wine。一次性安装：sudo dpkg --add-architecture i386 && sudo apt update && sudo apt install -y wine64 wine32:i386');
}
console.log(`wine ok: ${(wine.stdout ?? '').trim()}`);

// 镜像兜底（npmmirror；直连 GitHub 在本网常停滞）
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/';

// —— ② electron 实装版本 → electron ABI 号（经 node-abi，ABI 随 electron 大版本变，脚本自动跟）——
const electronVersion = JSON.parse(readFileSync(join(APP, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const abiPkg = readdirSync(PNPMPKGS).find((d) => d.startsWith('node-abi@'));
if (abiPkg === undefined) throw new Error('node_modules/.pnpm 里找不到 node-abi');
const { createRequire } = await import('node:module');
const nodeAbi = createRequire(import.meta.url)(join(PNPMPKGS, abiPkg, 'node_modules', 'node-abi'));
const abi = nodeAbi.getAbi(electronVersion, 'electron');
console.log(`electron ${electronVersion} → ABI ${String(abi)}`);

// —— ③ better-sqlite3：确保 build/Release/better_sqlite3.node 是 **win PE**（不是就拉 prebuild 覆盖）——
const bsDirName = readdirSync(PNPMPKGS).find((d) => d.startsWith('better-sqlite3@'));
if (bsDirName === undefined) throw new Error('找不到 better-sqlite3（先 pnpm install --ignore-scripts）');
const bsDir = join(PNPMPKGS, bsDirName, 'node_modules', 'better-sqlite3');
const bsVersion = JSON.parse(readFileSync(join(bsDir, 'package.json'), 'utf8')).version;
const nodePath = join(bsDir, 'build', 'Release', 'better_sqlite3.node');
const isWinPE = (p) => { try { return readFileSync(p).subarray(0, 2).toString('latin1') === 'MZ'; } catch { return false; } };
if (!isWinPE(nodePath)) {
  const url = `https://registry.npmmirror.com/-/binary/better-sqlite3/v${bsVersion}/better-sqlite3-v${bsVersion}-electron-v${String(abi)}-win32-x64.tar.gz`;
  console.log(`预置 win 原生模块：${url}`);
  const tmp = join(REPO, '.dist-win-cross-tmp');
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  execFileSync('curl', ['-fsSL', '--retry', '4', '--retry-all-errors', '-o', join(tmp, 'bs.tar.gz'), url]);
  execFileSync('tar', ['xzf', join(tmp, 'bs.tar.gz'), '-C', tmp]);
  const found = execFileSync('find', [tmp, '-name', 'better_sqlite3.node']).toString().trim().split('\n')[0];
  if (!isWinPE(found)) throw new Error('prebuild 解出的模块不是 win PE，检查 ABI 对应关系');
  mkdirSync(dirname(nodePath), { recursive: true });
  execFileSync('cp', [found, nodePath]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`已布防 → ${nodePath}`);
} else {
  console.log('win 原生模块已在位（跳过下载）');
}

// —— ④ 构建三进程产物（electron-vite，等效 pnpm build 去掉 Windows 专用 ensure-abi）——
// 图标：apps/desktop/build/*.{ico,png} 是仓库跟踪资产（Windows 本机 dist 同样不现跑 make-icon，
// 后者需要本地 electron 运行时，Linux 交叉环境没有）；缺了直接报，别让 builder 默默用错素材。
for (const need of ['icon.ico', 'icon.png', 'icon-tray.png']) {
  if (!existsSync(join(APP, 'build', need))) {
    throw new Error(`build/${need} 缺失：先跑 pnpm -C apps/desktop make-icon（需本机 electron 运行时的环境里）`);
  }
}
run('pnpm', ['exec', 'electron-vite', 'build']);

// —— ⑤ 打包：npmRebuild=false 让 builder 收编我们预置的 win 模块，不再尝试 node-gyp ——
run('pnpm', ['exec', 'electron-builder', '--win', 'nsis', '--x64', '--config', 'electron-builder.yml', '-c.npmRebuild=false']);

// —— ⑥ 产物报告 + 体积护栏（同 dist:check 的 150MB 线）——
const version = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')).version;
const exe = join(APP, 'dist', `Septcats Setup ${version}.exe`);
if (!existsSync(exe)) throw new Error(`产物缺失：${exe}`);
const buf = readFileSync(exe);
const sha = createHash('sha256').update(buf).digest('hex');
console.log(`\n===== dist:win-cross 完成 =====`);
console.log(`Septcats Setup ${version}.exe  ${String(buf.length)} bytes  sha256=${sha}`);
if (buf.length > 150 * 1024 * 1024) throw new Error('体积护栏：超过 150 MB');
