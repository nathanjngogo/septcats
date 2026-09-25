/**
 * perf.test.ts —— G4 §9.2 硬指标的可 vitest 化四项（TASK-T14-01 §1）。
 *
 * 指标与预算（docs/PROJECT_PLAN.md §9.2，vitest 可测的四项）：
 * 1. 冷进程打开 1 万页真库 → 第一次搜索查询 ≤150ms（搜索红线覆盖冷态；热态 P95 在 search.test.ts）；
 * 2. 1 万字页（200 块）commitOps batch 落库 P95 ≤16ms（输入延迟的提交路径等价物）；
 * 3. 1 万页账本 rebuildFromSegments 全量重建 <5000ms（预算 PM 定，测出基线）；
 * 4. 1 万页库冷打开 + migrate + 首查 <800ms（首屏预算的 DB 段）。
 *
 * 夹具：test/helpers.ts 的 makeSearchFixtureDb（mulberry32 确定性种子，1/2/4 号测试共用
 * 同一个 1 万页夹具库）。1/4 号经 `node --import tsx` spawn test/perf-cold-child.ts 真
 * 冷进程测量（范式同 scripts/run-selftest.mjs；pretest 的 ensure-abi 保证 better-sqlite3
 * 为 Node ABI）。
 *
 * 每项：console.log 实测值 → 预算断言 → 追加 docs/perf-history.jsonl
 * 一行 {date, git_rev, metric, value_ms, budget_ms, pass}。
 * 纪律（任务书）：实测超预算**不放宽断言**，如实红 + 报告瓶颈分析。
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildSegment, ulid } from '@septcats/core';
import type { ActorId, Op, Segment } from '@septcats/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { commitOps } from '../src/main/commit';
import { createSearchService } from '../src/main/search';
import type { MigrateData, RebuildData } from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import {
  coreExecutor,
  describeDb,
  FIXTURE_WORDS,
  makeCore,
  makeSearchFixtureDb,
  makeTempDb,
  mulberry32,
  requestOk,
  type TempDb,
} from './helpers';

// ---------------------------------------------------------------------------
// 常量（预算与夹具规模——全部来自 PROJECT_PLAN.md §9.2 与任务书 §1）
// ---------------------------------------------------------------------------

const WORKSPACE = 'ws-perf';
const PAGE_COUNT = 10_000;
const ACTOR: ActorId = 'perftest01';
const PROBE_QUERY = '核反冲';

/** §9.2 预算（ms）。 */
const BUDGET_COLD_FIRST_QUERY = 150;
const BUDGET_COMMIT_BATCH_P95 = 16;
const BUDGET_REBUILD = 5000;
const BUDGET_COLD_OPEN_MIGRATE_QUERY = 800;

/** 提交路径等价物：单页 1 万字 ≈ 200 块 × 50 字。 */
const BLOCKS_PER_PAGE = 200;
const CHARS_PER_BLOCK = 50;
const COMMIT_SAMPLES = 40;
const COMMIT_WARMUP = 3;

/** rebuild 分段规模：每段 2500 op（真实攒段器的量级）。 */
const REBUILD_OPS_PER_SEGMENT = 2500;

const here = dirname(fileURLToPath(import.meta.url));
// test → apps/desktop → apps → 仓库根
const REPO_ROOT = join(here, '..', '..', '..');
const PERF_HISTORY_PATH = join(REPO_ROOT, 'docs', 'perf-history.jsonl');
const COLD_CHILD_PATH = join(here, 'perf-cold-child.ts');

// ---------------------------------------------------------------------------
// perf-history.jsonl 台账 + git rev
// ---------------------------------------------------------------------------

let cachedRev: string | null = null;

function gitRev(): string {
  if (cachedRev === null) {
    try {
      cachedRev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
    } catch {
      cachedRev = 'unknown';
    }
  }
  return cachedRev;
}

/** 追加一行测量记录（schema 见任务书 §1）。console.log 由各用例自带上下文，这里只落账。 */
function recordPerf(metric: string, valueMs: number, budgetMs: number, pass: boolean): void {
  const now = new Date();
  const date = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const line = JSON.stringify({
    date,
    git_rev: gitRev(),
    metric,
    value_ms: Number(valueMs.toFixed(1)),
    budget_ms: budgetMs,
    pass,
  });
  appendFileSync(PERF_HISTORY_PATH, `${line}\n`, 'utf8');
}

/** 与 search.test.ts 同口径的 P95 取样（ceil(0.95·n)-1，越界兜底 +∞）。 */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ??
    Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// 冷进程子测量（perf-cold-child.ts）：stdout 末行 JSON
// ---------------------------------------------------------------------------

interface ColdChildResult {
  readonly open_ms: number;
  readonly first_query_ms: number;
  readonly hit_count: number;
}

function runColdChild(dbPath: string, workspaceId: string): Promise<ColdChildResult> {
  return new Promise<ColdChildResult>((resolveChild, rejectChild) => {
    // cwd = apps/desktop：`--import tsx` 的裸模块解析以 cwd 为基准（同 run-selftest.mjs）
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', COLD_CHILD_PATH, dbPath, workspaceId],
      { cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const killer = setTimeout(() => {
      child.kill();
      rejectChild(new Error('perf-cold-child 120s 未退出，已终止'));
    }, 120_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(killer);
      rejectChild(error);
    });
    child.on('exit', (code) => {
      clearTimeout(killer);
      const lastLine = stdout.trim().split('\n').pop() ?? '';
      try {
        const parsed = JSON.parse(lastLine) as ColdChildResult;
        if (
          typeof parsed.open_ms !== 'number' ||
          typeof parsed.first_query_ms !== 'number' ||
          typeof parsed.hit_count !== 'number'
        ) {
          throw new Error('字段缺失');
        }
        resolveChild(parsed);
      } catch {
        rejectChild(
          new Error(
            `perf-cold-child stdout 末行不是合法结果 JSON（exit=${String(code)}）：\n` +
            `stdout 末行：${lastLine}\nstderr（末 2000 字）：${stderr.slice(-2000)}`,
          ),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------

describeDb('perf：G4 §9.2 硬指标基线（TASK-T14-01）', (ctor) => {
  // 1/4 号共用的 1 万页夹具库（构建一次，两个冷进程测量各自打开它）
  let sharedTemp: TempDb | null = null;

  beforeAll(async () => {
    sharedTemp = makeTempDb('septcats-perf-cold');
    const core = await makeSearchFixtureDb(ctor, sharedTemp.path, PAGE_COUNT, {
      workspaceId: WORKSPACE,
    });
    core.dispose(); // 关连接留文件：冷进程由子进程自己打开
  }, 300_000);

  afterAll(() => {
    sharedTemp?.cleanup();
    sharedTemp = null;
  });

  it('冷进程打开 1 万页真库 → 第一次搜索 ≤150ms（搜索红线的冷态账）', async () => {
    expect(sharedTemp).not.toBeNull();
    const temp = sharedTemp!;
    const result = await runColdChild(temp.path, WORKSPACE);
    console.log(
      `  [perf] 冷进程首查 = ${result.first_query_ms.toFixed(1)} ms ` +
      `（open+migrate=${result.open_ms.toFixed(1)} ms，hits=${String(result.hit_count)}，` +
      `预算 ${String(BUDGET_COLD_FIRST_QUERY)} ms）`,
    );
    expect(result.hit_count).toBeGreaterThan(0);
    // 先落账再断言：实测超预算时 perf-history 也要留下真实的红记录（任务书纪律）
    const pass = result.first_query_ms <= BUDGET_COLD_FIRST_QUERY;
    recordPerf('cold_first_query_10k_pages', result.first_query_ms, BUDGET_COLD_FIRST_QUERY, pass);
    expect(result.first_query_ms, `冷进程首查 ${result.first_query_ms.toFixed(1)}ms 超预算`).toBeLessThanOrEqual(
      BUDGET_COLD_FIRST_QUERY,
    );
  }, 180_000);

  it('1 万字页 200 块 commitOps batch 落库 P95 ≤16ms（输入延迟的提交路径等价物）', async () => {
    const temp = makeTempDb('septcats-perf-commit');
    let core: DbServerCore | null = null;
    try {
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: 'perf-commit-migrate', t: 'migrate' });
      const executor = coreExecutor(core);
      const rand = mulberry32(20260916);
      const word = (): string => FIXTURE_WORDS[Math.floor(rand() * FIXTURE_WORDS.length)] ?? '暗物质';
      const at = 1_700_000_000_000;
      let lamportSeq = 0;

      const blockText = (): string => {
        let text = '';
        while (text.length < CHARS_PER_BLOCK) {
          text += `${word()}，`;
        }
        return `${text}${word()}。`;
      };
      const blockOp = (pageId: string, index: number): Op => {
        lamportSeq += 1;
        return {
          op_id: ulid(at),
          lamport: { c: lamportSeq, d: ACTOR },
          at,
          actor: ACTOR,
          target: { table: 'block', id: `bk-perf-${String(lamportSeq).padStart(8, '0')}` },
          kind: 'upsert',
          payload: {
            page_id: pageId,
            workspace_id: WORKSPACE,
            type: 'paragraph',
            props: {},
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: blockText() }] }],
            },
            sort_key: `A${String(index).padStart(8, '0')}`,
            alive: 1,
            updated_at: at,
          },
        };
      };
      const pageOp = (pageId: string): Op => {
        lamportSeq += 1;
        return {
          op_id: ulid(at),
          lamport: { c: lamportSeq, d: ACTOR },
          at,
          actor: ACTOR,
          target: { table: 'page', id: pageId },
          kind: 'upsert',
          payload: {
            workspace_id: WORKSPACE,
            title: `提交路径测量页 ${pageId}`,
            icon: null,
            cover: null,
            parent_id: null,
            sort_key: `A${String(lamportSeq).padStart(8, '0')}`,
            alive: 1,
            deleted_at: null,
            updated_at: at,
          },
        };
      };

      // 预热（JIT / 页缓存稳定后再计时）
      for (let warm = 0; warm < COMMIT_WARMUP; warm += 1) {
        const pageId = `pg-perf-warm-${String(warm)}`;
        await commitOps(executor, [pageOp(pageId)], { workspaceId: WORKSPACE });
        await commitOps(
          executor,
          Array.from({ length: BLOCKS_PER_PAGE }, (_, j) => blockOp(pageId, j)),
          { workspaceId: WORKSPACE },
        );
      }

      const samples: number[] = [];
      for (let i = 0; i < COMMIT_SAMPLES; i += 1) {
        const pageId = `pg-perf-${String(i).padStart(4, '0')}`;
        await commitOps(executor, [pageOp(pageId)], { workspaceId: WORKSPACE });
        const ops = Array.from({ length: BLOCKS_PER_PAGE }, (_, j) => blockOp(pageId, j));
        const started = performance.now();
        await commitOps(executor, ops, { workspaceId: WORKSPACE });
        samples.push(performance.now() - started);
      }
      const measured = p95(samples);
      console.log(
        `  [perf] commitOps 200 块 batch P95 = ${measured.toFixed(1)} ms ` +
        `（${String(COMMIT_SAMPLES)} 次采样，预算 ${String(BUDGET_COMMIT_BATCH_P95)} ms）`,
      );
      const pass = measured <= BUDGET_COMMIT_BATCH_P95;
      recordPerf('commit_batch_200_blocks_p95', measured, BUDGET_COMMIT_BATCH_P95, pass);
      expect(measured, `commitOps batch P95 ${measured.toFixed(1)}ms 超预算`).toBeLessThanOrEqual(
        BUDGET_COMMIT_BATCH_P95,
      );
    } finally {
      core?.dispose();
      temp.cleanup();
    }
  }, 240_000);

  it('1 万页账本 rebuildFromSegments 全量重建 <5000ms（投影重建基线）', async () => {
    const temp = makeTempDb('septcats-perf-rebuild');
    let core: DbServerCore | null = null;
    try {
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: 'perf-rebuild-migrate', t: 'migrate' });

      // ---- 生成 1 万页账本（mulberry32 确定性；形态同 makeSearchFixtureDb：2 段落 + 1/3 标题块 + 1/11 code 块）----
      const rand = mulberry32(20260913);
      const word = (): string => FIXTURE_WORDS[Math.floor(rand() * FIXTURE_WORDS.length)] ?? '暗物质';
      const at = 1_700_000_000_000;
      const ops: Op[] = [];
      let lamportSeq = 0;
      const nextOp = (target: { table: 'page' | 'block'; id: string }, payload: Record<string, unknown>): void => {
        lamportSeq += 1;
        ops.push({
          op_id: ulid(at),
          lamport: { c: lamportSeq, d: ACTOR },
          at,
          actor: ACTOR,
          target,
          kind: 'upsert',
          payload,
        });
      };
      const paragraphDoc = (text: string): Record<string, unknown> => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      });
      for (let i = 0; i < PAGE_COUNT; i += 1) {
        const pageId = `pg-rb-${String(i).padStart(6, '0')}`;
        const probe = i % 7 === 0 ? PROBE_QUERY : '';
        nextOp(
          { table: 'page', id: pageId },
          {
            workspace_id: WORKSPACE,
            title: `${probe}${word()}${word()}研究笔记${String(i)}`,
            icon: null,
            cover: null,
            parent_id: null,
            sort_key: `A${String(i).padStart(9, '0')}`,
            alive: 1,
            deleted_at: null,
            updated_at: at,
          },
        );
        nextOp(
          { table: 'block', id: `${pageId}-a` },
          {
            page_id: pageId,
            workspace_id: WORKSPACE,
            type: 'paragraph',
            props: {},
            content: paragraphDoc(`${word()}，${word()}与${word()}的${word()}来源。${word()}是关键输入。`),
            sort_key: 'A00000000',
            alive: 1,
            updated_at: at,
          },
        );
        nextOp(
          { table: 'block', id: `${pageId}-b` },
          {
            page_id: pageId,
            workspace_id: WORKSPACE,
            type: 'paragraph',
            props: {},
            content: paragraphDoc(`${word()}${word()}观测约束与系统性偏差评估。`),
            sort_key: 'A00000001',
            alive: 1,
            updated_at: at,
          },
        );
        if (i % 3 === 0) {
          const heading = `${word()}小节`;
          nextOp(
            { table: 'block', id: `${pageId}-h` },
            {
              page_id: pageId,
              workspace_id: WORKSPACE,
              type: 'heading',
              props: { title: heading },
              content: paragraphDoc(heading),
              sort_key: 'A00000002',
              alive: 1,
              updated_at: at,
            },
          );
        }
        if (i % 11 === 0) {
          nextOp(
            { table: 'block', id: `${pageId}-c` },
            {
              page_id: pageId,
              workspace_id: WORKSPACE,
              type: 'code',
              props: {},
              content: `const probe_${String(i)} = "build:fast"; // 探测器原始计数`,
              sort_key: 'A00000003',
              alive: 1,
              updated_at: at,
            },
          );
        }
      }
      // ---- 分段（每段 REBUILD_OPS_PER_SEGMENT 个 op；lamport 全局严格递增 → 段内升序天然成立）----
      const segments: Segment[] = [];
      for (let start = 0; start < ops.length; start += REBUILD_OPS_PER_SEGMENT) {
        segments.push(buildSegment(ACTOR, ops.slice(start, start + REBUILD_OPS_PER_SEGMENT), at));
      }
      const segmentsJson = JSON.stringify(segments);
      console.log(
        `  [perf] rebuild 夹具：${String(segments.length)} 段 / ${String(ops.length)} op / ` +
        `${(segmentsJson.length / 1024 / 1024).toFixed(1)} MB segmentsJson`,
      );

      // ---- 计时：全量重建（解析+重放+清库+入账+物化+FTS 重算）----
      const started = performance.now();
      const response = await core.handleRequest({
        id: 'perf-rebuild-run',
        t: 'rebuildFromSegments',
        segmentsJson,
        mode: 'replace', // T82-01：1 万页全量重建基线（段即全量）
      });
      const elapsed = performance.now() - started;
      if (!response.ok) {
        throw new Error(`rebuildFromSegments 失败：${response.error.code} ${response.error.message}`);
      }
      const data = response.data as RebuildData;
      console.log(
        `  [perf] rebuildFromSegments 1 万页 = ${elapsed.toFixed(1)} ms ` +
        `（segments=${String(data.segments)} ops=${String(data.ops)} entities=${String(data.entities)}，` +
        `预算 ${String(BUDGET_REBUILD)} ms）`,
      );
      expect(data.ops).toBe(ops.length);
      expect(data.entities).toBe(ops.length);

      // 重建结果健全性（不计时）：FTS 重算后搜索仍可命中
      const search = createSearchService({ executor: coreExecutor(core) });
      const { hits } = await search.query({ workspaceId: WORKSPACE, query: PROBE_QUERY, limit: 5 });
      expect(hits.length).toBeGreaterThan(0);

      const pass = elapsed < BUDGET_REBUILD;
      recordPerf('rebuild_from_segments_10k_pages', elapsed, BUDGET_REBUILD, pass);
      expect(elapsed, `rebuildFromSegments ${elapsed.toFixed(1)}ms 超预算`).toBeLessThan(BUDGET_REBUILD);
    } finally {
      core?.dispose();
      temp.cleanup();
    }
  }, 240_000);

  it('1 万页库冷打开 + migrate + 首查 <800ms（首屏预算的 DB 段）', async () => {
    expect(sharedTemp).not.toBeNull();
    const temp = sharedTemp!;
    const result = await runColdChild(temp.path, WORKSPACE);
    const total = result.open_ms + result.first_query_ms;
    console.log(
      `  [perf] 冷打开+migrate+首查 = ${total.toFixed(1)} ms ` +
      `（open+migrate=${result.open_ms.toFixed(1)} + 首查=${result.first_query_ms.toFixed(1)}，` +
      `预算 ${String(BUDGET_COLD_OPEN_MIGRATE_QUERY)} ms）`,
    );
    const pass = total < BUDGET_COLD_OPEN_MIGRATE_QUERY;
    recordPerf('cold_open_migrate_first_query_10k_pages', total, BUDGET_COLD_OPEN_MIGRATE_QUERY, pass);
    expect(total, `冷打开+首查 ${total.toFixed(1)}ms 超预算`).toBeLessThan(BUDGET_COLD_OPEN_MIGRATE_QUERY);
  }, 180_000);
});
