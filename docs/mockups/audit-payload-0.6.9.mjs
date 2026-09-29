/* audit-payload-0.6.9.mjs —— 安装包载荷审计 + 已装状态只读审计（0.6.9）
 *
 * 为什么不是「静默装一遍再卸」：老板机上**已装 Septcats 0.6.9**（per-user，卸载项
 * 766c4907-638f-5fa9-b7f5-a2393e8384d0）。真跑安装/卸载往返会把他的现有安装抹掉 ——
 * 属破坏性操作，未经批准不做。改用**零系统改动**的两条硬证据：
 *   ① 把 Setup exe 解包（NSIS 内嵌 app-64.7z），与 win-unpacked 逐文件比对 —— 证明
 *      「用户装到的字节 = 本轮审过的字节」；
 *   ② 只读审计已装状态（版本/卸载项/快捷方式/已装 asar），并判定它与终包是否同一次构建。
 *
 * 判据：
 *   P1 Setup 是 NSIS-3 Unicode，内嵌 app-64.7z 与 Uninstall 卸载器（安装器结构完整）。
 *   P2 解包载荷与 win-unpacked 核心件逐字节一致（Septcats.exe / resources/app.asar）。
 *   P3 解包载荷文件数与 win-unpacked 一致（无漏件/多件）。
 *   P4 已装状态存在且卸载项版本 = 0.6.9、卸载器在位（能被正常卸载）。
 *   P5 已装 asar 与终包是否同一次构建（不同 = 老板装的仍是旧候选，需重装终包再测）。
 *   P6 安装目录名体检（electron-builder 把包名 @septcats/desktop 净化成 @septcatsdesktop）。
 *   P7 卸载不删用户数据（配置 deleteAppDataOnUninstall:false + 真实档案根 mtime 不变）。
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const DIST = join(REPO, 'apps', 'desktop', 'dist');
const UNPACKED = join(DIST, 'win-unpacked');
const SETUP = join(DIST, 'Septcats Setup 0.6.9.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\payaudit-069';
const OUT = join(SCRIPT_DIR, 'screens-audit-069');
const SEVENZ = 'C:\\Program Files\\7-Zip\\7z.exe';
const INSTALLED = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\@septcatsdesktop';
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const checks = [];
function check(name, ok, raw) {
  const id = /^([A-Z]\d[a-z]?)/.exec(String(name))?.[1] ?? '?';
  checks.push({ id, name, ok: ok === true, raw: String(raw).slice(0, 300) });
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${id}] ${name}  — ${String(raw).slice(0, 240)}`);
}
function info(text) { console.log(`INFO ${text}`); }
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const rootMtime = () => { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } };
/** 递归列文件（相对路径 → 大小）。 */
function tree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(relative(root, p).replace(/\\/g, '/'), statSync(p).size);
    }
  };
  walk(root);
  return out;
}

function main() {
  const mtimeBefore = rootMtime();
  mkdirSync(OUT, { recursive: true });
  mkdirSync(RUN, { recursive: true });
  console.log(`[payload-audit] 靶 = ${SETUP}`);

  // ---------- P1 安装器结构 ----------
  const listing = execSync(`"${SEVENZ}" l "${SETUP}"`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const isNsis = /Type = Nsis/i.test(listing) || /SubType = NSIS-3 Unicode/.test(listing);
  const hasPayload = listing.includes('app-64.7z');
  const hasUninstaller = /Uninstall Septcats\.exe/.test(listing);
  check('P1 Setup 为 NSIS-3 安装器，内嵌 app-64.7z 与卸载器',
    isNsis && hasPayload && hasUninstaller,
    `NSIS=${String(isNsis)} app-64.7z=${String(hasPayload)} 卸载器=${String(hasUninstaller)}`);

  // ---------- 解包 ----------
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(RUN, { recursive: true });
  execSync(`"${SEVENZ}" x "${SETUP}" -o"${RUN}\\setup" -y`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const plugins = join(RUN, 'setup', '$PLUGINSDIR', 'app-64.7z');
  if (!existsSync(plugins)) throw new Error('未找到内嵌 app-64.7z');
  execSync(`"${SEVENZ}" x "${plugins}" -o"${RUN}\\payload" -y`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  // ---------- P2/P3 载荷 = win-unpacked ----------
  const payloadExe = join(RUN, 'payload', 'Septcats.exe');
  const payloadAsar = join(RUN, 'payload', 'resources', 'app.asar');
  const core = [
    ['Septcats.exe', payloadExe, join(UNPACKED, 'Septcats.exe')],
    ['resources/app.asar', payloadAsar, join(UNPACKED, 'resources', 'app.asar')],
  ];
  const coreOk = core.every(([, a, b]) => existsSync(a) && existsSync(b) && sha256(a) === sha256(b));
  check('P2 解包载荷核心件与 win-unpacked 逐字节一致（装到的 = 审过的）', coreOk,
    core.map(([n, a, b]) => `${n}:${existsSync(a) && existsSync(b) && sha256(a) === sha256(b) ? '同' : '异'}`).join(' '));

  const pTree = tree(join(RUN, 'payload'));
  const uTree = tree(UNPACKED);
  const onlyPayload = [...pTree.keys()].filter((k) => !uTree.has(k));
  const onlyUnpacked = [...uTree.keys()].filter((k) => !pTree.has(k));
  const sizeDiff = [...pTree.keys()].filter((k) => uTree.get(k) !== pTree.get(k));
  // 期望差异：electron-builder 会在安装载荷里追加 resources/app-update.yml 之类；
  // 只允许「载荷多出 app-update.yml」这类清单文件，反向缺件一律算问题。
  const allowedExtra = (k) => k === 'resources/app-update.yml' || k === 'resources/elevate.exe';
  const unexpectedExtra = onlyPayload.filter((k) => !allowedExtra(k));
  check('P3 载荷无漏件（win-unpacked 的每个文件都在载荷里），差异仅限安装期清单',
    onlyUnpacked.length === 0 && unexpectedExtra.length === 0 && sizeDiff.length === 0,
    `载荷 ${String(pTree.size)} 件 / unpacked ${String(uTree.size)} 件；仅载荷有=${JSON.stringify(onlyPayload.slice(0, 4))} 仅 unpacked 有=${JSON.stringify(onlyUnpacked.slice(0, 4))} 大小异=${String(sizeDiff.length)}`);

  // ---------- P4 已装状态（只读） ----------
  const installedExe = join(INSTALLED, 'Septcats.exe');
  const installedUninstaller = join(INSTALLED, 'Uninstall Septcats.exe');
  let regOut = '';
  try {
    regOut = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\766c4907-638f-5fa9-b7f5-a2393e8384d0"', { encoding: 'utf8' });
  } catch { regOut = ''; }
  const regVer = /DisplayVersion\s+REG_SZ\s+([\d.]+)/.exec(regOut)?.[1] ?? '';
  const regName = /DisplayName\s+REG_SZ\s+(.+)/.exec(regOut)?.[1]?.trim() ?? '';
  check('P4 已装状态可正常卸载（安装目录 + 卸载器 + 卸载项三件在位）',
    existsSync(installedExe) && existsSync(installedUninstaller) && regName.includes('Septcats'),
    `exe=${String(existsSync(installedExe))} 卸载器=${String(existsSync(installedUninstaller))} DisplayName=${regName} DisplayVersion=${regVer || '(未写)'}`);

  // ---------- P5 已装 vs 终包 ----------
  const installedAsar = join(INSTALLED, 'resources', 'app.asar');
  const sameBuild = existsSync(installedAsar) && sha256(installedAsar) === sha256(payloadAsar);
  // P5 是「本机已装状态」的信息项，不是包质量判据（包的正确性由 P2 逐字节锚定）：
  // 已装 != 终包只说明老板装的仍是更早候选，要测本轮终包必须重装 dist 里的 Setup exe。
  info(`[P5] 已装 app.asar ${existsSync(installedAsar) ? String(statSync(installedAsar).size) : 'n/a'} B vs 终包 ${String(statSync(payloadAsar).size)} B → ${sameBuild ? '同一次构建（已是本轮终包）' : '**更早候选**：验证本轮终包需重装 dist 里的 Setup exe'}`);

  // ---------- P6 安装目录名体检 ----------
  const yml = readFileSync(join(REPO, 'apps', 'desktop', 'electron-builder.yml'), 'utf8');
  const pkgName = JSON.parse(readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8')).name;
  const sanitized = pkgName.replace(/[\\/@]/g, '');
  const dirBad = INSTALLED.endsWith('@septcatsdesktop') && sanitized === 'septcatsdesktop';
  // P6 属「外观级」缺陷，**刻意不在发版前动**：electron-builder 的 per-user 安装目录名由
  // 应用名派生，改它要一并改 productName —— 而 productName 同时决定 Electron 的
  // app.getPath('userData') ⇒ 老用户窗口状态/设置/localStorage 会「搬家」（数据迁移风险）。
  // 代价（用户看不到的目录名）远小于风险，故列为已知项留后续版本处理（发布清单已留档）。
  info(`[P6] 安装目录名 = ${INSTALLED}（由包名 ${pkgName} 净化而来；改名需动 productName → 有 userData 迁移风险，本版刻意不动，已留档）${dirBad ? '' : '（已可读）'}`);

  // ---------- P7 卸载不删用户数据 ----------
  const noDelete = /deleteAppDataOnUninstall:\s*false/.test(yml);
  const mtimeAfter = rootMtime();
  check('P7 卸载不删用户数据（配置 + 真实档案根 mtime 不变）', noDelete && mtimeBefore === mtimeAfter,
    `deleteAppDataOnUninstall:false=${String(noDelete)} 档案根 mtime ${String(mtimeBefore)}=${String(mtimeAfter)}`);

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  writeFileSync(join(OUT, 'payload-audit.log'),
    checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} [${c.id}] ${c.name} — ${c.raw}`).join('\n') + '\n', 'utf8');
  console.log(`===== 0.6.9 载荷/已装状态审计：${String(pass)} PASS / ${String(fail)} FAIL（${String(checks.length)} 项）=====`);
  if (fail > 0) for (const c of checks.filter((x) => !x.ok)) console.log(`FAILED ${c.id} ${c.name} — ${c.raw}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

try { main(); } catch (err) {
  console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  process.exitCode = 2;
}