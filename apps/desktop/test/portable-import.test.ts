/**
 * portable-import.test.ts —— R28（TASK-T80-02）便携包导入：读侧纯逻辑 + 三段式换库。
 *
 * 覆盖（任务书 §交付面/测试）：
 *  - 纯逻辑：备份三件套命名与反解 / 条目分类 / 加密判定 / 清单闸 / checksums 全验 /
 *    段数自检 / zip slip 条目名 / schema 兼容；
 *  - 服务：**T80-01 导出夹具 → 导入 roundtrip**（counts 逐值等、mode 显式 replace）/
 *    **幂等**（同包第二遍同结果）/ 非空库冲突预检拒 / checksums 篡改拒 / zip slip 拒 /
 *    半截 zip 结构化拒绝 / 加密包拒 / **失败注入回滚逐字节还原** / **无备份不落库** /
 *    撤销还原 / dir 显式契约 / IPC 守卫。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import {
  buildSegment,
  encodeSegment,
  type ActorId,
  type Op,
  type Segment,
} from '@septcats/core';
import {
  PORTABLE_DB_ENTRY,
  PORTABLE_MANIFEST_NAME,
  buildPortableManifest,
  encodePortableManifest,
  segmentFileName,
  sha256Hex,
  type PortableEntryMeta,
} from '@septcats/sync';
import {
  PORTABLE_SYNC_MANIFEST_NAME,
  assertPortableImportEntryNames,
  assertPortableSegmentCount,
  classifyPortableEntry,
  isManagedSyncFileName,
  isPortableEncrypted,
  isSyncSegmentFileName,
  isSyncSnapshotFileName,
  localSegmentOpIds,
  parsePortableManifest,
  portableAttachmentNames,
  portableBackupName,
  portableBackupOrigin,
  portableBackupPlan,
  portableRestorePlan,
  portableSchemaCompatible,
  portableSegmentNames,
  portableSyncBackupDir,
  verifyPortableChecksums,
} from '@septcats/sync';
import {
  createPortableExportService,
  nodePortableExportIo,
  type PortableExportIo,
} from '../src/main/portable';
import {
  PORTABLE_IMPORT_CONFIRM_MESSAGE,
  PORTABLE_IMPORT_ENCRYPTED_MESSAGE,
  createPortableImportService,
  nodePortableImportIo,
  registerPortableImportIpc,
  type PortableImportDb,
  type PortableImportIo,
  type PortableImportReplayData,
  type PortableImportService,
} from '../src/main/portableImport';
import { describeDb, makeCore, makeTempDb, requestOk } from './helpers';
import type { MigrateData, RunData } from '../src/db/rpc';

const FIXED_NOW = Date.UTC(2026, 8, 25, 10, 20, 30);
const APP_VERSION = '0.5.0';
const SCHEMA_VERSION = 10;
const LIBRARY = '我的 库';
const DEV: ActorId = 'dev00001';
const AT = 1_700_000_000_000;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const DB_BYTES = new TextEncoder().encode('sqlite-main-db-bytes');
/** 故障注入写的「半截库」字节（还原后必须消失）。 */
const SMASHED_BYTES = new TextEncoder().encode('half-written-db');
/** replace 重放后的「新库态」字节（撤销/回滚必须把它换回 DB_BYTES）。 */
const REPLAY_BYTES = new TextEncoder().encode('rebuilt-from-segments-db');
const REPLAY_WAL_BYTES = new TextEncoder().encode('rebuilt-wal');
const REPLAY_SHM_BYTES = new TextEncoder().encode('rebuilt-shm');
const WAL_BYTES = new TextEncoder().encode('wal-bytes');
const SHM_BYTES = new TextEncoder().encode('shm-bytes');

// --- 段夹具（真 Op + 真段编码，导入侧 decodeSegment 必须吃得下） --------------

let opSeq = 0;

function pageOp(id: string, c: number, title: string): Op {
  opSeq += 1;
  return {
    op_id: id,
    lamport: { c, d: DEV },
    at: AT,
    actor: DEV,
    target: { table: 'page', id },
    kind: 'upsert',
    payload: {
      workspace_id: 'ws-fixture',
      title,
      parent_id: null,
      sort_key: `A${String(c).padStart(8, '0')}`,
      alive: 1,
      version: 1,
      updated_at: AT,
    },
  };
}

const SEG: Segment = buildSegment(DEV, [pageOp('pg-001', 1, '第一页'), pageOp('pg-002', 2, '第二页')], AT);
const SEG_TEXT = encodeSegment(SEG);
const SEG_NAME = segmentFileName(SEG, SEG_TEXT);
const SEG_OP_IDS = SEG.ops.map((op) => op.op_id);

/** 段目录里的 manifest.json 夹具文本（明文，T80-01 的 `{"devices":{}}` 形态）。 */
const SYNC_MANIFEST_TEXT = '{"schema_ver":10,"devices":{}}';

// --- T80-06（H-10）：包外 op 段夹具 -----------------------------------------
// 「包外页」op：不在包内段里，但**会被 flush 成盘上的段**（H-10 的真机形态）。
// 撤销只还原主库时它留在盘上 → 重启后同步引擎按「账本 ∪ 本地段」对齐 → 页复活。
const OUTSIDE_OP_IDS = ['op-outside-1', 'op-outside-2'];
const OUTSIDE_SEG: Segment = buildSegment(
  DEV,
  [pageOp(OUTSIDE_OP_IDS[0]!, 50, '包外页'), pageOp(OUTSIDE_OP_IDS[1]!, 51, '包外页二')],
  AT,
);
const OUTSIDE_TEXT = encodeSegment(OUTSIDE_SEG);
const OUTSIDE_SEG_NAME = segmentFileName(OUTSIDE_SEG, OUTSIDE_TEXT);
/** 折叠态快照名（导入后由运行时 publishSnapshot 产出；撤销必须把它一并清掉）。 */
const SNAPSHOT_NAME = 'snapshot-000001.json';
const SNAPSHOT_TEXT = '{"snapshot":true}';

// ---------------------------------------------------------------------------
// 内存 IO（导出侧与导入侧共用一套，便于真 roundtrip）
// ---------------------------------------------------------------------------

class MemIo implements PortableImportIo, PortableExportIo {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly writes: string[] = [];
  readonly renames: Array<{ from: string; to: string }> = [];
  /** 写拦截（造「备份失败」等故障注入）。 */
  writeGuard: ((path: string) => void) | null = null;
  /** 删拦截（造「还原前清理失败 / EBUSY」等故障注入）。 */
  removeGuard: ((path: string) => void) | null = null;

  listFiles(dir: string): string[] {
    return [...this.files.keys()].filter((path) => dirname(path) === dir).map((path) => basename(path));
  }

  readFile(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw new Error(`文件不存在：${path}`);
    }
    return bytes;
  }

  size(path: string): number {
    return this.files.get(path)?.byteLength ?? 0;
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  isFile(path: string): boolean {
    return this.files.has(path);
  }

  mkdir(path: string): void {
    this.dirs.add(path);
  }

  rmdir(path: string): void {
    this.dirs.delete(path);
    for (const key of [...this.files.keys()]) {
      if (dirname(key) === path) {
        this.files.delete(key);
      }
    }
  }

  writeFile(path: string, bytes: Uint8Array): void {
    this.writeGuard?.(path);
    this.writes.push(path);
    this.files.set(path, bytes);
  }

  rename(from: string, to: string): void {
    const bytes = this.files.get(from);
    if (bytes === undefined) {
      throw new Error(`改名源不存在：${from}`);
    }
    this.renames.push({ from, to });
    this.files.delete(from);
    this.files.set(to, bytes);
  }

  remove(path: string): void {
    this.removeGuard?.(path);
    this.files.delete(path);
  }
}

// --- 假 Db 端口（不碰 better-sqlite3：本单测的是编排，不是重放语义） ----------

class FakeDb implements PortableImportDb {
  readonly calls: string[] = [];
  ledgerOpIds = new Set<string>();
  failReplay: Error | null = null;
  lastMode: string | null = null;
  lastSegmentsJson = '';
  /** 重放时刻的探针（如「此刻备份已落盘几件」）。 */
  probe: (() => void) | null = null;
  backupFilesAtRebuild = -1;
  /** 重放成功时刻的探针（T80-04：造「重放把库写坏」的失败回滚场景）。 */
  onRebuild: (() => void) | null = null;
  /** T80-04（H-09）：连接存活断言——非 null 时 close/reopen 会校验真实文件句柄态。 */
  connectionLiveness: (() => boolean) | null = null;
  closeCalls = 0;
  reopenCalls = 0;
  connectionOpen = true;

  /**
   * @param dbPath 主库路径（故障注入时用来把库「写坏」——否则还原断言恒真）
   * @param fsIo  同一套内存 IO（故障注入专用）
   */
  constructor(
    private readonly dbPath: string,
    private readonly fsIo: MemIo | null = null,
  ) {}

  async checkpoint(): Promise<void> {
    this.calls.push('checkpoint');
  }

  async listLedgerOpIds(): Promise<string[]> {
    this.calls.push('list');
    return [...this.ledgerOpIds];
  }

  /** T80-04（H-09）：还原前释放句柄（存活夹具下校验「此刻文件确实空闲」）。 */
  async closeConnection(): Promise<void> {
    const live = this.connectionLiveness;
    if (live !== null && live() !== true) {
      throw new Error('closeConnection 调用时文件句柄并未存活（夹具违背前提）');
    }
    this.closeCalls += 1;
    this.connectionOpen = false;
    this.calls.push('close');
  }

  /** T80-04（H-09）：还原后重建连接（必须真的处于释放态）。 */
  async reopenConnection(): Promise<void> {
    const live = this.connectionLiveness;
    if (live !== null && live() !== false) {
      throw new Error('reopenConnection 调用时文件句柄仍存活（未真正释放）');
    }
    this.reopenCalls += 1;
    this.connectionOpen = true;
    this.calls.push('reopen');
  }

  async rebuildFromSegments(segmentsJson: string, mode: 'replace'): Promise<PortableImportReplayData> {
    this.probe?.();
    this.calls.push(`rebuild:${mode}`);
    this.lastMode = mode;
    this.lastSegmentsJson = segmentsJson;
    if (this.failReplay !== null) {
      // 模拟「重放到一半把库写坏了」——还原断言因此不是恒真
      const io = this.fsIo;
      if (io !== null) {
        io.writeFile(this.dbPath, SMASHED_BYTES);
        io.writeFile(`${this.dbPath}-wal`, SMASHED_BYTES);
        io.writeFile(`${this.dbPath}-shm`, SMASHED_BYTES);
      }
      throw this.failReplay;
    }
    const segments = JSON.parse(segmentsJson) as Segment[];
    const ids: string[] = [];
    let ops = 0;
    for (const segment of segments) {
      for (const op of segment.ops) {
        ids.push(op.op_id);
        ops += 1;
      }
    }
    this.onRebuild?.();
    // 模拟 replace 后的「新库态」字节（让撤销/回滚断言不是恒真）
    this.fsIo?.writeFile(this.dbPath, REPLAY_BYTES);
    this.fsIo?.writeFile(`${this.dbPath}-wal`, REPLAY_WAL_BYTES);
    this.fsIo?.writeFile(`${this.dbPath}-shm`, REPLAY_SHM_BYTES);
    this.ledgerOpIds = new Set(ids); // 模拟 replace：账本 = 包内段 op 全集
    return { segments: segments.length, ops, entities: ids.length, mode, keptOps: 0 };
  }
}

// ---------------------------------------------------------------------------
// 夹具：T80-01 导出服务产包 → 本单导入服务消费（真 roundtrip）
// ---------------------------------------------------------------------------

interface Fixture {
  io: MemIo;
  db: FakeDb;
  root: string;
  syncDir: string;
  attachmentsDir: string;
  dbPath: string;
  outDir: string;
  zipPath: string;
  attachmentName: string;
  service: PortableImportService;
}

async function fixture(
  options: {
    readonly localOpIds?: readonly string[];
    readonly flushSegments?: () => Promise<void>;
    readonly pendingOpIds?: () => readonly string[];
    /** T80-06：段目录里的附加文件（相对名 → 文本），用来造「包外段」等形态。 */
    readonly syncExtraFiles?: Readonly<Record<string, string>>;
    /** T80-06：段目录里的非受管文件（如误落的日志）与 `quarantine/` 子目录。 */
    readonly syncNoise?: readonly string[];
    /** T80-06：显式覆盖 syncDir（默认 = `dirname(dbPath)/sync`）。 */
    readonly syncDir?: string;
  } = {},
): Promise<Fixture> {
  const io = new MemIo();
  const root = join('T80-02', 'data').replace('T80-02', '/t80-root');
  const syncDir = options.syncDir ?? join(root, 'sync');
  const attachmentsDir = join(root, 'attachments');
  const dbPath = join(root, 'septcats.db');
  const outDir = join(root, 'export');
  const attachmentName = '中文 图片.png';

  io.files.set(dbPath, DB_BYTES);
  io.files.set(`${dbPath}-wal`, WAL_BYTES);
  io.files.set(`${dbPath}-shm`, SHM_BYTES);
  io.files.set(join(syncDir, SEG_NAME), new TextEncoder().encode(SEG_TEXT));
  io.files.set(join(syncDir, 'manifest.json'), new TextEncoder().encode(SYNC_MANIFEST_TEXT));
  for (const [name, text] of Object.entries(options.syncExtraFiles ?? {})) {
    io.files.set(join(syncDir, name), new TextEncoder().encode(text));
  }
  for (const name of options.syncNoise ?? []) {
    if (name.endsWith('/')) {
      io.mkdir(join(syncDir, name.replace(/\/$/, '')));
    } else {
      io.files.set(join(syncDir, name), new TextEncoder().encode('noise'));
    }
  }
  io.files.set(join(attachmentsDir, attachmentName), PNG_BYTES);

  // ① T80-01 导出侧产包（真 zip，真 checksums）
  const exported = await createPortableExportService({
    dbPath,
    syncDir,
    attachmentsDir,
    libraryName: async () => LIBRARY,
    appVersion: APP_VERSION,
    schemaVersion: async () => SCHEMA_VERSION,
    checkpoint: async () => undefined,
    sealSegments: async () => 0,
    encrypted: () => false,
    pickDirectory: async () => outDir,
    now: () => FIXED_NOW,
    io,
  }).confirm({});
  if (exported.canceled) {
    throw new Error('导出夹具意外取消');
  }

  // ② 导入侧服务（同一套 io）
  const db = new FakeDb(dbPath, io);
  if (options.localOpIds !== undefined) {
    db.ledgerOpIds = new Set(options.localOpIds);
  }
  const service = createPortableImportService({
    dbPath,
    syncDir,
    db,
    schemaVersion: async () => SCHEMA_VERSION,
    pickArchive: async () => null,
    ...(options.flushSegments !== undefined ? { flushSegments: options.flushSegments } : {}),
    ...(options.pendingOpIds !== undefined ? { pendingOpIds: options.pendingOpIds } : {}),
    now: () => FIXED_NOW,
    io,
  });

  return {
    io,
    db,
    root,
    syncDir,
    attachmentsDir,
    dbPath,
    outDir,
    zipPath: exported.path,
    attachmentName,
    service,
  };
}

/** 把已有包解开 → 改内容 → 重新打包（篡改/删段/加密标记三类夹具共用）。 */
function repackage(fx: Fixture, mutate: (entries: Record<string, Uint8Array>) => void): void {
  const entries = unzipSync(fx.io.readFile(fx.zipPath)) as Record<string, Uint8Array>;
  mutate(entries);
  fx.io.writeFile(fx.zipPath, zipSync(entries));
}

/**
 * 主库三件套备份文件（`.bak-portable-*`，**与主库同目录**）。
 * T80-06（H-10）：段目录快照是**子目录** `<备份名>-sync/`，按 dirname 区分，
 * 不计入三件套计数（否则旧断言的 `toHaveLength(3)` 全被段备份文件污染）。
 */
function backupFilesOf(fx: Fixture): string[] {
  const root = dirname(fx.dbPath); // 与 join() 的归一化一致（fx.root 带前导 '/' 会不匹配）
  return [...fx.io.files.keys()]
    .filter((path) => dirname(path) === root && basename(path).includes('.bak-portable-'))
    .sort();
}

/** T80-06（H-10）：某次备份的段目录快照文件名（`<备份名>-sync/` 下的受管文件）。 */
function syncBackupNamesOf(fx: Fixture, backupPath: string): string[] {
  const dir = `${backupPath}-sync`;
  return [...fx.io.files.keys()]
    .filter((path) => dirname(path) === dir)
    .map((path) => basename(path))
    .sort();
}

/** 现段目录里的受管文件名（manifest + 段 + 快照，不含 quarantine/ 与非受管文件）。 */
function syncDirNames(fx: Fixture): string[] {
  return fx.io
    .listFiles(fx.syncDir)
    .filter((name) => /^(manifest\.json|seg-.*\.jsonl(\.enc)?|snapshot-\d+\.json(\.enc)?)$/.test(name))
    .sort();
}

function bytesOf(io: MemIo, path: string): Uint8Array | undefined {
  return io.files.get(path);
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as { code?: unknown } | null)?.code ?? '');
  }
  return '';
}

// ---------------------------------------------------------------------------
// 纯逻辑（packages/sync/src/portableImport.ts）
// ---------------------------------------------------------------------------

describe('便携包读侧纯逻辑', () => {
  it('备份名与三件套：bak-portable-<时间戳>，可被反解回主库路径', () => {
    const dbPath = '/data/septcats.db';
    const backup = portableBackupName(dbPath, FIXED_NOW);
    expect(backup).toMatch(/^\/data\/septcats\.db\.bak-portable-\d{8}-\d{6}$/);
    expect(portableBackupOrigin(backup)).toBe(dbPath);
    expect(portableBackupOrigin('/data/septcats.db.bak-v9')).toBeNull();
    const plan = portableBackupPlan(dbPath, FIXED_NOW);
    expect(plan.map((file) => file.from)).toEqual([dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
    expect(plan.map((file) => file.to)).toEqual([backup, `${backup}-wal`, `${backup}-shm`]);
    // 还原计划 = 备份 → 现库（方向相反）
    const restore = portableRestorePlan(backup);
    expect(restore?.map((file) => file.to)).toEqual([dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
    expect(portableRestorePlan('/data/septcats.db.bak-v9')).toBeNull();
  });

  it('条目分类：manifest/db/segment/attachment 四态，其余一律 null（导入侧忽略）', () => {
    expect(classifyPortableEntry(PORTABLE_MANIFEST_NAME)).toBe('manifest');
    expect(classifyPortableEntry(PORTABLE_DB_ENTRY)).toBe('db');
    expect(classifyPortableEntry(`sync/${SEG_NAME}`)).toBe('segment');
    expect(classifyPortableEntry('attachments/abc.png')).toBe('attachment');
    expect(classifyPortableEntry('sync/manifest.json')).toBeNull();
    expect(classifyPortableEntry('sync/snapshot-000001.json')).toBeNull();
    expect(classifyPortableEntry('logs/app.log')).toBeNull();
    expect(portableSegmentNames([`sync/${SEG_NAME}`, 'sync/manifest.json'])).toEqual([`sync/${SEG_NAME}`]);
    expect(portableAttachmentNames(['attachments/a.png', 'sync/manifest.json'])).toEqual(['attachments/a.png']);
  });

  it('加密包判定：manifest.encrypted=true 或包内含 .enc 条目（导入侧硬闸）', () => {
    const manifest = buildPortableManifest({
      library: LIBRARY,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_NOW,
      entries: [],
    });
    expect(isPortableEncrypted(manifest, [`sync/${SEG_NAME}`])).toBe(false);
    expect(isPortableEncrypted({ ...manifest, encrypted: true } as typeof manifest, [`sync/${SEG_NAME}`])).toBe(true);
    expect(isPortableEncrypted(manifest, ['sync/seg-00000001-dev00001-000001.jsonl.enc'])).toBe(true);
  });

  it('清单闸：非 JSON / 非本格式 / 版本过高 / 缺 entries → E_PORTABLE_BAD_MANIFEST', async () => {
    expect(await codeOf(async () => parsePortableManifest(new TextEncoder().encode('{oops')))).toBe(
      'E_PORTABLE_BAD_MANIFEST',
    );
    expect(
      await codeOf(async () => parsePortableManifest(new TextEncoder().encode('{"format":"other"}'))),
    ).toBe('E_PORTABLE_BAD_MANIFEST');
    const base = buildPortableManifest({
      library: LIBRARY,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_NOW,
      entries: [],
    });
    const tooNew = encodePortableManifest({ ...base, formatVersion: 99 });
    expect(await codeOf(async () => parsePortableManifest(tooNew))).toBe('E_PORTABLE_BAD_MANIFEST');
    const ok = parsePortableManifest(encodePortableManifest(base));
    expect(ok.format).toBe('septcats-portable');
    expect(ok.formatVersion).toBe(1);
  });

  it('checksums 全验：相符全过；篡改/缺/多各记一面', () => {
    const segBytes = new TextEncoder().encode(SEG_TEXT);
    const entry: PortableEntryMeta = {
      name: `sync/${SEG_NAME}`,
      kind: 'segment',
      bytes: segBytes.byteLength,
      sha256: sha256Hex(segBytes),
      stored: false,
    };
    const manifest = buildPortableManifest({
      library: LIBRARY,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_NOW,
      entries: [entry],
    });
    const good = verifyPortableChecksums({ [`sync/${SEG_NAME}`]: segBytes }, manifest);
    expect(good.checked).toBe(1);
    expect(good.mismatched).toEqual([]);
    expect(good.missing).toEqual([]);
    expect(good.extra).toEqual([]);

    const tampered = verifyPortableChecksums(
      { [`sync/${SEG_NAME}`]: new TextEncoder().encode(`${SEG_TEXT}x`) },
      manifest,
    );
    expect(tampered.mismatched).toEqual([`sync/${SEG_NAME}`]);
    expect(verifyPortableChecksums({}, manifest).missing).toEqual([`sync/${SEG_NAME}`]);
    expect(
      verifyPortableChecksums({ [`sync/${SEG_NAME}`]: segBytes, 'attachments/x.png': PNG_BYTES }, manifest).extra,
    ).toEqual(['attachments/x.png']);
  });

  it('段数自检：实收段数 ≠ manifest.segments → E_PORTABLE_SEGMENT_COUNT（缺段不重放）', async () => {
    const manifest = buildPortableManifest({
      library: LIBRARY,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_NOW,
      entries: [],
    });
    expect(manifest.segments).toBe(0);
    expect(assertPortableSegmentCount(0, manifest)).toBe(0);
    expect(await codeOf(async () => assertPortableSegmentCount(1, manifest))).toBe('E_PORTABLE_SEGMENT_COUNT');
  });

  it('zip slip 条目名：上跳/绝对/反斜杠/盘符 → E_ENTRY_NAME', async () => {
    expect(await codeOf(async () => assertPortableImportEntryNames(['sync/a.jsonl']))).toBe('');
    for (const bad of ['../evil.db', '/abs/evil.db', 'a\\b', 'C:/evil.db', 'dir/']) {
      expect(await codeOf(async () => assertPortableImportEntryNames([bad]))).toBe('E_ENTRY_NAME');
    }
  });

  it('schema 兼容：包版本 ≤ 当前才可导入（来自更新版本的包要拒）', () => {
    expect(portableSchemaCompatible(9, 10)).toBe(true);
    expect(portableSchemaCompatible(10, 10)).toBe(true);
    expect(portableSchemaCompatible(11, 10)).toBe(false);
  });

  // --- T80-06（H-10）：段目录快照/还原的纯判据 -----------------------------

  it('段目录快照目录名：<备份名>-sync，可由 backupPath 直接反解', () => {
    const backupPath = '/data/septcats.db.bak-portable-20260925-171646';
    const dir = portableSyncBackupDir(backupPath);
    expect(dir).toBe('/data/septcats.db.bak-portable-20260925-171646-sync');
    // 与三件套还原计划同源（from=备份，to=现库），二者拼起来就是完整还原面
    expect(portableRestorePlan(backupPath)?.map((file) => file.to)).toEqual([
      '/data/septcats.db',
      '/data/septcats.db-wal',
      '/data/septcats.db-shm',
    ]);
  });

  it('段文件判据：只认明文 seg-*.jsonl（.enc 与网盘副本各按规则处理）', () => {
    expect(isSyncSegmentFileName('seg-00000001-dev00001-000001-abcdef01.jsonl')).toBe(true);
    // 旧命名（无摘要）与网盘副本仍被识别
    expect(isSyncSegmentFileName('seg-00000001-dev00001-000001.jsonl')).toBe(true);
    expect(isSyncSegmentFileName('seg-00000001-dev00001-000001-abcd1234 (1).jsonl')).toBe(true);
    // 密文段：本侧无 DEK，不纳入「段 op_id 比对」
    expect(isSyncSegmentFileName('seg-00000001-dev00001-000001-abcdef01.jsonl.enc')).toBe(false);
    // 快照/manifest/非受管一律不是段
    expect(isSyncSegmentFileName(SNAPSHOT_NAME)).toBe(false);
    expect(isSyncSegmentFileName(PORTABLE_SYNC_MANIFEST_NAME)).toBe(false);
    expect(isSyncSegmentFileName('sync.log')).toBe(false);
  });

  it('快照判据与受管判据：快照/密文段计入快照面，quarantine 与非受管一律出局', () => {
    expect(isSyncSnapshotFileName('snapshot-000001.json')).toBe(true);
    expect(isSyncSnapshotFileName('snapshot-000001.json.enc')).toBe(true);
    expect(isSyncSnapshotFileName('snapshot-abc.json')).toBe(false);
    // 受管 = manifest + 段（含 .enc/副本）+ 快照
    for (const name of [
      PORTABLE_SYNC_MANIFEST_NAME,
      'seg-00000001-dev00001-000001-abcdef01.jsonl',
      'seg-00000001-dev00001-000001-abcdef01.jsonl.enc',
      'snapshot-000001.json',
      'snapshot-000001.json.enc',
    ]) {
      expect(isManagedSyncFileName(name)).toBe(true);
    }
    // quarantine/ 是子目录（listFiles 非递归只回目录名）+ 非受管文件 → 绝不入备份
    for (const name of ['quarantine', 'quarantine/', 'sync.log', 'manifest-portable.json', '.hidden']) {
      expect(isManagedSyncFileName(name)).toBe(false);
    }
  });

  it('本地段 op_id 全集：解码成功段取并集，解不开的段只计数不算覆盖', () => {
    const good = localSegmentOpIds([SEG_TEXT, OUTSIDE_TEXT]);
    expect([...good.opIds].sort()).toEqual([...SEG_OP_IDS, ...OUTSIDE_OP_IDS].sort());
    expect(good.undecodable).toBe(0);

    const mixed = localSegmentOpIds([SEG_TEXT, 'half-written']);
    expect([...mixed.opIds].sort()).toEqual([...SEG_OP_IDS].sort());
    expect(mixed.undecodable).toBe(1);

    expect([...localSegmentOpIds([]).opIds]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 服务：三段式换库（内存 IO + 假 Db 端口）
// ---------------------------------------------------------------------------

describe('便携包导入服务', () => {
  it('roundtrip：T80-01 导出夹具产包 → 导入 counts/段数/op 数逐值等，mode 显式 replace', async () => {
    const fx = await fixture();
    const writesBeforePlan = fx.io.writes.length; // 导出夹具自己写过 .tmp/.zip
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.zipPath).toBe(fx.zipPath);
    expect(plan.manifest.library).toBe(LIBRARY);
    expect(plan.manifest.appVersion).toBe(APP_VERSION);
    expect(plan.manifest.segments).toBe(1);
    // 条目数 = 清单 + 主库 + 段 + 附件（清单自身也占一个包内条目）
    expect(plan.counts).toEqual({ segments: 1, attachments: 1, db: 1, entries: 4 });
    expect(plan.counts.segments).toBe(plan.manifest.segments);
    expect(plan.schema).toEqual({ package: SCHEMA_VERSION, current: SCHEMA_VERSION, compatible: true });
    expect(plan.target).toEqual({ ledgerOps: 0, uncovered: 0, willReplace: true });
    expect(plan.blocked).toBeNull();
    // plan 只读：零落盘
    expect(fx.io.writes.length).toBe(writesBeforePlan);

    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    expect(done.replay).toEqual({ segments: 1, ops: 2, entities: 2, mode: 'replace', keptOps: 0 });
    // 重放收到的就是包内段（逐 op_id 对得上）
    const replayed = JSON.parse(fx.db.lastSegmentsJson) as Segment[];
    expect(replayed[0]?.seg_id).toBe(SEG.seg_id);
    expect(replayed.flatMap((segment) => segment.ops.map((op) => op.op_id))).toEqual(SEG_OP_IDS);
    expect(fx.db.lastMode).toBe('replace');
  });

  it('三段式顺序：备份先于重放（重放时刻三件套已在），checkpoint 先于备份', async () => {
    const fx = await fixture();
    fx.db.probe = () => {
      fx.db.backupFilesAtRebuild = backupFilesOf(fx).length;
    };
    await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    expect(fx.db.backupFilesAtRebuild).toBe(3); // 主库 + -wal + -shm
    expect(fx.db.calls.indexOf('checkpoint')).toBeGreaterThanOrEqual(0);
    expect(fx.db.calls.indexOf('rebuild:replace')).toBeGreaterThan(fx.db.calls.indexOf('checkpoint'));
  });

  it('备份名与内容：bak-portable-<时间戳> 三件套，逐字节等于原库', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    const backup = portableBackupName(fx.dbPath, FIXED_NOW);
    expect(done.backupPath).toBe(backup);
    expect(done.backupFiles).toEqual([backup, `${backup}-wal`, `${backup}-shm`]);
    expect([...bytesOf(fx.io, backup)!]).toEqual([...DB_BYTES]);
    expect([...bytesOf(fx.io, `${backup}-wal`)!]).toEqual([...WAL_BYTES]);
    expect([...bytesOf(fx.io, `${backup}-shm`)!]).toEqual([...SHM_BYTES]);
  });

  it('幂等：同包重复导入同结果（第二遍计划不被自己的预检拒，counts 逐值等）', async () => {
    const fx = await fixture();
    const first = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    const second = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in first || 'canceled' in second) {
      throw new Error('unexpected cancel');
    }
    expect(second.replay).toEqual(first.replay);
    const planAgain = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in planAgain) {
      throw new Error('unexpected cancel');
    }
    expect(planAgain.target).toEqual({ ledgerOps: 2, uncovered: 0, willReplace: true });
    expect(planAgain.blocked).toBeNull();
  });

  it('冲突预检：本机有包未覆盖的 op → plan 记 blocked、execute 抛 E_PORTABLE_NOT_EMPTY（不 merge）', async () => {
    const fx = await fixture({ localOpIds: [...SEG_OP_IDS, 'op-local-only-1'] });
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target).toEqual({ ledgerOps: 3, uncovered: 1, willReplace: false });
    expect(plan.blocked?.code).toBe('E_PORTABLE_NOT_EMPTY');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_NOT_EMPTY',
    );
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
    expect(backupFilesOf(fx)).toHaveLength(0); // 零落盘
  });

  it('checksums 篡改：整包拒绝 E_PORTABLE_CHECKSUM，零落盘不建备份', async () => {
    const fx = await fixture();
    repackage(fx, (entries) => {
      const seg = entries[`sync/${SEG_NAME}`];
      entries[`sync/${SEG_NAME}`] = new TextEncoder().encode(`${new TextDecoder().decode(seg)}x`);
    });
    expect(await codeOf(() => fx.service.plan({ zipPath: fx.zipPath }))).toBe('E_PORTABLE_CHECKSUM');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_CHECKSUM',
    );
    expect(backupFilesOf(fx)).toHaveLength(0);
    expect(fx.db.calls).toEqual([]);
  });

  it('段数自检：清单声称 2 段、实收 1 段（checksums 全过也拦）→ E_PORTABLE_SEGMENT_COUNT，零落盘', async () => {
    const fx = await fixture();
    repackage(fx, (entries) => {
      const manifest = JSON.parse(new TextDecoder().decode(entries[PORTABLE_MANIFEST_NAME]!)) as {
        segments: number;
      };
      manifest.segments = 2;
      entries[PORTABLE_MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest));
    });
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_SEGMENT_COUNT',
    );
    expect(backupFilesOf(fx)).toHaveLength(0);
    expect(fx.db.calls).toEqual([]);
  });

  it('缺条目（段被删）→ checksums 的 missing 面先拦下 E_PORTABLE_CHECKSUM，零落盘', async () => {
    const fx = await fixture();
    repackage(fx, (entries) => {
      delete entries[`sync/${SEG_NAME}`];
    });
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_CHECKSUM',
    );
    expect(backupFilesOf(fx)).toHaveLength(0);
  });

  it('zip slip：包内上跳条目名 → E_ENTRY_NAME，零落盘', async () => {
    const fx = await fixture();
    fx.io.writeFile(fx.zipPath, zipSync({ '../evil.db': DB_BYTES } as Record<string, Uint8Array>));
    expect(await codeOf(() => fx.service.plan({ zipPath: fx.zipPath }))).toBe('E_ENTRY_NAME');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe('E_ENTRY_NAME');
    expect(backupFilesOf(fx)).toHaveLength(0);
  });

  it('半截 zip：结构化 E_PORTABLE_BAD_ZIP（不是未捕获异常）', async () => {
    const fx = await fixture();
    const full = fx.io.readFile(fx.zipPath);
    fx.io.writeFile(fx.zipPath, full.slice(0, Math.floor(full.byteLength / 2)));
    expect(await codeOf(() => fx.service.plan({ zipPath: fx.zipPath }))).toBe('E_PORTABLE_BAD_ZIP');
    // 非 zip 文件同样结构化拒绝
    fx.io.writeFile(fx.zipPath, new TextEncoder().encode('not-a-zip-at-all'));
    expect(await codeOf(() => fx.service.plan({ zipPath: fx.zipPath }))).toBe('E_PORTABLE_BAD_ZIP');
  });

  it('加密包：E_PORTABLE_ENCRYPTED_UNSUPPORTED（清单标记与 .enc 条目两路都拒）', async () => {
    const fx = await fixture();
    repackage(fx, (entries) => {
      const manifest = JSON.parse(new TextDecoder().decode(entries[PORTABLE_MANIFEST_NAME]!)) as {
        encrypted?: boolean;
      };
      manifest.encrypted = true;
      entries[PORTABLE_MANIFEST_NAME] = new TextEncoder().encode(JSON.stringify(manifest));
    });
    await expect(fx.service.plan({ zipPath: fx.zipPath })).rejects.toMatchObject({
      code: 'E_PORTABLE_ENCRYPTED_UNSUPPORTED',
      message: PORTABLE_IMPORT_ENCRYPTED_MESSAGE,
    });
    expect(backupFilesOf(fx)).toHaveLength(0);
  });

  it('失败注入：重放中途抛错 → 原库三件套逐字节还原 + rolledBack 标记', async () => {
    const fx = await fixture();
    fx.db.failReplay = new Error('注入的重放失败（磁盘满）');
    await expect(fx.service.execute({ zipPath: fx.zipPath, confirm: true })).rejects.toMatchObject({
      rolledBack: true,
    });
    // 逐字节还原断言
    expect([...fx.io.readFile(fx.dbPath)]).toEqual([...DB_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-wal`)]).toEqual([...WAL_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-shm`)]).toEqual([...SHM_BYTES]);
    // 备份仍在（可人工/撤销入口复核）
    expect(backupFilesOf(fx)).toHaveLength(3);
  });

  it('无备份不落库：备份写失败 → E_PORTABLE_BACKUP_FAILED，重放从未被调用', async () => {
    const fx = await fixture();
    fx.io.writeGuard = (path) => {
      if (path.includes('.bak-portable-')) {
        throw new Error('注入的备份写失败（磁盘满）');
      }
    };
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_BACKUP_FAILED',
    );
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
    expect(backupFilesOf(fx)).toHaveLength(0); // 半成品已清理
    expect([...fx.io.readFile(fx.dbPath)]).toEqual([...DB_BYTES]);
  });

  it('撤销入口：revert 把备份三件套逐字节还原回现库', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // 导入后「库」被改写（这里用直接覆写模拟后续改动）
    fx.io.writeFile(fx.dbPath, new TextEncoder().encode('changed-after-import'));
    const reverted = await fx.service.revert({ backupPath: done.backupPath, confirm: true });
    expect(reverted.ok).toBe(true);
    // T80-06（H-10）：还原面 = 主库三件套 **+ 段目录**（既有三件套语义/顺序不动，
    // 段目录条目紧随其后）。旧断言只认三件套，会漏掉段目录的还原承诺。
    expect(reverted.restoredFiles.slice(0, 3)).toEqual([fx.dbPath, `${fx.dbPath}-wal`, `${fx.dbPath}-shm`]);
    expect(reverted.restoredFiles).toHaveLength(3 + syncDirNames(fx).length);
    expect(reverted.restoredFiles.slice(3)).toContain(join(fx.syncDir, SEG_NAME));
    expect(reverted.restoredFiles.slice(3)).toContain(join(fx.syncDir, PORTABLE_SYNC_MANIFEST_NAME));
    expect([...fx.io.readFile(fx.dbPath)]).toEqual([...DB_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-wal`)]).toEqual([...WAL_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-shm`)]).toEqual([...SHM_BYTES]);
  });

  it('dir 显式契约：目录内取最新 septcats-portable-*.zip（zipPath 缺省时）', async () => {
    const fx = await fixture();
    const planned = await fx.service.plan({ dir: fx.outDir });
    if ('canceled' in planned) {
      throw new Error('unexpected cancel');
    }
    expect(planned.zipPath).toBe(fx.zipPath);
    expect(await codeOf(() => fx.service.plan({ dir: join(fx.root, 'nowhere') }))).toBe('E_MALFORMED');
    // 两者都缺且未注入对话框 → E_MALFORMED（不静默猜测）
    const bare = createPortableImportService({
      dbPath: fx.dbPath,
      db: fx.db,
      schemaVersion: async () => SCHEMA_VERSION,
      now: () => FIXED_NOW,
      io: fx.io,
    });
    expect(await codeOf(() => bare.plan({}))).toBe('E_MALFORMED');
  });

  it('confirm 守卫与 IPC：confirm 必须显式 true；service=null → E_INVARIANT', async () => {
    const fx = await fixture();
    await expect(fx.service.execute({ zipPath: fx.zipPath })).rejects.toMatchObject({
      code: 'E_MALFORMED',
      message: PORTABLE_IMPORT_CONFIRM_MESSAGE,
    });
    await expect(fx.service.revert({ backupPath: fx.dbPath, confirm: true })).rejects.toMatchObject({
      code: 'E_MALFORMED',
    });

    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerPortableImportIpc(null, { handle: (channel, listener) => handlers.set(channel, listener) });
    expect(handlers.has('portable:import:plan')).toBe(true);
    expect(handlers.has('portable:import:execute')).toBe(true);
    expect(handlers.has('portable:import:revert')).toBe(true);
    await expect(handlers.get('portable:import:plan')!({ zipPath: fx.zipPath })).rejects.toThrow(/E_INVARIANT/);
    await expect(handlers.get('portable:import:execute')!({ confirm: true })).rejects.toThrow(/E_INVARIANT/);
    await expect(handlers.get('portable:import:revert')!({ backupPath: 'x' })).rejects.toThrow(/E_MALFORMED/);
    // 非对象入参 → E_MALFORMED（不信任 renderer）
    await expect(handlers.get('portable:import:plan')!(null)).rejects.toThrow(/E_MALFORMED/);
  });
});

// ---------------------------------------------------------------------------
// T80-04（H-08）：plan/execute 覆盖度预检对「未 flush 的 op」不再盲区
// ---------------------------------------------------------------------------

describe('便携包覆盖度预检：未 flush 缓冲并集（T80-04 H-08）', () => {
  it('时序 run-A（缓冲有 op、账本无）：plan 必 blocked；execute 强制 flush 后必 blocked', async () => {
    // 模拟 SyncRuntime 攒段缓冲：新建页的 op_id 在缓冲里，尚未落 op_ledger。
    const bufferedOpId = 'op-buffered-outside-1';
    // 缓冲态真源 = FakeDb.ledgerOpIds（尚未有该 op）；flush = 把缓冲 op 落进账本
    // （既有 flushAndPublish 的净效果）。闭包引用 fx 在创建后求值，无 TDZ 问题。
    const fx = await fixture({
      flushSegments: async () => {
        fx.db.ledgerOpIds.add(bufferedOpId);
      },
      pendingOpIds: () => (fx.db.ledgerOpIds.has(bufferedOpId) ? [] : [bufferedOpId]),
    });

    // plan 不 flush（只读零副作用）：并集判据必须已看见缓冲 op → blocked。
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(1);
    expect(plan.target.willReplace).toBe(false);
    expect(plan.blocked?.code).toBe('E_PORTABLE_NOT_EMPTY');

    // execute：入口强制 flush → 缓冲 op 落账 → 覆盖度复检仍 blocked（先 flush 再判）。
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_NOT_EMPTY',
    );
    // 证明确实走过 flush（否则账本还是空的）
    expect(fx.db.ledgerOpIds.has(bufferedOpId)).toBe(true);
    // 零落盘：没建备份、没重放
    expect(backupFilesOf(fx)).toHaveLength(0);
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
  });

  it('时序 run-B（flush 后账本有 op）：plan 与 execute 都 blocked E_PORTABLE_NOT_EMPTY', async () => {
    const fx = await fixture({ localOpIds: [...SEG_OP_IDS, 'op-local-only-1'] });
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(1);
    expect(plan.blocked?.code).toBe('E_PORTABLE_NOT_EMPTY');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_NOT_EMPTY',
    );
    expect(backupFilesOf(fx)).toHaveLength(0);
  });

  it('缓冲 op 已被包覆盖（本机导出场景）：并集后 uncoverable=0，不误拒', async () => {
    // 缓冲里的 op 恰是包内段 op（刚导出就导入）：并集不引入新未覆盖项 → 放行。
    const fx = await fixture({
      pendingOpIds: () => [...SEG_OP_IDS],
    });
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target).toEqual({ ledgerOps: 0, uncovered: 0, willReplace: true });
    expect(plan.blocked).toBeNull();
  });

  it('execute 前封段失败 → E_PORTABLE_FLUSH_FAILED，零落盘（不静默放过盲区）', async () => {
    const fx = await fixture({
      flushSegments: async () => {
        throw new Error('注入的封段失败');
      },
    });
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_FLUSH_FAILED',
    );
    expect(backupFilesOf(fx)).toHaveLength(0);
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T80-04（H-09）：revert / 回滚在**连接存活**时必须成功，且失败不留半成品
// ---------------------------------------------------------------------------

describe('便携包还原原子性与连接释放（T80-04 H-09）', () => {
  it('execute 重放失败回滚：先关连接 → 还原 → 重开；三件套逐字节回调用前', async () => {
    const fx = await fixture();
    // 导入前（= 调用前）三件套字节；FakeDb 重放成功会写 REPLAY_*，失败注入写 SMASHED。
    const before = {
      db: [...fx.io.readFile(fx.dbPath)],
      wal: [...fx.io.readFile(`${fx.dbPath}-wal`)],
      shm: [...fx.io.readFile(`${fx.dbPath}-shm`)],
    };
    // 造「重放已把库写坏后才失败」的真实形态（否则还原断言恒真）。
    fx.db.onRebuild = () => {
      throw new Error('注入的重放失败（重放已部分落盘）');
    };
    await expect(fx.service.execute({ zipPath: fx.zipPath, confirm: true })).rejects.toMatchObject({
      rolledBack: true,
    });
    // 三件套与调用前逐字节一致
    expect([...fx.io.readFile(fx.dbPath)]).toEqual(before.db);
    expect([...fx.io.readFile(`${fx.dbPath}-wal`)]).toEqual(before.wal);
    expect([...fx.io.readFile(`${fx.dbPath}-shm`)]).toEqual(before.shm);
    // 连接释放/重建确实发生，且顺序 = close → … → reopen
    expect(fx.db.closeCalls).toBe(1);
    expect(fx.db.reopenCalls).toBe(1);
    const closeAt = fx.db.calls.indexOf('close');
    const reopenAt = fx.db.calls.indexOf('reopen');
    expect(closeAt).toBeGreaterThanOrEqual(0);
    expect(reopenAt).toBeGreaterThan(closeAt);
    expect(fx.db.connectionOpen).toBe(true);
  });

  it('revert 必败（删到一半失败）→ 三件套逐字节回到调用前，不留半成品', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // 调用前状态 = 重放后的新库态（REPLAY_*）
    const before = {
      db: [...fx.io.readFile(fx.dbPath)],
      wal: [...fx.io.readFile(`${fx.dbPath}-wal`)],
      shm: [...fx.io.readFile(`${fx.dbPath}-shm`)],
    };
    // 故障注入：删到第三件（-shm）才失败 → 前两件已被删（原缺陷的「半成品」形态）。
    fx.io.removeGuard = (path) => {
      if (path === `${fx.dbPath}-shm`) {
        throw new Error('注入的删除失败（模拟 EBUSY）');
      }
    };
    await expect(fx.service.revert({ backupPath: done.backupPath, confirm: true })).rejects.toMatchObject({
      code: 'E_PORTABLE_ROLLBACK_FAILED',
    });
    // 失败后必须逐字节回到调用前（-wal/-shm 不得停在被删态）
    expect([...fx.io.readFile(fx.dbPath)]).toEqual(before.db);
    expect([...fx.io.readFile(`${fx.dbPath}-wal`)]).toEqual(before.wal);
    expect([...fx.io.readFile(`${fx.dbPath}-shm`)]).toEqual(before.shm);
    // 连接仍被重建（不留「文件在、连接关」的半态）
    expect(fx.db.connectionOpen).toBe(true);
  });

  it('revert 成功：先 close 释放句柄 → 还原 → reopen（撤销按钮真能点活）', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    fx.db.calls.length = 0;
    fx.db.closeCalls = 0;
    fx.db.reopenCalls = 0;
    const reverted = await fx.service.revert({ backupPath: done.backupPath, confirm: true });
    expect(reverted.ok).toBe(true);
    expect(fx.db.calls).toEqual(['close', 'reopen']);
    expect(fx.db.connectionOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T80-06（H-10）：撤销/回滚必须连 `data/sync/` 段目录一并还原
//
// 缺陷：撤销只还原主库三件套 → 包外页 op 所在的段文件留在盘上 → 重启后同步引擎按
// 「账本 ∪ 本地段」再对齐 → 包外页复活（P5-3 红），撤销承诺落空。
// ---------------------------------------------------------------------------

/** 把「包外页」flush 成盘上的段（H-10 真机形态：包外 op 在段里而不在包里）。 */
function addOutsideSegment(fx: Fixture): void {
  fx.io.writeFile(join(fx.syncDir, OUTSIDE_SEG_NAME), new TextEncoder().encode(OUTSIDE_TEXT));
}

describe('便携包段目录快照与还原（T80-06 H-10）', () => {
  it('execute 备份：三件套 + 段目录快照（manifest/段/快照），quarantine 与非受管不入', async () => {
    const fx = await fixture({
      syncNoise: ['quarantine/', 'sync.log'],
      syncExtraFiles: { [SNAPSHOT_NAME]: SNAPSHOT_TEXT },
    });
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // 段目录快照 = 备份时刻的受管文件集（与现目录受管文件逐名一致）
    const expected = syncDirNames(fx);
    expect(expected).toContain(PORTABLE_SYNC_MANIFEST_NAME);
    expect(expected).toContain(SEG_NAME);
    expect(expected).toContain(SNAPSHOT_NAME);
    expect(syncBackupNamesOf(fx, done.backupPath)).toEqual(expected);
    // 逐字节等于源（manifest 也在，红线要求）
    for (const name of expected) {
      expect([...fx.io.readFile(join(`${done.backupPath}-sync`, name))]).toEqual([
        ...fx.io.readFile(join(fx.syncDir, name)),
      ]);
    }
    // quarantine/ 与非受管文件既不备份、也不被删（不动非受管面）
    expect(fx.io.exists(join(`${done.backupPath}-sync`, 'quarantine'))).toBe(false);
    expect(fx.io.exists(join(`${done.backupPath}-sync`, 'sync.log'))).toBe(false);
    expect(fx.io.exists(join(fx.syncDir, 'sync.log'))).toBe(true);
  });

  it('revert 后段目录逐文件 = 备份态（含 manifest）：包外段被清、旧段回写、快照不残留', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    const manifestBefore = [...fx.io.readFile(join(fx.syncDir, PORTABLE_SYNC_MANIFEST_NAME))];
    // 导入后：包外页被 flush 成段 + 折叠出快照（H-10 真机形态）
    addOutsideSegment(fx);
    fx.io.writeFile(join(fx.syncDir, SNAPSHOT_NAME), new TextEncoder().encode(SNAPSHOT_TEXT));
    // 既有的包内段也被改写（模拟导入后同步引擎合并改写）
    fx.io.writeFile(join(fx.syncDir, SEG_NAME), new TextEncoder().encode('rewritten-after-import'));

    const reverted = await fx.service.revert({ backupPath: done.backupPath, confirm: true });
    expect(reverted.ok).toBe(true);
    // 段目录回到备份时刻的**文件集**：包外段与导入后快照都不在，包内段逐字节回写
    expect(syncDirNames(fx)).toEqual(syncBackupNamesOf(fx, done.backupPath));
    expect(fx.io.exists(join(fx.syncDir, OUTSIDE_SEG_NAME))).toBe(false);
    expect(fx.io.exists(join(fx.syncDir, SNAPSHOT_NAME))).toBe(false);
    expect([...fx.io.readFile(join(fx.syncDir, SEG_NAME))]).toEqual([...new TextEncoder().encode(SEG_TEXT)]);
    expect([...fx.io.readFile(join(fx.syncDir, PORTABLE_SYNC_MANIFEST_NAME))]).toEqual(manifestBefore);
    // 主库三件套同时还原（既有语义不动）
    expect([...fx.io.readFile(fx.dbPath)]).toEqual([...DB_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-wal`)]).toEqual([...WAL_BYTES]);
    expect([...fx.io.readFile(`${fx.dbPath}-shm`)]).toEqual([...SHM_BYTES]);
  });

  it('包外页 op 撤销后不再经本地段可见（重启对齐 = 账本 ∪ 本地段，P5-3 的机器判据）', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    addOutsideSegment(fx);
    // 撤销前：重启对齐面（本地段 op_id 全集）含包外页 op
    const beforeOps = localSegmentOpIds([new TextDecoder().decode(fx.io.readFile(join(fx.syncDir, OUTSIDE_SEG_NAME)))]);
    expect([...beforeOps.opIds].sort()).toEqual([...OUTSIDE_OP_IDS].sort());

    await fx.service.revert({ backupPath: done.backupPath, confirm: true });

    // 撤销后：段目录里再没有任何段承载包外 op → 重启后同步引擎无从复活它
    const afterTexts = syncDirNames(fx)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => new TextDecoder().decode(fx.io.readFile(join(fx.syncDir, name))));
    const afterOps = localSegmentOpIds(afterTexts);
    for (const opId of OUTSIDE_OP_IDS) {
      expect(afterOps.opIds.has(opId)).toBe(false);
    }
    expect(fx.io.exists(join(fx.syncDir, OUTSIDE_SEG_NAME))).toBe(false);
  });

  it('coverage 补「本地盘上段有而包里没有的 op_id」：包外段 → blocked E_PORTABLE_NOT_EMPTY', async () => {
    const fx = await fixture();
    // 账本为空、缓冲为空——只有**盘上段**里有包外 op（旧实现唯一盲区）
    addOutsideSegment(fx);
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(OUTSIDE_OP_IDS.length);
    expect(plan.target.willReplace).toBe(false);
    expect(plan.blocked?.code).toBe('E_PORTABLE_NOT_EMPTY');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_NOT_EMPTY',
    );
    expect(backupFilesOf(fx)).toHaveLength(0); // 零落盘：没建备份、没重放
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
  });

  it('coverage 不误拒：本地段 op 全在包内（本机导出常态）→ uncovered=0 放行', async () => {
    const fx = await fixture();
    // 默认段目录里就是包内那一段：盘上段与包内段同集 → 不得误判未覆盖
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(0);
    expect(plan.blocked).toBeNull();
  });

  it('快照不参与覆盖度（便携包明确排除 snapshot-*.json）→ 折叠过段/快照的库不被永久误拒', async () => {
    const fx = await fixture();
    // 仅提高快照：若把快照 op 计入本机集合，任何折叠过的库都会 uncovered>0 永久拒导。
    // 本夹具的快照是**不可解码**文本，正是最坏形态。
    fx.io.writeFile(join(fx.syncDir, SNAPSHOT_NAME), new TextEncoder().encode(SNAPSHOT_TEXT));
    const plan = await fx.service.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(0);
    expect(plan.blocked).toBeNull();
  });

  it('execute 成功态：段目录仍 = 备份态 + 包内段（账本与段一致，无孤儿段）', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // execute 不改写段目录（replace 只在 DB 投影层）：段目录 = 备份态；账本 = 包内段 op。
    // 二者一致 → 重启后同步引擎首轮一致性校验不会触发毁灭性重建（T82-01 同构土壤）。
    expect(syncDirNames(fx)).toEqual(syncBackupNamesOf(fx, done.backupPath));
    const diskOps = localSegmentOpIds(
      syncDirNames(fx)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => new TextDecoder().decode(fx.io.readFile(join(fx.syncDir, name)))),
    );
    expect([...diskOps.opIds].sort()).toEqual([...SEG_OP_IDS].sort());
    // 账本 = 包内段 op（FakeDb 的 replace 语义）→ 与盘上段逐 op_id 一致
    expect([...fx.db.ledgerOpIds].sort()).toEqual([...diskOps.opIds].sort());
  });

  it('execute 失败回滚：段目录一并回到调用前（包外段仍在，删除的段被写回）', async () => {
    const fx = await fixture();
    const beforeNames = syncDirNames(fx);
    const beforeSeg = [...fx.io.readFile(join(fx.syncDir, SEG_NAME))];
    // 重放中途失败：回滚面必须同时覆盖三件套与段目录
    fx.db.onRebuild = () => {
      throw new Error('注入的重放失败（重放已部分落盘）');
    };
    // 重放副作用：段被删除 + 新增包外段（模拟同步运行时在导入窗口内的产出）
    fx.db.probe = () => {
      fx.io.remove(join(fx.syncDir, SEG_NAME));
      addOutsideSegment(fx);
    };
    await expect(fx.service.execute({ zipPath: fx.zipPath, confirm: true })).rejects.toMatchObject({
      rolledBack: true,
    });
    // 段目录逐文件回到调用前：被删的段写回、新产的包外段被清
    expect(syncDirNames(fx)).toEqual(beforeNames);
    expect([...fx.io.readFile(join(fx.syncDir, SEG_NAME))]).toEqual(beforeSeg);
    expect(fx.io.exists(join(fx.syncDir, OUTSIDE_SEG_NAME))).toBe(false);
  });

  it('段目录还原失败（删到一半）→ 段目录逐文件回到调用前，库与段不留半成品', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // 调用前状态：导入后 + 包外段（撤销的目标是回到这里，失败也必须停在这里）
    addOutsideSegment(fx);
    const before = syncDirNames(fx).map((name) => ({
      name,
      bytes: [...fx.io.readFile(join(fx.syncDir, name))],
    }));
    const beforeDb = [...fx.io.readFile(fx.dbPath)];
    // 故障注入：删到段目录最后一个文件才失败（前半已被删）
    const segmentPaths = before.filter((entry) => entry.name.endsWith('.jsonl')).map((entry) => join(fx.syncDir, entry.name));
    const last = segmentPaths[segmentPaths.length - 1];
    fx.io.removeGuard = (path) => {
      if (path === last) {
        throw new Error('注入的删除失败（模拟 EBUSY）');
      }
    };
    await expect(fx.service.revert({ backupPath: done.backupPath, confirm: true })).rejects.toMatchObject({
      code: 'E_PORTABLE_ROLLBACK_FAILED',
    });
    // 段目录逐文件回到调用前（不得停在被删一半）
    expect(syncDirNames(fx)).toEqual(before.map((entry) => entry.name));
    for (const entry of before) {
      expect([...fx.io.readFile(join(fx.syncDir, entry.name))]).toEqual(entry.bytes);
    }
    // 主库也回到调用前（库与段同一原子面）
    expect([...fx.io.readFile(fx.dbPath)]).toEqual(beforeDb);
    expect(fx.db.connectionOpen).toBe(true);
  });

  it('还原计划在停机后取：pauseSync 之前刚产出的包外段也被清（窄窗口回归）', async () => {
    const fx = await fixture();
    const done = await fx.service.execute({ zipPath: fx.zipPath, confirm: true });
    if ('canceled' in done) {
      throw new Error('unexpected cancel');
    }
    // pauseSync 的实现里「最后再产一段」——还原计划若在停机前取，这段就漏清了。
    const service = createPortableImportService({
      dbPath: fx.dbPath,
      syncDir: fx.syncDir,
      db: fx.db,
      schemaVersion: async () => SCHEMA_VERSION,
      pickArchive: async () => null,
      pauseSync: async () => {
        addOutsideSegment(fx); // 停机动作本身把最后一段落盘
      },
      now: () => FIXED_NOW,
      io: fx.io,
    });
    await service.revert({ backupPath: done.backupPath, confirm: true });
    expect(fx.io.exists(join(fx.syncDir, OUTSIDE_SEG_NAME))).toBe(false);
  });

  it('旧备份兼容：无 <备份名>-sync/ 目录 → 不动段目录（绝不把现目录当「多出来」清掉）', async () => {
    const fx = await fixture();
    // 手工构造一份 T80-06 之前形态的备份：只有三件套，没有段目录快照
    const backupPath = `${fx.dbPath}.bak-portable-20260925-102030`;
    fx.io.writeFile(backupPath, fx.io.readFile(fx.dbPath));
    fx.io.writeFile(`${backupPath}-wal`, fx.io.readFile(`${fx.dbPath}-wal`));
    fx.io.writeFile(`${backupPath}-shm`, fx.io.readFile(`${fx.dbPath}-shm`));
    addOutsideSegment(fx);
    const before = syncDirNames(fx);

    const reverted = await fx.service.revert({ backupPath, confirm: true });
    expect(reverted.ok).toBe(true);
    // 段目录一字未动（老备份没有段快照 → 保持既有「只还原三件套」语义）
    expect(syncDirNames(fx)).toEqual(before);
    expect(fx.io.exists(join(fx.syncDir, OUTSIDE_SEG_NAME))).toBe(true);
    expect(reverted.restoredFiles).toEqual([fx.dbPath, `${fx.dbPath}-wal`, `${fx.dbPath}-shm`]);
  });

  it('备份阶段失败：段目录快照失败 → E_PORTABLE_BACKUP_FAILED 且三件套半成品一并清掉', async () => {
    const fx = await fixture();
    fx.io.writeGuard = (path) => {
      if (path.includes('-sync')) {
        throw new Error('注入的段目录快照失败（磁盘满）');
      }
    };
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe(
      'E_PORTABLE_BACKUP_FAILED',
    );
    // 无备份不落库：三件套备份也被撤掉，段目录与主库一字未动
    expect(backupFilesOf(fx)).toHaveLength(0);
    expect(fx.io.exists(`${portableBackupName(fx.dbPath, FIXED_NOW)}-sync`)).toBe(false);
    expect(fx.db.calls.some((call) => call.startsWith('rebuild'))).toBe(false);
    expect([...fx.io.readFile(fx.dbPath)]).toEqual([...DB_BYTES]);
  });

  it('syncDir 缺省派生：不给 syncDir 时按 dirname(dbPath)/sync 定位（与 index.ts 同口径）', async () => {
    const fx = await fixture();
    const bare = createPortableImportService({
      dbPath: fx.dbPath, // 故意不传 syncDir
      db: fx.db,
      schemaVersion: async () => SCHEMA_VERSION,
      pickArchive: async () => null,
      now: () => FIXED_NOW,
      io: fx.io,
    });
    // 派生路径正好命中夹具的 syncDir：包外段因此可见 → blocked
    addOutsideSegment(fx);
    const plan = await bare.plan({ zipPath: fx.zipPath });
    if ('canceled' in plan) {
      throw new Error('unexpected cancel');
    }
    expect(plan.target.uncovered).toBe(OUTSIDE_OP_IDS.length);
    expect(plan.blocked?.code).toBe('E_PORTABLE_NOT_EMPTY');
  });
});

// ---------------------------------------------------------------------------
// T80-04（H-09）真连接实证：better-sqlite3 打开的 .db 在 close 前不可删
// ---------------------------------------------------------------------------

describeDb('便携包还原：真实句柄 close/reopen（T80-04 H-09，better-sqlite3 直连）', (ctor) => {
  it('连接存活时 revert 成功：close 释放句柄 → 还原 → reopen 且数据可继续读', async () => {
    const temp = makeTempDb('septcats-portable-live');
    const core = makeCore(ctor, temp.path);
    try {
      await requestOk<MigrateData>(core, { id: 'migrate', t: 'migrate' });
      await requestOk<RunData>(core, {
        id: 'seed',
        t: 'run',
        sqlId: 'meta.set',
        params: { key: 'seed-marker', value: 'before-revert' },
      });
      await requestOk(core, { id: 'cp', t: 'checkpoint' });
      const before = readFileSync(temp.path);
      const backupPath = `${temp.path}.bak-portable-20260925-102030`;
      writeFileSync(backupPath, before);

      const service = createPortableImportService({
        dbPath: temp.path,
        db: {
          checkpoint: async () => {
            await core.handleRequest({ id: 'cp2', t: 'checkpoint' });
          },
          listLedgerOpIds: async () => [],
          rebuildFromSegments: async () => ({ segments: 0, ops: 0, entities: 0, mode: 'replace', keptOps: 0 }),
          // 真连接：closeConnection 真关 better-sqlite3 句柄（否则 Windows EBUSY）
          closeConnection: async () => {
            await core.closeConnection();
          },
          reopenConnection: async () => {
            await core.reopenConnection();
          },
        },
        schemaVersion: async () => SCHEMA_VERSION,
        io: nodePortableImportIo,
      });

      const reverted = await service.revert({ backupPath, confirm: true });
      expect(reverted.ok).toBe(true);
      expect([...readFileSync(temp.path)]).toEqual([...before]);
      // 连接已重建：还能继续读（reopen 生效，不是「关了就算」）
      const row = await core.handleRequest({
        id: 'after',
        t: 'get',
        sqlId: 'meta.get',
        params: { key: 'seed-marker' },
      });
      expect(row.ok).toBe(true);
      expect((row as { data: { row: { value?: string } | null } }).data.row?.value).toBe('before-revert');
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('未 close 就删主库在 Windows 必失败（EBUSY 根因实证）；close 后可删', () => {
    const temp = makeTempDb('septcats-portable-busy');
    const core = makeCore(ctor, temp.path);
    try {
      // 连接打开着：Windows 下真删主库应抛 EBUSY/EPERM（H-09 根因）。
      let openDeleteError: unknown = null;
      try {
        rmSync(temp.path, { force: true });
      } catch (error) {
        openDeleteError = error;
      }
      if (process.platform === 'win32') {
        expect(openDeleteError).not.toBeNull();
      }
      // closeConnection 释放后：删除必须成功（证明 close/reopen 通道有效）。
      core.dispose();
      rmSync(temp.path, { force: true });
      expect(existsSync(temp.path)).toBe(false);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// T80-06（H-10）真 fs 实证：段目录快照/还原走 nodePortableImportIo（目录级语义）
//
// MemIo 证不了真磁盘的「建目录 / 目录不整体删 / 逐文件增删」语义，这里用真临时目录跑。
// ---------------------------------------------------------------------------

describe('便携包段目录真 fs 快照与还原（T80-06 H-10）', () => {
  it('revert 真 fs：包外段被清、导入后快照被清、包内段逐字节回写，quarantine/ 与非受管纹丝不动', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'septcats-portable-realfs-'));
    const root = join(dir, 'data');
    const syncDir = join(root, 'sync');
    const attachmentsDir = join(root, 'attachments');
    const outDir = join(root, 'export');
    for (const path of [syncDir, attachmentsDir, outDir]) {
      mkdirSync(path, { recursive: true });
    }
    const dbPath = join(root, 'septcats.db');
    try {
      writeFileSync(dbPath, DB_BYTES);
      writeFileSync(`${dbPath}-wal`, WAL_BYTES);
      writeFileSync(`${dbPath}-shm`, SHM_BYTES);
      writeFileSync(join(syncDir, SEG_NAME), SEG_TEXT);
      writeFileSync(join(syncDir, 'manifest.json'), SYNC_MANIFEST_TEXT);
      mkdirSync(join(syncDir, 'quarantine'), { recursive: true });
      writeFileSync(join(syncDir, 'quarantine', 'bad.jsonl'), 'quarantined-bad-segment');
      writeFileSync(join(syncDir, 'sync.log'), 'noise');
      writeFileSync(join(attachmentsDir, 'a.png'), PNG_BYTES);

      const exported = await createPortableExportService({
        dbPath,
        syncDir,
        attachmentsDir,
        libraryName: async () => LIBRARY,
        appVersion: APP_VERSION,
        schemaVersion: async () => SCHEMA_VERSION,
        checkpoint: async () => undefined,
        sealSegments: async () => 0,
        encrypted: () => false,
        pickDirectory: async () => outDir,
        now: () => FIXED_NOW,
        io: nodePortableExportIo,
      }).confirm({});
      if (exported.canceled) {
        throw new Error('导出夹具意外取消');
      }

      const db = new FakeDb(dbPath);
      const service = createPortableImportService({
        dbPath,
        syncDir,
        db,
        schemaVersion: async () => SCHEMA_VERSION,
        pickArchive: async () => null,
        now: () => FIXED_NOW,
        io: nodePortableImportIo,
      });

      const done = await service.execute({ zipPath: exported.path, confirm: true });
      if ('canceled' in done) {
        throw new Error('unexpected cancel');
      }
      // 备份段目录真落盘，且含 manifest + 段（红线：sync 快照必须含 manifest.json）
      const syncBak = `${done.backupPath}-sync`;
      expect(existsSync(join(syncBak, 'manifest.json'))).toBe(true);
      expect(existsSync(join(syncBak, SEG_NAME))).toBe(true);
      // quarantine/ 绝不被备份（任务书红线）
      expect(existsSync(join(syncBak, 'quarantine'))).toBe(false);
      expect(existsSync(join(syncBak, 'sync.log'))).toBe(false);

      // 导入后：包外段 + 折叠快照 + 包内段被改写（同步运行时在导入窗口内的产出）
      writeFileSync(join(syncDir, OUTSIDE_SEG_NAME), OUTSIDE_TEXT);
      writeFileSync(join(syncDir, SNAPSHOT_NAME), SNAPSHOT_TEXT);
      writeFileSync(join(syncDir, SEG_NAME), 'rewritten-after-import');

      const reverted = await service.revert({ backupPath: done.backupPath, confirm: true });
      expect(reverted.ok).toBe(true);
      // 包外段与导入后快照被清（H-10 修复本体）
      expect(existsSync(join(syncDir, OUTSIDE_SEG_NAME))).toBe(false);
      expect(existsSync(join(syncDir, SNAPSHOT_NAME))).toBe(false);
      // 包内段 / manifest 逐字节回写
      expect(readFileSync(join(syncDir, SEG_NAME), 'utf8')).toBe(SEG_TEXT);
      expect(readFileSync(join(syncDir, 'manifest.json'), 'utf8')).toBe(SYNC_MANIFEST_TEXT);
      // 主库三件套同时还原
      expect([...readFileSync(dbPath)]).toEqual([...DB_BYTES]);
      expect([...readFileSync(`${dbPath}-wal`)]).toEqual([...WAL_BYTES]);
      expect([...readFileSync(`${dbPath}-shm`)]).toEqual([...SHM_BYTES]);
      // quarantine/ 与非受管文件纹丝不动（还原面只管受管文件，不整体删目录）
      expect(readFileSync(join(syncDir, 'quarantine', 'bad.jsonl'), 'utf8')).toBe('quarantined-bad-segment');
      expect(readFileSync(join(syncDir, 'sync.log'), 'utf8')).toBe('noise');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
