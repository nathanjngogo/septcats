#!/usr/bin/env node
/**
 * perf-pack.mjs —— 打包态真机性能测量 + 安装包体积扫描（TASK-T14-01 §2 建，TASK-T16-01 扩展）。
 *
 *   node scripts/perf-pack.mjs                # 全量：启动打点 + 逐进程内存三时点 + 安装包扫描
 *   node scripts/perf-pack.mjs --scan-only    # 只做安装包体积扫描（不需要打包 exe 可跑）
 *   node scripts/perf-pack.mjs --exe <path>   # 显式指定待测 exe（默认 dist/win-unpacked/Septcats.exe）
 *   node scripts/perf-pack.mjs --resample     # 追加第三时点（再静置 60s 后复采样）
 *   node scripts/perf-pack.mjs --baseline <exe> # 同法测另一个 Electron 应用做口径对照（可选，不联网下载）
 *
 * 纯 node stdlib + powershell 子进程（逐进程 WorkingSet/PrivateWorkingSet 采样），无第三方依赖。
 * 测量项（docs/PROJECT_PLAN.md §9.2 + TASK-T16-01 §1-4）：
 *  - 冷启动 ≤1.5s：spawn exe（带 --perf-trace + 独立 --user-data-dir，避免与安装版 userData 冲突），
 *    收 stdout `[perf] startup_ms=`（main 侧 whenReady→首窗 did-finish-load 差值，同时落
 *    <user-data-dir>/perf-startup.json）；
 *  - 内存 ≤350MB：T16 起双口径并报——sum-of-WorkingSet 与 sum-of-PrivateWorkingSet 各一个数，
 *    按进程名逐进程拆（Get-Process Path 区分实例，不依赖 CommandLine——detached spawn 读回 null），
 *    三时点：稳态 / 静置 60s / 可选 --resample；两口径都进 perf-history.jsonl
 *    （metric = memory_workingset_sum / memory_private_sum）；
 *  - 安装包 ≤90MB：扫描 dist/ 根的安装器（*.exe；win-unpacked/ 与 blockmap 不在内）。
 * 全部结果追加 docs/perf-history.jsonl + 终端表格；超预算红牌列出，不放宽断言。
 * 注意：测量前脚本会先 taskkill 清掉正在运行的 Septcats（安装版与 unpacked 一起清），否则计数污染。
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const repoRoot = resolve(appDir, '..', '..');
const DIST_DIR = join(appDir, 'dist');
const HISTORY_PATH = join(repoRoot, 'docs', 'perf-history.jsonl');

const BUDGET_STARTUP_MS = 1500;
const BUDGET_MEMORY_MB = 350;
const BUDGET_INSTALLER_MB = 90;
const MEM_SAMPLES = 3;
const MEM_SAMPLE_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 60_000;
const IDLE_WAIT_MS = 60_000;
// 独立 userData：unpacked 与安装版并存时同 Roaming 路径会因 SQLite 独占锁起 8 秒后崩（PM 实测事实 #2）
const USER_DATA_DIR = join(tmpdir(), 'septcats-perf-userdata');

const args = process.argv.slice(2);
const SCAN_ONLY = args.includes('--scan-only');
const RESAMPLE = args.includes('--resample');
const exeArgIndex = args.indexOf('--exe');
const EXE_PATH = exeArgIndex >= 0 && args[exeArgIndex + 1] !== undefined
  ? resolve(args[exeArgIndex + 1])
  : join(DIST_DIR, 'win-unpacked', 'Septcats.exe');
const baselineArgIndex = args.indexOf('--baseline');
const BASELINE_EXE = baselineArgIndex >= 0 && args[baselineArgIndex + 1] !== undefined
  ? resolve(args[baselineArgIndex + 1])
  : null;

// --- 工具 -------------------------------------------------------------------

function gitRev() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : 'unknown';
}

function localDate() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 追加 perf-history.jsonl：ms 类指标 {metric,value_ms,budget_ms,pass}，其余 {metric,value,unit,budget,pass}。 */
function record(entry) {
  const { metric, ...rest } = entry;
  const line = JSON.stringify({ date: localDate(), git_rev: gitRev(), metric, ...rest });
  appendFileSync(HISTORY_PATH, `${line}\n`, 'utf8');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killSeptcats() {
  spawnSync('taskkill', ['/F', '/IM', 'Septcats.exe', '/T'], { timeout: 15_000 });
}

/** powershell 逐进程采样：按进程名取 WorkingSet64 + WorkingSetPrivate（私有工作集）+ 父 PID + CommandLine。
 *  用 Get-Process 的 Path/属性过滤，不靠 CommandLine 判存在（detached spawn 读回 null，PM 实测事实 #1）。
 *  返回 [{pid,path,ws,pws,ppid,cmd}]，进程不存在返回 []。 */
function sampleProcessRows(procName) {
  const base = basename(procName).replace(/\.exe$/i, '');
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    `$procs=@(Get-Process -Name '${base}')`,
    `$cim=@(Get-CimInstance Win32_Process -Filter "Name='${base}.exe'")`,
    `$perf=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name LIKE '${base}%'")`,
    '$out=@()',
    'foreach($p in $procs){',
    '  $cid=$null; foreach($c in $cim){ if($c.ProcessId -eq $p.Id){ $cid=$c; break } }',
    '  $pf=$null; foreach($q in $perf){ if($q.IDProcess -eq $p.Id){ $pf=$q; break } }',
    '  $out+=[pscustomobject]@{ pid=[int]$p.Id; path=[string]$p.Path; ws=[int64]$p.WorkingSet64;',
    '    pws=$(if($pf){[int64]$pf.WorkingSetPrivate}else{[int64]0});',
    '    ppid=$(if($cid){[int]$cid.ParentProcessId}else{[int]0});',
    '    cmd=$(if($cid){[string]$cid.CommandLine}else{[string]\x27\x27}) }',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 3',
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }
  const text = result.stdout.trim();
  if (text.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

/** 给逐进程行标注启动角色（browser 主进程 = 父进程不在同组进程集；子进程按 CommandLine 标注，读不到则如实标注）。 */
function classifyRoles(rows) {
  const ids = new Set(rows.map((r) => Number(r.pid)));
  for (const row of rows) {
    const ppid = Number(row.ppid);
    if (ppid === 0 || !ids.has(ppid)) {
      row.role = 'browser(main)';
      continue;
    }
    const cmd = typeof row.cmd === 'string' ? row.cmd : '';
    if (cmd.includes('--type=renderer')) {
      row.role = 'renderer';
    } else if (cmd.includes('--type=gpu-process')) {
      row.role = 'gpu';
    } else if (cmd.includes('dbServer.js')) {
      row.role = 'utility:DbServer';
    } else if (cmd.includes('--type=utility')) {
      const sub = cmd.match(/--utility-sub-type=([\w.]+)/);
      row.role = sub !== null ? `utility:${sub[1]}` : 'utility';
    } else {
      row.role = 'child(cmd不可读)';
    }
  }
  return rows;
}

/** 一轮采样 = MEM_SAMPLES 次（间隔 2s），返回各口径和的样本数组 + 末次逐进程明细。 */
async function sampleRound(procName) {
  const wsSums = [];
  const pwsSums = [];
  let detail = [];
  for (let i = 0; i < MEM_SAMPLES; i += 1) {
    if (i > 0) {
      await sleep(MEM_SAMPLE_INTERVAL_MS);
    }
    const rows = sampleProcessRows(procName);
    if (rows === null || rows.length === 0) {
      continue;
    }
    const wsSum = rows.reduce((acc, r) => acc + Number(r.ws || 0), 0) / 1024 / 1024;
    const pwsSum = rows.reduce((acc, r) => acc + Number(r.pws || 0), 0) / 1024 / 1024;
    wsSums.push(wsSum);
    pwsSums.push(pwsSum);
    detail = classifyRoles(rows);
  }
  return { wsSums, pwsSums, detail };
}

function roundSummary(label, round) {
  if (round.wsSums.length === 0) {
    return `${label}：powershell 采样失败（无 Septcats 进程或 PS 出错）`;
  }
  return `${label}：sum-WS 中位 ${median(round.wsSums).toFixed(1)} MB（${round.wsSums.map((s) => s.toFixed(0)).join('/')}）｜` +
    `sum-Private 中位 ${median(round.pwsSums).toFixed(1)} MB（${round.pwsSums.map((s) => s.toFixed(0)).join('/')}）`;
}

function printProcessTable(title, rows) {
  console.log(`\n  [${title}]`);
  console.log('  PID       角色                  WorkingSet   PrivateWS  路径');
  for (const row of rows) {
    const ws = (Number(row.ws || 0) / 1024 / 1024).toFixed(1).padStart(8);
    const pws = (Number(row.pws || 0) / 1024 / 1024).toFixed(1).padStart(8);
    const path = typeof row.path === 'string' && row.path.length > 0 ? row.path : '(Path 不可读)';
    console.log(`  ${String(row.pid).padEnd(9)} ${String(row.role).padEnd(18)} ${ws} MB  ${pws} MB  ${path}`);
  }
  const wsSum = rows.reduce((acc, r) => acc + Number(r.ws || 0), 0) / 1024 / 1024;
  const pwsSum = rows.reduce((acc, r) => acc + Number(r.pws || 0), 0) / 1024 / 1024;
  console.log(`  合计 ${rows.length} 进程：sum-WS=${wsSum.toFixed(1)} MB｜sum-Private=${pwsSum.toFixed(1)} MB`);
}

// --- 1. 冷启动 + 逐进程内存采样（三时点） -------------------------------------

async function measureRuntime() {
  if (!existsSync(EXE_PATH)) {
    return { error: `找不到打包 exe：${EXE_PATH}（先跑 pnpm -C apps/desktop dist）` };
  }
  killSeptcats(); // PM 实测事实 #3：不清场则计数污染（安装版与 unpacked 一起清）
  await sleep(1000);
  const child = spawn(EXE_PATH, ['--perf-trace', `--user-data-dir=${USER_DATA_DIR}`], {
    cwd: dirname(EXE_PATH),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupMs = null;
  const startup = new Promise((resolveStartup) => {
    let stdout = '';
    const timer = setTimeout(() => resolveStartup(), STARTUP_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const match = stdout.match(/\[perf\] startup_ms=([\d.]+)/);
      if (match !== null) {
        clearTimeout(timer);
        resolveStartup(Number(match[1]));
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolveStartup();
    });
  });
  const resolved = await startup;
  startupMs = typeof resolved === 'number' ? resolved : null;

  // stdout 被 GUI 子系统吞掉时读 <user-data-dir>/perf-startup.json 兜底（旧路径 %APPDATA%/Septcats 最后兜底）
  if (startupMs === null) {
    const candidates = [
      join(USER_DATA_DIR, 'perf-startup.json'),
      process.env.APPDATA !== undefined ? join(process.env.APPDATA, 'Septcats', 'perf-startup.json') : null,
    ];
    for (const path of candidates) {
      if (path !== null && existsSync(path)) {
        try {
          const payload = JSON.parse(readFileSync(path, 'utf8'));
          if (typeof payload.startup_ms === 'number') {
            startupMs = payload.startup_ms;
            break;
          }
        } catch { /* 兜底失败按无数据处理 */ }
      }
    }
  }

  // 稳定 2s 后开始「稳态」三时点采样（渲染器/DbServer 已就绪）
  await sleep(MEM_SAMPLE_INTERVAL_MS);
  const steady = await sampleRound(basename(EXE_PATH));
  printProcessTable('时点1 稳态', steady.detail);

  await sleep(IDLE_WAIT_MS);
  const idle = await sampleRound(basename(EXE_PATH));
  printProcessTable('时点2 静置60s', idle.detail);

  let resample = null;
  if (RESAMPLE) {
    await sleep(IDLE_WAIT_MS);
    resample = await sampleRound(basename(EXE_PATH));
    printProcessTable('时点3 复采样（再静置60s）', resample.detail);
  }

  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15_000 });
  killSeptcats(); // 收尾清场，防止残留进程污染下一轮
  return { startupMs, steady, idle, resample };
}

// --- 1b. 可选：--baseline 同法测另一个 Electron 应用 -----------------------------

async function measureBaseline(exePath) {
  if (!existsSync(exePath)) {
    return { error: `找不到对照 exe：${exePath}` };
  }
  const name = basename(exePath);
  const child = spawn(exePath, [], { cwd: dirname(exePath), stdio: 'ignore' });
  await sleep(8000); // 等对照应用起稳（无 startup 打点，给固定 8s）
  const round = await sampleRound(name);
  printProcessTable(`baseline 对照：${name}`, round.detail);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15_000 });
  if (round.wsSums.length === 0) {
    return { error: `对照应用采样失败（${name}）` };
  }
  return { wsSum: median(round.wsSums), pwsSum: median(round.pwsSums) };
}

// --- 2. 安装包体积扫描 ---------------------------------------------------------

function scanInstallers() {
  if (!existsSync(DIST_DIR)) {
    return { error: `dist 目录不存在：${DIST_DIR}（先跑 pnpm -C apps/desktop dist）` };
  }
  const installers = readdirSync(DIST_DIR)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => ({ name, sizeMb: Number((statSync(join(DIST_DIR, name)).size / 1024 / 1024).toFixed(1)) }))
    .sort((a, b) => b.sizeMb - a.sizeMb);
  const offenders = installers.filter((item) => item.sizeMb > BUDGET_INSTALLER_MB);
  return { installers, offenders };
}

// --- 主流程 -------------------------------------------------------------------

const rows = [];

if (SCAN_ONLY) {
  const scan = scanInstallers();
  rows.push({
    metric: 'installer_size',
    display: scan.error ?? scan.installers.map((i) => `${i.name}=${i.sizeMb}MB`).join(', '),
    value: scan.installers?.[0]?.sizeMb ?? null,
    unit: 'MB',
    budget: BUDGET_INSTALLER_MB,
    pass: scan.error === undefined && scan.offenders.length === 0,
  });
} else {
  const runtime = await measureRuntime();
  if (runtime.error !== undefined) {
    rows.push({ metric: 'pack_startup', display: runtime.error, value_ms: null, budget_ms: BUDGET_STARTUP_MS, pass: false });
    rows.push({ metric: 'memory_workingset_sum', display: runtime.error, value: null, unit: 'MB', budget: BUDGET_MEMORY_MB, pass: false });
    rows.push({ metric: 'memory_private_sum', display: runtime.error, value: null, unit: 'MB', budget: BUDGET_MEMORY_MB, pass: false });
  } else {
    rows.push({
      metric: 'pack_startup',
      display: runtime.startupMs !== null
        ? `${runtime.startupMs.toFixed(1)} ms`
        : `超时未收到 [perf] startup_ms=（脚本已自动清场重试一轮）`,
      value_ms: runtime.startupMs,
      budget_ms: BUDGET_STARTUP_MS,
      pass: runtime.startupMs !== null && runtime.startupMs <= BUDGET_STARTUP_MS,
    });
    const wsMedian = runtime.steady.wsSums.length > 0 ? median(runtime.steady.wsSums) : null;
    const pwsMedian = runtime.steady.pwsSums.length > 0 ? median(runtime.steady.pwsSums) : null;
    rows.push({
      metric: 'memory_workingset_sum',
      display: `${roundSummary('稳态', runtime.steady)}；${roundSummary('静置60s', runtime.idle)}`,
      value: wsMedian !== null ? Number(wsMedian.toFixed(1)) : null,
      unit: 'MB',
      budget: BUDGET_MEMORY_MB,
      pass: wsMedian !== null && wsMedian <= BUDGET_MEMORY_MB,
    });
    rows.push({
      metric: 'memory_private_sum',
      display: pwsMedian !== null
        ? `稳态 sum-Private 中位 ${pwsMedian.toFixed(1)} MB（口径裁决依据见 TASK-T16-01-report）`
        : 'powershell 采样失败',
      value: pwsMedian !== null ? Number(pwsMedian.toFixed(1)) : null,
      unit: 'MB',
      budget: BUDGET_MEMORY_MB,
      pass: pwsMedian !== null && pwsMedian <= BUDGET_MEMORY_MB,
    });
  }
  const scan = scanInstallers();
  rows.push({
    metric: 'installer_size',
    display: scan.error ?? scan.installers.map((i) => `${i.name}=${i.sizeMb}MB`).join(', '),
    value: scan.installers?.[0]?.sizeMb ?? null,
    unit: 'MB',
    budget: BUDGET_INSTALLER_MB,
    pass: scan.error === undefined && scan.offenders.length === 0,
  });

  if (BASELINE_EXE !== null) {
    const baseline = await measureBaseline(BASELINE_EXE);
    rows.push({
      metric: `baseline_${basename(BASELINE_EXE)}_memory_workingset_sum`,
      display: baseline.error ?? `sum-WS=${baseline.wsSum.toFixed(1)} MB｜sum-Private=${baseline.pwsSum.toFixed(1)} MB（同机同法对照，不入台账）`,
      value: baseline.error ?? Number(baseline.wsSum.toFixed(1)),
      unit: 'MB',
      budget: null,
      pass: true,
    });
  }
}

// --- 台账 + 终端表格 -----------------------------------------------------------

for (const { display, ...recordFields } of rows) {
  if (recordFields.metric.startsWith('baseline_')) {
    console.log(`| ${recordFields.metric} | ${display} | 对照行（不入 perf-history） | - |`);
    continue;
  }
  record(recordFields);
  const budgetText = `${recordFields.budget_ms ?? recordFields.budget}${recordFields.unit ?? 'ms'}`;
  console.log(`| ${recordFields.metric} | ${display} | 预算 ${budgetText} | ${recordFields.pass ? '绿' : '红'} |`);
}

const failed = rows.filter((row) => !row.pass && !row.metric.startsWith('baseline_'));
console.log('');
console.log(`perf-pack 完成：${rows.length - failed.length - (BASELINE_EXE !== null ? 1 : 0)}/${rows.length - (BASELINE_EXE !== null ? 1 : 0)} 绿（明细已追加 ${HISTORY_PATH}）`);
if (failed.length > 0) {
  for (const row of failed) {
    console.error(`红牌：${row.metric} 超预算（${rows.find((r) => r.metric === row.metric)?.display ?? ''}）`);
  }
  process.exit(1);
}
