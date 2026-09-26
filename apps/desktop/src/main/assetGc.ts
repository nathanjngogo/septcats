/**
 * assetGc.ts —— 附件目录孤儿回收对账（T83-02，PM 接手重做：CB 半成品仅留用其
 * planAssetGc 纯逻辑与 shared 类型契约，执行面全部重写）。
 *
 * 背景：T81-01 的 db 面 GC 只删库行；内容寻址的 `attachments/<hash><ext>` 文件
 * 从未对账 → 页面被彻底清除后，其**独占**附件永久占盘。本模块做「对账 + 两步清除」。
 *
 * 纪律（与 dbgc 同源）：
 * - **删除永远先算清单**：判定纯逻辑 = `@septcats/sync` 的 `planAssetGc`（零 IO，
 *   单测 10 用例钉死）；本模块只装配「引用哈希集 + 磁盘列举」再执行计划内文件；
 * - **宁多勿漏**：引用枚举扫块明文（**含墓碑页**——回收站页 restore 要用附件）、
 *   页面 cover/icon、collection/record JSON、op_ledger 历史 op_json（段重放会重建
 *   未物化块，账本引用也算在用）；扩展名变体按 findHashFile 前缀口径归到同一哈希；
 * - **失明即全扣**：`block_cipher` 有行 → 锁页内容加密、明文扫描看不见其引用 →
 *   referencesComplete=false → 未命中引用的文件一律扣留（planAssetGc 的 blind 分支）；
 * - **逐文件两拍删除**：先 rename 到 `.orphan-<ts>.<name>`（同目录），rename 失败=扣；
 *   rename 成功后 remove 失败=改回原名（还原字节）计入 failed；每轮把「本次将删清单」
 *   写 logger（可核对）；**取消/不点 run=零删除**。
 * - 触发面：IPC `assetgc:preview`（只读零写）/ `assetgc:run`（确认执行）。启动后台
 *   **不跑**（附件删除半径大于库行，不做静默自动清——与 dbgc 的差别是刻意的）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { planAssetGc, type AssetDiskFile } from '@septcats/sync';
import type { StatementExecutor } from './pages';
import type { AssetGcHeldCounts, AssetGcPreview, AssetGcRunResult } from '../shared/assetGc';

/** 保护期缺省 30 天（与 DB_GC_DEFAULT_RETENTION_DAYS 同值；刚写入尚未落块的附件不吃）。 */
export const ASSET_GC_DEFAULT_RETENTION_DAYS = 30;

/** 附件引用 URL 形态：`asset://<hash><ext>` / `attachment://<hash>`（assets.ts 契约）。
 *  提取 64 位小写 hex 且其后不能再跟 hex（排除更长串的前缀误配）。 */
export const ASSET_REF_RE = /(?:asset|attachment):\/\/([0-9a-f]{64})(?![0-9a-f])/g;

/** 从任意 JSON 文本抽引用哈希集（正则全局扫；调用方给什么文本扫什么）。 */
export function extractRefHashes(text: string, into: Set<string>): void {
  for (const m of text.matchAll(ASSET_REF_RE)) {
    const h = m[1];
    if (h !== undefined) { into.add(h); }
  }
}

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function emptyHeldCounts(): AssetGcHeldCounts {
  return { referenced: 0, blind: 0, unknown: 0, recent: 0 };
}

function toHeldCounts(held: ReadonlyArray<{ reason: keyof AssetGcHeldCounts }>): AssetGcHeldCounts {
  const counts = emptyHeldCounts();
  for (const entry of held) {
    counts[entry.reason] += 1;
  }
  return counts;
}

/** 引用哈希集 = 六路只读 SELECT 的并集（宁多勿漏：任何一路报错整体拒绝而非少算）。
 *  T84-02：导出为公共判定（SyncRuntime 附件上行引用集与 GC 同一套代码，红线「复用
 *  不另造」；失败上抛由调用方按「引用不完整=不做破坏性动作」口径处置）。 */
export async function loadReferencedHashes(
  executor: Pick<StatementExecutor, 'all'>,
): Promise<Set<string>> {
  const [blocks, covers, collections, records, ledger] = await Promise.all([
    executor.all('assetgc.blockRefs'),
    executor.all('assetgc.pageCoverRefs'),
    executor.all('assetgc.collectionRefs'),
    executor.all('assetgc.recordRefs'),
    executor.all('assetgc.ledgerRefs'),
  ]);
  const hashes = new Set<string>();
  for (const bag of [blocks, collections, records, ledger]) {
    for (const row of bag.rows) {
      const json = rowString(row, 'json');
      if (json !== null) { extractRefHashes(json, hashes); }
    }
  }
  // cover/icon 列本身可能直接就是哈希或含 URL 的 JSON——整列文本照扫。
  for (const row of covers.rows) {
    for (const key of ['json', 'icon'] as const) {
      const text = rowString(row, key);
      if (text !== null) { extractRefHashes(text, hashes); }
    }
  }
  return hashes;
}

export interface AssetGcServiceOptions {
  readonly executor: StatementExecutor;
  readonly attachmentsDir: string;
  readonly now?: () => number;
  readonly retentionDays?: () => number;
  /** 注入磁盘列举（单测夹具口；缺省 readdir+stat 真实目录，目录不存在=空集）。 */
  readonly listDisk?: () => AssetDiskFile[];
  /** 注入删除原语（单测夹具口；缺省两拍 rename→remove）。 */
  readonly removeFile?: (name: string, bytes: number) => 'deleted' | 'failed';
  /** 记「本次将删清单」（可核对纪律；缺省 no-op，接线处给 logger）。 */
  readonly onPlan?: (names: readonly string[], bytes: number) => void;
}

export interface AssetGcService {
  /** dry-run：只回条数/预估字节，**零写**。 */
  preview(): Promise<AssetGcPreview>;
  /** 确认执行：真删计划内文件（两拍 rename→remove），清单先落日志。 */
  run(): Promise<AssetGcRunResult>;
}

export function createAssetGcService(options: AssetGcServiceOptions): AssetGcService {
  const { executor, attachmentsDir } = options;
  const now = options.now ?? ((): number => Date.now());
  const retentionDays = options.retentionDays ?? ((): number => ASSET_GC_DEFAULT_RETENTION_DAYS);

  /** 引用哈希集：公共判定（六路并集；T84-02 与附件上行共用同一套代码）。 */

  async function blindCount(): Promise<number> {
    const r = await executor.get('assetgc.blindCount');
    const n = (r.row as Record<string, unknown> | null)?.n;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  function defaultListDisk(): AssetDiskFile[] {
    if (!existsSync(attachmentsDir)) { return []; }
    return readdirSync(attachmentsDir)
      .filter((name) => !name.startsWith('.orphan-')) // 上次删除失败的残尸不参与对账（也不误判）
      .map((name) => {
        try {
          const st = statSync(join(attachmentsDir, name));
          return st.isFile() ? { name, bytes: st.size, mtimeMs: Math.floor(st.mtimeMs) } : null;
        } catch { return null; } // 竞态删除/特殊文件 → 本轮不看它
      })
      .filter((f): f is AssetDiskFile => f !== null);
  }

  /** 两拍删除：rename（同目录、唯一残尸名、可回滚）→ remove。remove 失败改回原名。 */
  function defaultRemoveFile(name: string): 'deleted' | 'failed' {
    const src = join(attachmentsDir, name);
    const tmp = join(attachmentsDir, `.orphan-${String(Date.now())}-${createHash('sha1').update(name).digest('hex').slice(0, 8)}.node`);
    try {
      renameSync(src, tmp);
    } catch { return 'failed'; } // 没动成功=文件原位，什么都没失去
    try {
      rmSync(tmp, { force: true });
      return 'deleted';
    } catch {
      try { renameSync(tmp, src); } catch { /* 残尸留痕，原名可由日志核对 */ }
      return 'failed';
    }
  }

  async function planNow(): Promise<{
    files: AssetDiskFile[];
    deletable: AssetDiskFile[];
    held: Array<{ file: AssetDiskFile; reason: keyof AssetGcHeldCounts }>;
    referenced: Set<string>;
    referencesComplete: boolean;
    days: number;
  }> {
    const referenced = await loadReferencedHashes(executor);
    const blind = await blindCount();
    const files = (options.listDisk ?? defaultListDisk)();
    const days = retentionDays();
    const plan = planAssetGc(referenced, files, now(), {
      retentionDays: days,
      referencesComplete: blind === 0,
    });
    return { files, deletable: [...plan.deletable], held: [...plan.held], referenced, referencesComplete: blind === 0, days };
  }

  return {
    async preview(): Promise<AssetGcPreview> {
      const { files, deletable, held, referenced, referencesComplete, days } = await planNow();
      return {
        candidates: files.length,
        deletable: deletable.length,
        held: held.length,
        heldByReason: toHeldCounts(held),
        estimatedBytes: deletable.reduce((sum, f) => sum + f.bytes, 0),
        referencedHashes: referenced.size,
        referencesComplete,
        retentionDays: days,
      };
    },

    async run(): Promise<AssetGcRunResult> {
      const { deletable, held } = await planNow();
      options.onPlan?.(deletable.map((f) => f.name), deletable.reduce((s, f) => s + f.bytes, 0));
      const remove = options.removeFile ?? ((name: string): 'deleted' | 'failed' => defaultRemoveFile(name));
      let deletedFiles = 0;
      let bytesFreed = 0;
      let failed = 0;
      for (const f of deletable) {
        const outcome = remove(f.name, f.bytes);
        if (outcome === 'deleted') { deletedFiles += 1; bytesFreed += f.bytes; } else { failed += 1; }
      }
      return { deletedFiles, bytesFreed, failed, held: held.length, heldByReason: toHeldCounts(held) };
    },
  };
}
