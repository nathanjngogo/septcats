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
  assertPortableImportEntryNames,
  assertPortableSegmentCount,
  classifyPortableEntry,
  isPortableEncrypted,
  parsePortableManifest,
  portableAttachmentNames,
  portableBackupName,
  portableBackupOrigin,
  portableBackupPlan,
  portableRestorePlan,
  portableSchemaCompatible,
  portableSegmentNames,
  verifyPortableChecksums,
} from '@septcats/sync';
import {
  createPortableExportService,
  type PortableExportIo,
} from '../src/main/portable';
import {
  PORTABLE_IMPORT_CONFIRM_MESSAGE,
  PORTABLE_IMPORT_ENCRYPTED_MESSAGE,
  createPortableImportService,
  registerPortableImportIpc,
  type PortableImportDb,
  type PortableImportIo,
  type PortableImportReplayData,
  type PortableImportService,
} from '../src/main/portableImport';

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

async function fixture(options: { readonly localOpIds?: readonly string[] } = {}): Promise<Fixture> {
  const io = new MemIo();
  const root = join('T80-02', 'data').replace('T80-02', '/t80-root');
  const syncDir = join(root, 'sync');
  const attachmentsDir = join(root, 'attachments');
  const dbPath = join(root, 'septcats.db');
  const outDir = join(root, 'export');
  const attachmentName = '中文 图片.png';

  io.files.set(dbPath, DB_BYTES);
  io.files.set(`${dbPath}-wal`, WAL_BYTES);
  io.files.set(`${dbPath}-shm`, SHM_BYTES);
  io.files.set(join(syncDir, SEG_NAME), new TextEncoder().encode(SEG_TEXT));
  io.files.set(join(syncDir, 'manifest.json'), new TextEncoder().encode('{"devices":{}}'));
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
    db,
    schemaVersion: async () => SCHEMA_VERSION,
    pickArchive: async () => null,
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

function backupFilesOf(io: MemIo): string[] {
  return [...io.files.keys()].filter((path) => path.includes('.bak-portable-')).sort();
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
      fx.db.backupFilesAtRebuild = backupFilesOf(fx.io).length;
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
    expect(backupFilesOf(fx.io)).toHaveLength(0); // 零落盘
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
    expect(backupFilesOf(fx.io)).toHaveLength(0);
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
    expect(backupFilesOf(fx.io)).toHaveLength(0);
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
    expect(backupFilesOf(fx.io)).toHaveLength(0);
  });

  it('zip slip：包内上跳条目名 → E_ENTRY_NAME，零落盘', async () => {
    const fx = await fixture();
    fx.io.writeFile(fx.zipPath, zipSync({ '../evil.db': DB_BYTES } as Record<string, Uint8Array>));
    expect(await codeOf(() => fx.service.plan({ zipPath: fx.zipPath }))).toBe('E_ENTRY_NAME');
    expect(await codeOf(() => fx.service.execute({ zipPath: fx.zipPath, confirm: true }))).toBe('E_ENTRY_NAME');
    expect(backupFilesOf(fx.io)).toHaveLength(0);
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
    expect(backupFilesOf(fx.io)).toHaveLength(0);
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
    expect(backupFilesOf(fx.io)).toHaveLength(3);
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
    expect(backupFilesOf(fx.io)).toHaveLength(0); // 半成品已清理
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
    expect(reverted.restoredFiles).toEqual([fx.dbPath, `${fx.dbPath}-wal`, `${fx.dbPath}-shm`]);
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
