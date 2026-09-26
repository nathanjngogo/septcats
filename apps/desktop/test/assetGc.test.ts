/**
 * assetGc.test.ts —— 附件孤儿回收执行路径（T83-02，PM 接手重做）。
 *
 * 真实 better-sqlite3（DbServerCore + 白名单 assetgc.*）+ 临时附件目录夹具。
 * 核心断言（任务书硬不变量）：
 * - **任何有引用的文件绝不删**（块引用精确名 / record 引用**扩展名变体**名都保住）；
 * - preview 零写（跑完盘上文件一个不少）；run 只删计划内孤儿，字节账正确；
 * - op_ledger 历史引用计入（段重放会重建块，账本引用也算在用）；
 * - 失明面：block_cipher 有行 → referencesComplete=false → **未命中引用的一律扣留**
 *   （planAssetGc blind 分支先于 unknown/recent，全保守）；
 * - 删除失败=文件仍在盘上（failed 计数，不吞）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbServerCore } from '../src/db/server';
import type { SqliteConstructor, SqliteDatabase } from '../src/db/migrations';
import type { MigrateData } from '../src/db/rpc';
import { createAssetGcService, extractRefHashes } from '../src/main/assetGc';
import { coreExecutor, describeDb, makeCore, makeTempDb, requestOk, type TempDb } from './helpers';

const AT = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const WS = 'ws-fixture';
const ACTOR = 'aaaa0001';

/** 64 位小写 hex 夹具哈希（确定性，xorshift 打散——避免 16 周期重复被 hex 前瞻误判）。 */
function fixtureHash(seed: string): string {
  const table = '0123456789abcdef';
  let x = 0x9e3779b9;
  for (const ch of seed) { x = (x * 31 + ch.charCodeAt(0)) >>> 0; }
  let out = '';
  for (let i = 0; i < 64; i += 1) {
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    out += table[x & 15];
  }
  return out;
}

const H_BLOCK = fixtureHash('block-ref'); // 块 content 引用（盘上精确名）
const H_RECORD = fixtureHash('record-ref'); // record values 引用（盘上是变体名 .png）
const H_LEDGER = fixtureHash('ledger-ref'); // 只在 op_ledger 里引用（盘上精确名）
const H_ORPHAN = fixtureHash('orphan-1'); // 无引用孤儿（可删）
const H_ORPHAN2 = fixtureHash('orphan-2'); // 无引用孤儿（可删）
const H_RECENT = fixtureHash('recent-1'); // 无引用但在保护期内

function insert(db: SqliteDatabase, sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...(params as never[]));
}

async function buildDb(ctor: SqliteConstructor): Promise<{ core: DbServerCore; temp: TempDb }> {
  const temp = makeTempDb('septcats-assetgc');
  const core = makeCore(ctor, temp.path);
  await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
  const db = core.activeDatabase();
  db.transaction(() => {
    insert(db, `INSERT INTO workspace (id, name, root_page_id, settings_json, created_at) VALUES (?, ?, NULL, '{}', ?)`, WS, '夹具库', AT);
    insert(db, `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at, deleted_at)
                VALUES ('p1', ?, '页一', NULL, NULL, NULL, 'A', 1, 1, ?, NULL)`, WS, AT);
    insert(db, `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('b1', 'p1', ?, 'image', '{}', ?, 'B', 1, 1, 1, ?, ?)`,
      WS, `{"src":"attachment://${H_BLOCK}"}`, ACTOR, AT);
    insert(db, `INSERT INTO collection (id, page_id, workspace_id, name, schema_json, views_json, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('c1', 'p1', ?, '表', '{}', '[]', 1, 1, 1, ?, ?)`, WS, ACTOR, AT);
    insert(db, `INSERT INTO record (id, collection_id, workspace_id, values_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
                VALUES ('r1', 'c1', ?, ?, 'A', 1, 1, 1, ?, ?)`, WS, `{"f":"asset://${H_RECORD}.png"}`, ACTOR, AT);
    insert(db, `INSERT INTO op_ledger (op_id, seg_id, lamport_c, lamport_d, target_table, target_id, op_json, applied_at)
                VALUES ('op-h', NULL, 1, ?, 'block', 'b9', ?, ?)`,
      ACTOR, `{"set":{"content":{"src":"attachment://${H_LEDGER}"}}}`, AT);
  })(); // better-sqlite3：transaction(fn) 返回包装函数，必须再调用才执行
  return { core, temp };
}

/** 附件目录夹具（temp.dir 旁挂，cleanup 连坐）：7 个文件覆盖全部判定形态。 */
function buildAttachments(t: TempDb): string {
  const dir = join(t.dir, 'attachments');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const putOld = (name: string, bytes: number): void => {
    writeFileSync(join(dir, name), Buffer.alloc(bytes, 0x7f));
    utimesSync(join(dir, name), new Date(NOW - 400 * DAY), new Date(NOW - 400 * DAY));
  };
  putOld(H_BLOCK, 111);
  putOld(`${H_RECORD}.png`, 222);
  putOld(H_LEDGER, 333);
  putOld(H_ORPHAN, 444);
  putOld(H_ORPHAN2, 555);
  writeFileSync(join(dir, H_RECENT), Buffer.alloc(666, 0x7f));
  // mtime 相对**注入的 NOW** 摆（不能用真实系统时钟——夹具 now()≠Date.now()）
  utimesSync(join(dir, H_RECENT), new Date(NOW - DAY), new Date(NOW - DAY)); // 保护期内
  writeFileSync(join(dir, 'readme.txt'), Buffer.alloc(77, 0x7f)); // 非内容寻址名 → unknown
  return dir;
}

describeDb('附件孤儿回收执行路径（T83-02）', (ctor) => {
  it('preview 零写；run 只删无引用孤儿；有引用/变体/账本/保护期/unknown 全保住', async () => {
    const { core, temp } = await buildDb(ctor);
    const dir = buildAttachments(temp);
    const service = createAssetGcService({
      executor: coreExecutor(core),
      attachmentsDir: dir,
      now: () => NOW,
      retentionDays: () => 30,
    });

    const preview = await service.preview();
    expect(preview.candidates).toBe(7);
    expect(preview.deletable).toBe(2);
    expect(preview.estimatedBytes).toBe(444 + 555);
    expect(preview.referencedHashes).toBe(3);
    expect(preview.referencesComplete).toBe(true);
    expect(preview.heldByReason.referenced).toBe(3);
    expect(preview.heldByReason.recent).toBe(1);
    expect(preview.heldByReason.unknown).toBe(1);
    expect(existsSync(join(dir, H_ORPHAN))).toBe(true); // 预览不动盘

    const run = await service.run();
    expect(run.deletedFiles).toBe(2);
    expect(run.bytesFreed).toBe(999);
    expect(run.failed).toBe(0);
    expect(existsSync(join(dir, H_ORPHAN))).toBe(false);
    expect(existsSync(join(dir, H_ORPHAN2))).toBe(false);
    for (const keep of [H_BLOCK, `${H_RECORD}.png`, H_LEDGER, H_RECENT, 'readme.txt']) {
      expect(existsSync(join(dir, keep))).toBe(true);
    }
    expect(readFileSync(join(dir, H_BLOCK)).equals(Buffer.alloc(111, 0x7f))).toBe(true); // 保住者逐字节完好
    const again = await service.run();
    expect(again.deletedFiles).toBe(0); // 幂等

    // ---- 失明面：block_cipher 有行 → 未命中引用一律 blind（unknown/recent 也保守归 blind）----
    insert(core.activeDatabase(), `INSERT INTO block_cipher (page_id, blob, format, updated_at) VALUES ('p1', ?, 1, ?)`, Buffer.from('cipher'), AT);
    writeFileSync(join(dir, fixtureHash('post-blind')), Buffer.alloc(50, 0x7f));
    utimesSync(join(dir, fixtureHash('post-blind')), new Date(NOW - 400 * DAY), new Date(NOW - 400 * DAY));
    const blindPreview = await service.preview();
    expect(blindPreview.referencesComplete).toBe(false);
    expect(blindPreview.deletable).toBe(0);
    expect(blindPreview.candidates).toBe(6);
    expect(blindPreview.heldByReason.blind).toBe(3); // post-blind + readme.txt + H_RECENT 全扣
    expect(blindPreview.heldByReason.referenced).toBe(3);
    const blindRun = await service.run();
    expect(blindRun.deletedFiles).toBe(0);
    expect(existsSync(join(dir, fixtureHash('post-blind')))).toBe(true);
    core.dispose();
    temp.cleanup();
  });

  it('removeFile 失败=文件仍在盘上且计 failed（两拍语义不吞错）', async () => {
    const { core, temp } = await buildDb(ctor);
    const dir = buildAttachments(temp);
    const service = createAssetGcService({
      executor: coreExecutor(core),
      attachmentsDir: dir,
      now: () => NOW,
      retentionDays: () => 30,
      removeFile: (name: string): 'deleted' | 'failed' => {
        if (name === H_ORPHAN) { return 'failed'; } // 模拟占用
        rmSync(join(dir, name), { force: true });
        return 'deleted';
      },
    });
    const run = await service.run();
    expect(run.deletedFiles).toBe(1);
    expect(run.failed).toBe(1);
    expect(existsSync(join(dir, H_ORPHAN))).toBe(true);
    core.dispose();
    temp.cleanup();
  });
});

describe('extractRefHashes 提取口径（T83-02）', () => {
  it('精确 64hex 收；变体收；更长 hex 前缀不误配；大写/裸哈希不收', () => {
    const set = new Set<string>();
    const h = fixtureHash('x');
    extractRefHashes(
      `a://x attachment://${h} asset://${h}.png asset://${h}deadbeef ` +
        `ASSET://${h.toUpperCase()} "attachment":"${h}"`,
      set,
    );
    expect([...set]).toEqual([h]);
  });
});
