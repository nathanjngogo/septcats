/**
 * apps/desktop 的 vitest 公共夹具。
 *
 * 关于原生模块：better-sqlite3 是原生扩展，`@electron/rebuild` 之后其二进制是
 * 为 Electron 的 ABI 编译的，普通 Node 运行时可能无法加载（NODE_MODULE_VERSION 不匹配）。
 * 因此这里**惰性 + 容错**加载：加载不到就跳过 DB 相关用例，纯逻辑用例照常全绿。
 * 详见 src/db/README.md。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { applyPragmaBaseline, type SqliteConstructor } from '../src/db/migrations';
import { createDbServerCore, type DbServerCore } from '../src/db/server';
import type { DbErrorPayload, DbRequest, DbResponseData } from '../src/db/rpc';
import type { StatementExecutor } from '../src/main/pages';
import type { AllData, BatchData, GetData, MigrateData, RunData } from '../src/db/rpc';

let cached: SqliteConstructor | null | undefined;
let loadError = '';
let warned = false;

/** 尝试取 better-sqlite3 构造器并**真正开一个内存库**探针；不可用返回 null。 */
export function getSqliteConstructor(): SqliteConstructor | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    const nodeRequire = createRequire(import.meta.url);
    const loaded = nodeRequire('better-sqlite3') as SqliteConstructor;
    const probe = new loaded(':memory:');
    probe.close();
    cached = loaded;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    cached = null;
  }
  return cached;
}

export function sqliteUnavailableReason(): string {
  return loadError;
}

/**
 * 注册一个「需要 better-sqlite3」的 describe：可用则正常跑，不可用则整组跳过，
 * 并只打印一次原因（避免刷屏）。
 */
export function describeDb(name: string, fn: (ctor: SqliteConstructor) => void): void {
  const ctor = getSqliteConstructor();
  if (ctor === null) {
    if (!warned) {
      warned = true;
      console.warn(`[db tests] better-sqlite3 原生模块不可用，DB 用例已跳过：${loadError}`);
    }
    describe.skip(`${name}（跳过：better-sqlite3 不可用）`, () => {
      it('skipped', () => {
        // 见 src/db/README.md 的 ABI/electron-rebuild 说明
      });
    });
    return;
  }
  describe(name, () => {
    fn(ctor);
  });
}

export interface TempDb {
  readonly dir: string;
  readonly path: string;
  cleanup(): void;
}

/** 建一个临时目录 + 库路径；用完调用 cleanup()。 */
export function makeTempDb(label = 'septcats-test'): TempDb {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    dir,
    path: join(dir, 'septcats.db'),
    cleanup: (): void => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 打开临时库、上 PRAGMA 基线，包成 DbServerCore。 */
export function makeCore(ctor: SqliteConstructor, dbPath: string): DbServerCore {
  const db = new ctor(dbPath);
  applyPragmaBaseline(db);
  return createDbServerCore(db);
}

/** 发一条请求并断言成功，返回 data。 */
export async function requestOk<T extends DbResponseData>(
  core: DbServerCore,
  request: DbRequest,
): Promise<T> {
  const response = await core.handleRequest(request);
  if (!response.ok) {
    throw new Error(`${request.t} 未预期失败：${response.error.code} ${response.error.message}`);
  }
  return response.data as T;
}

/** 发一条请求并断言失败，返回 error 载荷。 */
export async function requestFail(core: DbServerCore, request: DbRequest): Promise<DbErrorPayload> {
  const response = await core.handleRequest(request);
  if (response.ok) {
    throw new Error(`${request.t} 未预期成功`);
  }
  return response.error;
}

// ---------------------------------------------------------------------------
// 搜索夹具（TASK-T8-01 §1/§4：mulberry32 确定性生成 页/块 随机中文文本）
// ---------------------------------------------------------------------------

/** mulberry32 确定性 PRNG（同 seed 同序列：性能/断言可复现）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 夹具词表（真实感中文；'核反冲' 作为探针词）。导出供 perf.test.ts 的 Op 生成路径复用同一词表。 */
export const FIXTURE_WORDS: readonly string[] = [
  '暗物质', '探测器', '中子', '本底', '核反冲', '量子', '能谱', '实验',
  '数据', '台账', '文献', '统计', '误差', '效率', '曲线', '信号',
  '简并', '拟合', '曝光', '事例',
];

/** PM doc 形态的 paragraph content_json（真实深层结构，检验 json_tree 抽取）。 */
function paragraphDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

function wordAt(rand: () => number): string {
  return FIXTURE_WORDS[Math.floor(rand() * FIXTURE_WORDS.length)] ?? '暗物质';
}

/**
 * 建 1 个工作区 + pageCount 页夹具（每页 2–4 块），写入真库（触发器维护 FTS）。
 * 布点：
 *  - i % 7 === 0 → 页标题含「核反冲」；
 *  - i % 5 === 0 → 段落正文含「核反冲」；
 *  - i % 3 === 0 → 标题块（props.title）；
 *  - i % 11 === 0 → code 块（content 为纯文本串，正文不进 FTS，LIKE 兜底目标）。
 */
export async function makeSearchFixtureDb(
  ctor: SqliteConstructor,
  dbPath: string,
  pageCount: number,
  options: { seed?: number; workspaceId?: string } = {},
): Promise<DbServerCore> {
  const core = makeCore(ctor, dbPath);
  await requestOk<MigrateData>(core, { id: 'fixture-migrate', t: 'migrate' });
  const workspaceId = options.workspaceId ?? 'ws-fixture';
  const seed = options.seed ?? 20260913;
  const rand = mulberry32(seed);
  const at = 1_700_000_000_000;

  const db = core.activeDatabase();
  const insPage = db.prepare(
    `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 1, 1, ?)`,
  );
  const insBlock = db.prepare(
    `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (let i = 0; i < pageCount; i += 1) {
      const pageId = `pg-fix-${String(i).padStart(6, '0')}`;
      const probe = i % 7 === 0 ? '核反冲' : '';
      const title = `${probe}${wordAt(rand)}${wordAt(rand)}研究笔记${String(i)}`;
      insPage.run(pageId, workspaceId, title, `A${String(i).padStart(9, '0')}`, at);

      const paragraphText =
        `${wordAt(rand)}，${wordAt(rand)}与${wordAt(rand)}的${wordAt(rand)}来源` +
        (i % 5 === 0 ? '，需复核核反冲效率曲线' : '') +
        `。${wordAt(rand)}是关键输入。`;
      insBlock.run(
        `bk-fix-${String(i).padStart(6, '0')}-a`,
        pageId,
        workspaceId,
        'paragraph',
        '{}',
        paragraphDoc(paragraphText),
        `A0000000${String(i % 10)}`,
        i + 1,
        'aaaa0001',
        at,
      );
      insBlock.run(
        `bk-fix-${String(i).padStart(6, '0')}-b`,
        pageId,
        workspaceId,
        'paragraph',
        '{}',
        paragraphDoc(`${wordAt(rand)}${wordAt(rand)}观测约束与系统性偏差评估。`),
        `A0000001${String(i % 10)}`,
        i + 1,
        'aaaa0001',
        at,
      );
      if (i % 3 === 0) {
        const heading = `${wordAt(rand)}小节`;
        insBlock.run(
          `bk-fix-${String(i).padStart(6, '0')}-h`,
          pageId,
          workspaceId,
          'heading',
          JSON.stringify({ title: heading }),
          paragraphDoc(heading),
          `A0000002${String(i % 10)}`,
          i + 1,
          'aaaa0001',
          at,
        );
      }
      if (i % 11 === 0) {
        insBlock.run(
          `bk-fix-${String(i).padStart(6, '0')}-c`,
          pageId,
          workspaceId,
          'code',
          '{}',
          JSON.stringify(`const probe_${String(i)} = "build:fast"; // 探测器原始计数`),
          `A0000003${String(i % 10)}`,
          i + 1,
          'aaaa0001',
          at,
        );
      }
    }
  })();
  return core;
}

let executorSeq = 0;

/** DbServerCore → StatementExecutor 适配（pages/dbview/search 服务测试共用）。 */
export function coreExecutor(core: DbServerCore): StatementExecutor {
  const nextId = (): string => {
    executorSeq += 1;
    return `exec-${String(executorSeq)}`;
  };
  return {
    run: async (sqlId, params) => (await requestOk<RunData>(core, { id: nextId(), t: 'run', sqlId, params })) as RunData,
    get: async (sqlId, params) => (await requestOk<GetData>(core, { id: nextId(), t: 'get', sqlId, params })) as GetData,
    all: async (sqlId, params) => (await requestOk<AllData>(core, { id: nextId(), t: 'all', sqlId, params })) as AllData,
    batch: async (stmts) => (await requestOk<BatchData>(core, { id: nextId(), t: 'batch', stmts })) as BatchData,
  };
}
