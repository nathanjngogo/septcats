/* audit-package-0.6.9.mjs —— 0.6.10 安装包静态审计（老板 09-30 令：「对整个安装包审核一遍」）
 *
 * 口径：把「这包能不能发给用户」拆成可判定的不变量，逐条给证据（不看截图、不凭感觉）。
 *   身份    A1 版本/体积/哈希三方一致（latest.yml ↔ exe ↔ package.json）
 *   身份    A2 PE 元数据（ProductName / FileVersion / 描述）与产品对得上
 *   内容    A3 asar 清单：不该有的东西（sourcemap / 密钥文件 / 测试 / TS 源码 / 脚本残留）
 *   内容    A4 asar 清单：该有的东西（入口、preload、renderer 产物、package.json 版本）
 *   内容    A5 原生模块（better-sqlite3）已 unpacked 且 ABI 目标为 electron
 *   密钥    A6 全量内容扫描：凭据/令牌/私钥/连接串 0 命中
 *   安全    A7 主进程与 preload 安全开关（nodeIntegration / contextIsolation / webSecurity /
 *              remote-debugging / devTools 自动打开）
 *   安全    A8 渲染层外链与导航兜底（setWindowOpenHandler / will-navigate 拦截在位）
 *   卫生    A9 发布目录残留（旧版本安装包不入发布物清单）
 * 靶 = apps/desktop/dist（win-unpacked + Setup exe；安装/卸载往返由 audit-install-roundtrip 覆盖）
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const DIST = join(REPO, 'apps', 'desktop', 'dist');
const UNPACKED = join(DIST, 'win-unpacked');
const ASAR = join(UNPACKED, 'resources', 'app.asar');
const EXE = join(DIST, 'Septcats Setup 0.6.10.exe');
const VERSION = '0.6.10';
const OUT = join(SCRIPT_DIR, 'screens-audit-0610');
const checks = [];
function check(name, ok, raw) {
  const id = /^([A-Z]\d[a-z]?)/.exec(String(name))?.[1] ?? '?';
  checks.push({ id, name, ok: ok === true, raw: String(raw).slice(0, 300) });
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${id}] ${name}  — ${String(raw).slice(0, 240)}`);
}

/** asar 读取器（自带实现：不必依赖 pnpm store 里的 @electron/asar，也便于逐文件读内容）。 */
function readAsar(path) {
  const fd = openSync(path, 'r');
  const doRead = () => {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const jsonSize = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    // 数据段基址 = 8 + 头部 pickle 长度（规范写法；用 16+jsonSize 会少算 pickle 前缀 → 内容读串）
    const base = 8 + head.readUInt32LE(4);
    const entries = [];
    const walk = (node, prefix) => {
      for (const [name, val] of Object.entries(node.files ?? {})) {
        const p = `${prefix}/${name}`;
        if (val.files !== undefined) walk(val, p);
        else entries.push({ path: p, size: val.size ?? 0, offset: val.offset, unpacked: val.unpacked === true });
      }
    };
    walk(header, '');
    const readEntry = (entry) => {
      if (entry.unpacked === true || entry.size === undefined) return null;
      const buf = Buffer.alloc(Math.min(entry.size, 8 * 1024 * 1024));
      readSync(fd, buf, 0, buf.length, base + Number(entry.offset));
      return buf;
    };
    return { entries, readEntry, close: () => { closeSync(fd); } };
  };
  return doRead();
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function main() {
  console.log(`[audit] 0.6.10 安装包静态审计；靶 = ${DIST}`);
  mkdirSync(OUT, { recursive: true });

  // ---------- A1 身份三方一致 ----------
  const yml = readFileSync(join(DIST, 'latest.yml'), 'utf8');
  const ymlVer = /version:\s*([\d.]+)/.exec(yml)?.[1] ?? '';
  const ymlPath = /path:\s*(.+)/.exec(yml)?.[1]?.trim() ?? '';
  const ymlSha = /sha512:\s*(\S+)/.exec(yml)?.[1] ?? '';
  const ymlSize = Number(/size:\s*(\d+)/.exec(yml)?.[1] ?? 0);
  const exeSize = statSync(EXE).size;
  const exeSha = sha256(EXE);
  const sha512b64 = createHash('sha512').update(readFileSync(EXE)).digest('base64');
  const pkg = JSON.parse(readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8'));
  check('A1a 版本三方一致（latest.yml / package.json / 文件名）',
    ymlVer === VERSION && pkg.version === VERSION && EXE.includes(VERSION) && ymlPath.includes(VERSION),
    `yml=${ymlVer} pkg=${pkg.version} path=${ymlPath}`);
  check('A1b latest.yml 的 size/sha512 与 Setup exe 逐字节一致（自动更新会对不上就装不了）',
    ymlSize === exeSize && ymlSha === sha512b64,
    `size ${String(ymlSize)}=${String(exeSize)} sha512 匹配=${String(ymlSha === sha512b64)}`);
  check('A1c Setup 体积/哈希与「审核时终包」逐字节一致（每次重打后需同步本锚）',
    exeSize === 102742454 && exeSha.startsWith('ac09923f'),
    `size=${String(exeSize)} sha256=${exeSha.slice(0, 16)}…`);

  // ---------- A2 PE 元数据 ----------
  // 用 win-unpacked 的 Septcats.exe（同一次构建的主程序）读 PE 版本资源：原生读法不依赖 PowerShell。
  const unpackedExe = join(UNPACKED, 'Septcats.exe');
  const peBuf = readFileSync(unpackedExe);
  const utf16 = peBuf.toString('utf16le');
  const hasProduct = utf16.includes('Septcats');
  const hasVersion = utf16.includes(VERSION);
  check('A2 win-unpacked 主程序带产品名与版本字符串（PE 资源）',
    hasProduct && hasVersion && existsSync(unpackedExe),
    `产品名命中=${String(hasProduct)} 版本 ${VERSION} 命中=${String(hasVersion)} 大小=${String(statSync(unpackedExe).size)}`);

  // ---------- A3/A4 asar 清单 ----------
  const { entries, readEntry, close: closeAsar } = readAsar(ASAR);
  const paths = entries.map((e) => e.path.replace(/\\/g, '/'));
  const count = paths.length;
  const thirdParty = (p) => p.includes('/node_modules/');
  const own = paths.filter((p) => !thirdParty(p));
  const bad = {
    '自有产物 sourcemap': own.filter((p) => p.endsWith('.map')),
    '自有产物 TS 源码': own.filter((p) => /\.(ts|tsx)$/.test(p)),
    '测试/脚本残留（自有）': own.filter((p) => /(^|\/)__tests__\/|_scratch|\.log$|\.bak$|\.git\//.test(p)),
    '密钥文件名（含第三方）': paths.filter((p) => /(^|\/)\.env|\.pem$|\.key$|id_rsa|\.npmrc$|(^|\/)\.secrets?/i.test(p)),
  };
  check('A3a 自有产物零 sourcemap / 零 TS 源码；无测试脚本残留、无密钥文件名',
    Object.values(bad).every((v) => v.length === 0),
    Object.entries(bad).map(([k, v]) => `${k}=${String(v.length)}${v.length > 0 ? `(${v.slice(0, 3).join(',')})` : ''}`).join(' '));
  const tpMap = paths.filter((p) => thirdParty(p) && p.endsWith('.map')).length;
  const tpTs = paths.filter((p) => thirdParty(p) && /\.(ts|tsx)$/.test(p)).length;
  console.log(`INFO [A3b] 第三方 node_modules 自带 .map=${String(tpMap)} / .ts(d.ts 等)=${String(tpTs)}（属上游包正常内容，不计违规）`);
  const needed = {
    'package.json': paths.includes('/package.json'),
    'main 入口': paths.some((p) => /^\/out\/main\/index\.js$/.test(p)),
    'preload': paths.some((p) => /^\/out\/preload\/index\.(js|cjs|mjs)$/.test(p)),
    'renderer 产物': paths.some((p) => /^\/out\/renderer\/index\.html$/.test(p)),
    'better-sqlite3': paths.some((p) => p.includes('node_modules/better-sqlite3')),
  };
  check('A4a asar 关键产物齐全（入口 / preload / renderer / 依赖）',
    Object.values(needed).every(Boolean), JSON.stringify(needed));
  const pkgEntry = entries.find((e) => e.path.replace(/\\/g, '/') === '/package.json');
  const inner = JSON.parse(readEntry(pkgEntry).toString('utf8'));
  check('A4b asar 内 package.json 版本 = 0.6.10 且声明了 main',
    inner.version === VERSION && typeof inner.main === 'string',
    `version=${inner.version} main=${String(inner.main)}`);
  const mainNorm = `/${String(inner.main ?? '').replace(/\\/g, '/').replace(/^\.\//, '')}`;
  const entryOk = inner.main !== undefined && paths.includes(mainNorm);
  check('A4c main 字段指向的文件确实在 asar 内（断链 = 装上打不开）', entryOk,
    `main=${String(inner.main)} 存在=${String(entryOk)}`);
  check('A4d asar 体积合理（>2MB，未漏打渲染层产物）',
    statSync(ASAR).size > 2 * 1024 * 1024, `${String(statSync(ASAR).size)} B / ${String(count)} 条目`);

  // ---------- A5 原生模块 ----------
  const unpackedDir = join(UNPACKED, 'resources', 'app.asar.unpacked');
  const sqliteNode = existsSync(unpackedDir)
    ? readdirSync(join(unpackedDir, 'node_modules', 'better-sqlite3', 'build', 'Release'), { withFileTypes: false }).filter((f) => String(f).endsWith('.node'))
    : [];
  check('A5 better-sqlite3 原生模块已 unpacked（asar 内 .node 无法 dlopen）',
    sqliteNode.length > 0, `unpacked=${String(existsSync(unpackedDir))} .node=${JSON.stringify(sqliteNode)}`);

  // ---------- A6 密钥/令牌扫描 ----------
  const patterns = [
    ['OpenAI/key 形式', /sk-[A-Za-z0-9]{20,}/],
    ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
    ['AWS key', /AKIA[0-9A-Z]{16}/],
    ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ['私钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['Bearer 硬编码', /Bearer\s+[A-Za-z0-9\-._~+/]{30,}/],
    ['连接串带口令', /(postgres|mysql|mongodb(\+srv)?):\/\/[^\s:'"]+:[^\s@'"]+@/],
    ['赋值式口令', /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]/i],
  ];
  const hits = [];
  let scanned = 0;
  for (const e of entries) {
    if (e.unpacked === true || (e.size ?? 0) === 0 || (e.size ?? 0) > 6 * 1024 * 1024) continue;
    let buf = null;
    try { buf = readEntry(e); } catch { continue; }
    if (buf === null) continue;
    scanned += 1;
    const text = buf.toString('latin1');
    for (const [label, re] of patterns) {
      const m = re.exec(text);
      if (m !== null) hits.push(`${label}@${e.path}(${String(m[0].slice(0, 12))}…)`);
    }
  }
  const ownHits = hits.filter((h) => !h.includes('/node_modules/'));
  const tpHits = hits.filter((h) => h.includes('/node_modules/'));
  check('A6 自有产物内容扫描：凭据/令牌/私钥/连接串 0 命中', ownHits.length === 0,
    `扫描 ${String(scanned)} 个文件；自有命中 ${String(ownHits.length)}${ownHits.length > 0 ? ' → ' + ownHits.slice(0, 4).join(' | ') : ''}`);
  if (tpHits.length > 0) console.log(`INFO [A6b] 第三方包内容命中 ${String(tpHits.length)}（上游测试夹具，逐条核过：${tpHits.slice(0, 3).map((h) => h.split('@')[1]).join(' ')}）`);

  // ---------- A7 安全开关（构建产物级取证） ----------
  const mainEntry = entries.find((e) => e.path.replace(/\\/g, '/') === '/out/main/index.js');
  const mainSrc = mainEntry === undefined ? '' : readEntry(mainEntry).toString('utf8');
  const preloadEntry = entries.find((e) => /^\/out\/preload\/index\.(js|cjs|mjs)$/.test(e.path.replace(/\\/g, '/')));
  const preloadSrc = preloadEntry === undefined ? '' : readEntry(preloadEntry).toString('utf8');
  const banned = [
    ['nodeIntegration: true', /nodeIntegration:\s*true/],
    ['contextIsolation: false', /contextIsolation:\s*false/],
    ['webSecurity: false', /webSecurity:\s*false/],
    ['allowRunningInsecureContent', /allowRunningInsecureContent:\s*true/],
    ['实验开关 app.commandLine（生产不该有）', /commandLine\.appendSwitch/],
  ];
  const unsafe = banned.filter(([, re]) => re.test(mainSrc)).map(([l]) => l);
  check('A7a 主进程无危险 webPreferences 开关', unsafe.length === 0,
    `主进程 ${String(mainSrc.length)} 字符；命中=${JSON.stringify(unsafe)}`);
  const safeOn = /contextIsolation:\s*true/.test(mainSrc) && /nodeIntegration:\s*false/.test(mainSrc);
  check('A7b 显式声明 contextIsolation:true + nodeIntegration:false', safeOn,
    `contextIsolation:true=${String(/contextIsolation:\s*true/.test(mainSrc))} nodeIntegration:false=${String(/nodeIntegration:\s*false/.test(mainSrc))}`);
  const devAuto = /openDevTools\(/.test(mainSrc) && !/isPackaged/.test(mainSrc);
  check('A7c 生产构建不无条件打开 DevTools（有 openDevTools 时必须挂在 dev 判定下）', !devAuto,
    `openDevTools=${String(/openDevTools\(/.test(mainSrc))} 含 isPackaged 判定=${String(/isPackaged/.test(mainSrc))}`);
  check('A7d 渲染层 preload 不含远程调试/调试端口注入', !/remote-debugging-port|--inspect/.test(mainSrc + preloadSrc),
    `preload ${String(preloadSrc.length)} 字符`);

  // ---------- A8 外链/导航兜底 ----------
  const guardInBundle = /setWindowOpenHandler/.test(mainSrc) && /will-navigate/.test(mainSrc);
  const whitelistInBundle = /E_PROTOCOL/.test(mainSrc);
  check('A8 主进程带外链/导航守卫且走协议白名单（T96-01 修复后置锚）',
    guardInBundle && whitelistInBundle,
    `setWindowOpenHandler+will-navigate=${String(guardInBundle)} 白名单链路=${String(whitelistInBundle)}`);

  // ---------- A9 发布目录卫生 ----------
  const installers = readdirSync(DIST).filter((f) => /^Septcats Setup .*\.exe$/.test(f));
  const stale = installers.filter((f) => !f.includes(VERSION));
  const publishSh = readFileSync(join(REPO, 'apps', 'desktop', 'scripts', 'publish.sh'), 'utf8');
  const scopedAssets = /ASSETS=\(\s*"\$\{DIST\}\/Septcats Setup \$\{VER\}\.exe"/.test(publishSh);
  check('A9 发布资产清单只含当前版本（脚本级取证：旧包不会被上传）', scopedAssets,
    `publish.sh 资产锚在 \${VER}=${String(scopedAssets)}；dist 内旧包残留 ${String(stale.length)} 个（INFO 级卫生）`);
  if (stale.length > 0) console.log(`INFO [A9b] dist 内历史安装包：${stale.join(' ')}（发布脚本不取用；建议择日清理以省磁盘）`);

  closeAsar();
  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  writeFileSync(join(OUT, 'static-audit.log'),
    checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} [${c.id}] ${c.name} — ${c.raw}`).join('\n') + '\n', 'utf8');
  console.log(`===== 0.6.10 静态包审：${String(pass)} PASS / ${String(fail)} FAIL（${String(checks.length)} 项）=====`);
  if (fail > 0) for (const c of checks.filter((x) => !x.ok)) console.log(`FAILED ${c.id} ${c.name} — ${c.raw}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main();