/*
 * cdp-e2e-t55-02-packed.mjs —— 装包态托盘图标解析取证（rc.2 冒烟清单 D-1 收口项）。
 * 与 cdp-e2e-t55-02.mjs 的差别：**跑 dist/win-unpacked/Septcats.exe（安装包解压态），
 * 不跑 out/**。验证 iconAssets.ts 的打包态首选位（<resources>/build/）在真包里被命中，
 * 而不是 dev 目录。断言落 docs/mockups/screens-t55/t55-02-packed-results.json。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const EXE = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
if (!existsSync(EXE)) { console.error('FATAL: 打包产物不存在', EXE); process.exit(2); }
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t55-packed';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const INSPECT = 9237;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t55');
const OUT_JSON = join(SHOTS, 't55-02-packed-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (p) => String(p ?? '').split('\\').join('/');
const results = [];
function check(name, ok, raw) { results.push({ name, ok: ok === true, raw: String(raw).slice(0, 600) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${String(raw).slice(0, 300)}`); }
function info(name, raw) { results.push({ name, ok: null, raw: String(raw).slice(0, 600) }); console.log(`INFO ${name} :: ${String(raw).slice(0, 300)}`); }
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

let ws = null; let msgId = 0; const pending = new Map();
async function connectInspector() {
  let target = null;
  for (let i = 0; i < 50 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(INSPECT)}/json/list`)).json();
      target = list.find((t) => t.webSocketDebuggerUrl) ?? null;
    } catch { await wait(600); }
  }
  if (!target) throw new Error('main inspector 未就绪');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  await send('Runtime.enable');
  return target.title;
}
function send(method, params = {}) {
  return new Promise((res, rej) => { msgId += 1; pending.set(msgId, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: msgId, method, params })); });
}
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 400) };
  return { value: r.result?.value };
}

async function main() {
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(
    `${UD}\\septcats.settings.json`,
    JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypted: false, relay: '' } }, null, 2),
    'utf8',
  );
  writeFileSync(join(ROOT, 'layout.root'), ROOT);
  for (const pid of listeningPids(INSPECT)) killTree(pid);
  console.log('启动装包 exe:', EXE);
  const child = spawn(EXE, [`--user-data-dir=${UD}`, `--inspect=${String(INSPECT)}`], { detached: false, stdio: 'ignore' });
  try {
    info('inspector', await connectInspector());
    const r = await mainEval(`(() => {
      const fs = require('fs');
      const { app } = require('electron');
      const keys = Object.keys(require.cache);
      const hit = keys.find((k) => k.split('\\\\').join('/').endsWith('/out/main/index.js'));
      const mods = hit ? require.cache[hit].exports : null;
      if (!mods || !mods.t55Probe) return JSON.stringify({ probe: false, asar: app.isPackaged, resources: process.resourcesPath });
      const t = mods.t55Probe.trayIconPath();
      const w = mods.t55Probe.windowIconPath();
      return JSON.stringify({
        probe: true, asar: app.isPackaged, resources: process.resourcesPath,
        trayIcon: t, trayExists: t === null ? false : fs.existsSync(t),
        windowIcon: w, windowExists: w === null ? false : fs.existsSync(w),
        candidates: mods.t55Probe.iconCandidates(),
      });
    })()`);
    const d = JSON.parse(r.value ?? 'null');
    check('P0 probe 可达（装包 main 模块缓存）', d && d.probe === true, r.value ?? r.err);
    if (d && d.probe) {
      check('P1 解析路径在装包 resources 下（非 dev 目录）', norm(d.trayIcon).startsWith(norm(d.resources)) && norm(d.trayIcon).endsWith('/build/icon-tray.png'), d.trayIcon);
      check('P2 文件真实存在', d.trayExists === true, String(d.trayExists));
      check('P3 窗口图标=装包 resources/build/icon.png', norm(d.windowIcon).endsWith('/build/icon.png') && d.windowExists === true, d.windowIcon);
      info('candidates 原文', JSON.stringify(d.candidates ?? null));
      // iconCandidates() 返回 {tray:[...],window:[...]}（对象非数组）
      const cands = Array.isArray(d.candidates) ? d.candidates.map(norm)
        : ((d.candidates && Array.isArray(d.candidates.tray)) ? d.candidates.tray.map(norm) : []);
      const trayIdx = cands.findIndex((p) => p.endsWith('/build/icon-tray.png'));
      const icoIdx = cands.findIndex((p) => p.endsWith('/build/icon.ico'));
      check('P4 候选序列托盘先于 ico（名字优先）', trayIdx >= 0 && (icoIdx === -1 || trayIdx < icoIdx), `tray@${trayIdx} ico@${icoIdx}`);
    }
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    killTree(child.pid);
    await wait(1500);
    let n = 0;
    try { n = parseInt(execSync('powershell -NoProfile -Command "(Get-Process Septcats -ErrorAction SilentlyContinue|Measure-Object).Count"', { encoding: 'utf8' }).trim(), 10); } catch { /* noop */ }
    check('P99 退出后装包进程清零', n === 0, `Septcats 进程数=${n}`);
    const realTouched = existsSync(join(REAL_ROOT, 'septcats.db')) && Date.now() - (await import('node:fs')).statSync(join(REAL_ROOT, 'septcats.db')).mtimeMs < 60000;
    check('P98 真实档案未被写', !realTouched, `realRoot=${REAL_ROOT} dbMtimeFresh=${realTouched}`);
    results.push({ task: 'T55-02 装包态托盘图标取证', ranAt: new Date().toISOString(), exe: EXE });
    writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
    const pass = results.filter((x) => x.ok === true).length, fail = results.filter((x) => x.ok === false).length;
    console.log(`===== T55-packed：${pass} PASS / ${fail} FAIL =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => { console.error('FATAL', e); writeFileSync(OUT_JSON, JSON.stringify({ partial: true, error: String(e), assertions: results }, null, 2)); process.exit(3); });
