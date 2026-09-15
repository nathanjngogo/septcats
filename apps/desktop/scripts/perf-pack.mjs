#!/usr/bin/env node
/**
 * perf-pack.mjs —— 打包态真机性能测量 + 安装包体积扫描（TASK-T14-01 §2，PM 在真机执行）。
 *
 *   node scripts/perf-pack.mjs                # 全量：启动打点 + 内存采样 + 安装包扫描
 *   node scripts/perf-pack.mjs --scan-only    # 只做安装包体积扫描（不需要打包 exe 可跑）
 *   node scripts/perf-pack.mjs --exe <path>   # 显式指定待测 exe（默认 dist/win-unpacked/Septcats.exe）
 *
 * 纯 node stdlib + powershell 子进程（WorkingSet 采样），无第三方依赖。
 * 测量项（docs/PROJECT_PLAN.md §9.2）：
 *  - 冷启动 ≤1.5s：spawn exe（带 --perf-trace），收 stdout `[perf] startup_ms=`（main 侧
 *    whenReady→首窗 did-finish-load 差值，同时落 userData/perf-startup.json）；
 *  - 内存常驻 ≤350MB：运行稳定后按 2s 间隔 powershell 采样全部 Septcats 进程的
 *    WorkingSet64 之和 ×3，取中位数；
 *  - 安装包 ≤90MB：扫描 dist/ 根的安装器（*.exe；win-unpacked/ 与 blockmap 不在内）。
 * 全部结果追加 docs/perf-history.jsonl + 终端表格；超预算红牌列出，不放宽断言。
 * 注意：应用有单实例锁——测量前先退出正在运行的 Septcats，否则 exe 会立刻退出。
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

const args = process.argv.slice(2);
const SCAN_ONLY = args.includes('--scan-only');
const exeArgIndex = args.indexOf('--exe');
const EXE_PATH = exeArgIndex >= 0 && args[exeArgIndex + 1] !== undefined
  ? resolve(args[exeArgIndex + 1])
  : join(DIST_DIR, 'win-unpacked', 'Septcats.exe');

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

/** powershell 采样：全部 Septcats 进程 WorkingSet64 之和（MB）。失败返回 null。 */
function sampleWorkingSetMb() {
  const script =
    "(Get-Process -Name 'Septcats' -ErrorAction SilentlyContinue | " +
    'Measure-Object -Property WorkingSet64 -Sum).Sum';
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }
  const bytes = Number(result.stdout.trim());
  return Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 / 1024 : null;
}

// --- 1. 冷启动 + 内存采样 ------------------------------------------------------

async function measureRuntime() {
  if (!existsSync(EXE_PATH)) {
    return { error: `找不到打包 exe：${EXE_PATH}（先跑 pnpm -C apps/desktop dist）` };
  }
  const child = spawn(EXE_PATH, ['--perf-trace'], {
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

  // stdout 被 GUI 子系统吞掉时，读 userData/perf-startup.json 兜底（默认 %APPDATA%/Septcats）
  if (startupMs === null && process.env.APPDATA !== undefined) {
    const fallbackPath = join(process.env.APPDATA, 'Septcats', 'perf-startup.json');
    if (existsSync(fallbackPath)) {
      try {
        const payload = JSON.parse(readFileSync(fallbackPath, 'utf8'));
        if (typeof payload.startup_ms === 'number') {
          startupMs = payload.startup_ms;
        }
      } catch { /* 兜底失败按无数据处理 */ }
    }
  }

  // 稳定 2s 后开始内存采样（渲染器/DbServer 已就绪）
  await new Promise((r) => setTimeout(r, MEM_SAMPLE_INTERVAL_MS));
  const memSamples = [];
  for (let i = 0; i < MEM_SAMPLES; i += 1) {
    const mb = sampleWorkingSetMb();
    if (mb !== null) {
      memSamples.push(mb);
    }
    if (i < MEM_SAMPLES - 1) {
      await new Promise((r) => setTimeout(r, MEM_SAMPLE_INTERVAL_MS));
    }
  }
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15_000 });
  return { startupMs, memSamples };
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
    rows.push({ metric: 'memory_workingset', display: runtime.error, value: null, unit: 'MB', budget: BUDGET_MEMORY_MB, pass: false });
  } else {
    rows.push({
      metric: 'pack_startup',
      display: runtime.startupMs !== null
        ? `${runtime.startupMs.toFixed(1)} ms`
        : `超时未收到 [perf] startup_ms=（确认先退出运行中的 Septcats）`,
      value_ms: runtime.startupMs,
      budget_ms: BUDGET_STARTUP_MS,
      pass: runtime.startupMs !== null && runtime.startupMs <= BUDGET_STARTUP_MS,
    });
    const memMedian = runtime.memSamples.length > 0 ? median(runtime.memSamples) : null;
    rows.push({
      metric: 'memory_workingset',
      display: memMedian !== null
        ? `中位 ${memMedian.toFixed(1)} MB（${runtime.memSamples.map((s) => s.toFixed(0)).join('/')} MB ×${MEM_SAMPLES}）`
        : 'powershell 采样失败',
      value: memMedian !== null ? Number(memMedian.toFixed(1)) : null,
      unit: 'MB',
      budget: BUDGET_MEMORY_MB,
      pass: memMedian !== null && memMedian <= BUDGET_MEMORY_MB,
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
}

// --- 台账 + 终端表格 -----------------------------------------------------------

for (const { display, ...recordFields } of rows) {
  record(recordFields);
  const budgetText = `${recordFields.budget_ms ?? recordFields.budget}${recordFields.unit ?? 'ms'}`;
  console.log(`| ${recordFields.metric} | ${display} | 预算 ${budgetText} | ${recordFields.pass ? '绿' : '红'} |`);
}

const failed = rows.filter((row) => !row.pass);
console.log('');
console.log(`perf-pack 完成：${rows.length - failed.length}/${rows.length} 绿（明细已追加 ${HISTORY_PATH}）`);
if (failed.length > 0) {
  for (const row of failed) {
    console.error(`红牌：${row.metric} 超预算（${rows.find((r) => r.metric === row.metric)?.display ?? ''}）`);
  }
  process.exit(1);
}
