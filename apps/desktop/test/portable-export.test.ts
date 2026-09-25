/**
 * portable-export.test.ts —— R28（TASK-T80-01）便携包导出：写侧纯逻辑 + 服务契约。
 *
 * 覆盖（任务书 §4）：zip 写→`unzipSync` 读 roundtrip（含中文/空格条目名、STORED
 * 选择断言）/ zip slip 条目名拒绝 / checksums 逐条对 / preview 不落盘 / 取消 = 零落盘 /
 * checkpoint 语句序（checkpoint 必须早于任何读）/ 加密库硬闸 / 同名加序号 / 原子写。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import {
  DEFLATE_LEVEL,
  PORTABLE_DB_ENTRY,
  PORTABLE_MANIFEST_NAME,
  STORED_LEVEL,
  assertZip32Size,
  buildPortableManifest,
  portableArchiveBase,
  portableEntryMeta,
  portableEntryNameSafe,
  portableStamp,
  uniquePortableArchiveName,
  ZIP32_MAX_BYTES,
} from '@septcats/sync';
import {
  PORTABLE_ENCRYPTED_MESSAGE,
  createPortableExportService,
  registerPortableExportIpc,
  type PortableExportIo,
} from '../src/main/portable';

const FIXED_NOW = Date.UTC(2026, 8, 24, 3, 4, 5);
const APP_VERSION = '0.5.0';
const SCHEMA_VERSION = 10;
const LIBRARY = '我的 库';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const SEGMENT_TEXT = '{"seg_id":"seg-00000001-dev00001-000001","dev":"dev00001","ops":[]}\n';

const temps: string[] = [];
function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 抛出的错误码（Error.message 不含 code，故取结构化字段断言）。 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return String((error as { code?: unknown } | null)?.code ?? '');
  }
  return '';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// 内存 IO（记录写/改名，供「零落盘」「原子写」断言）
// ---------------------------------------------------------------------------

class MemIo implements PortableExportIo {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly writes: string[] = [];
  readonly renames: Array<{ from: string; to: string }> = [];
  /** 目录列举覆写（造 zip slip 场景：让目录「真的」返回一个上跳名）。 */
  readonly listOverride = new Map<string, string[]>();

  listFiles(dir: string): string[] {
    const override = this.listOverride.get(dir);
    if (override !== undefined) {
      return override;
    }
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
    this.dirs.add(dirname(to));
  }
}

interface Fixture {
  io: MemIo;
  calls: string[];
  root: string;
  syncDir: string;
  attachmentsDir: string;
  dbPath: string;
  outDir: string;
  segmentName: string;
  attachmentName: string;
}

interface FixtureOptions {
  /** 附件文件名（默认含中文+空格，验 roundtrip）。 */
  readonly attachmentName?: string;
  /** 附件目录列举覆写（原样返回，不做 join 归一——用于 zip slip 夹具）。 */
  readonly rawAttachmentNames?: readonly string[];
  /** 加密库开关（默认 false）。 */
  readonly encrypted?: boolean;
  /** 封段后剩余未入段 op 数（默认 0）。 */
  readonly pendingOps?: number;
  /** 目录选择返回（默认 outDir；null = 取消）。 */
  readonly picked?: string | null;
}

function fixture(options: FixtureOptions = {}): Fixture {
  const io = new MemIo();
  const root = join(tempDir('t80-root'), 'data');
  const syncDir = join(root, 'sync');
  const attachmentsDir = join(root, 'attachments');
  const dbPath = join(root, 'septcats.db');
  const outDir = join(root, 'export');

  const segmentName = 'seg-00000001-dev00001-000001-abcd1234.jsonl';
  const attachmentName = options.attachmentName ?? '中文 图片.png';

  io.files.set(dbPath, new TextEncoder().encode('sqlite-main-db-bytes'));
  io.files.set(join(syncDir, segmentName), new TextEncoder().encode(SEGMENT_TEXT));
  // 排除项：同步清单 / 快照 / 备份——都不应出现在包内
  io.files.set(join(syncDir, 'manifest.json'), new TextEncoder().encode('{"devices":{}}'));
  io.files.set(join(syncDir, 'snapshot-000001.json'), new TextEncoder().encode('{}'));
  io.files.set(join(syncDir, 'quarantine', 'bad.jsonl'), new TextEncoder().encode('坏段'));
  io.files.set(join(root, 'septcats.db.bak-v8'), new TextEncoder().encode('backup'));
  io.files.set(join(attachmentsDir, attachmentName), PNG_BYTES);
  // zip slip 夹具：上跳名指向的真实文件（导出侧必须在造条目名时拒绝，绝不写出去）
  if (options.rawAttachmentNames !== undefined) {
    io.files.set(join(root, 'evil.png'), PNG_BYTES);
    io.listOverride.set(attachmentsDir, [...options.rawAttachmentNames]);
  }

  const calls: string[] = [];
  const base = io.readFile.bind(io);
  io.readFile = (path: string): Uint8Array => {
    calls.push(`read:${basename(path)}`);
    return base(path);
  };

  return {
    io,
    calls,
    root,
    syncDir,
    attachmentsDir,
    dbPath,
    outDir,
    segmentName,
    attachmentName,
  };
}

function serviceOf(fx: Fixture, options: FixtureOptions = {}): ReturnType<typeof createPortableExportService> {
  return createPortableExportService({
    dbPath: fx.dbPath,
    syncDir: fx.syncDir,
    attachmentsDir: fx.attachmentsDir,
    libraryName: async () => LIBRARY,
    appVersion: APP_VERSION,
    schemaVersion: async () => SCHEMA_VERSION,
    checkpoint: async () => {
      fx.calls.push('checkpoint');
    },
    sealSegments: async () => {
      fx.calls.push('seal');
      return options.pendingOps ?? 0;
    },
    encrypted: () => options.encrypted === true,
    pickDirectory: async () => (options.picked === undefined ? fx.outDir : options.picked),
    now: () => FIXED_NOW,
    io: fx.io,
  });
}

// ---------------------------------------------------------------------------
// 纯逻辑（packages/sync/src/portableZip.ts）
// ---------------------------------------------------------------------------

describe('便携包写侧纯逻辑', () => {
  it('条目名安全：拒绝绝对路径 / 上跳 / 目录项 / 反斜杠 / 盘符 / 空名', () => {
    expect(portableEntryNameSafe('sync/seg-1.jsonl')).toBe(true);
    expect(portableEntryNameSafe('中文 图片.png')).toBe(true);
    expect(portableEntryNameSafe('/etc/passwd')).toBe(false);
    expect(portableEntryNameSafe('../secrets.db')).toBe(false);
    expect(portableEntryNameSafe('sync/../secrets.db')).toBe(false);
    expect(portableEntryNameSafe('dir/')).toBe(false);
    expect(portableEntryNameSafe('dir\\file')).toBe(false);
    expect(portableEntryNameSafe('C:/file')).toBe(false);
    expect(portableEntryNameSafe('')).toBe(false);
  });

  it('不安全条目名 → E_ENTRY_NAME（写侧不静默改写名字）', () => {
    expect(codeOf(() => portableEntryMeta('../evil.png', PNG_BYTES, 'attachment'))).toBe('E_ENTRY_NAME');
    expect(codeOf(() => portableEntryMeta('/abs/db', PNG_BYTES, 'db'))).toBe('E_ENTRY_NAME');
  });

  it('STORED 选择：已压缩附件不二次压缩，文本类走 DEFLATE', () => {
    expect(portableEntryMeta('attachments/abc.png', PNG_BYTES, 'attachment').stored).toBe(true);
    expect(portableEntryMeta('attachments/abc.mp4', PNG_BYTES, 'attachment').stored).toBe(true);
    expect(portableEntryMeta('attachments/abc.txt', new Uint8Array([1, 2, 3]), 'attachment').stored).toBe(false);
    expect(portableEntryMeta('septcats.db', new Uint8Array([1, 2, 3]), 'db').stored).toBe(false);
    expect(STORED_LEVEL).toBe(0);
    expect(DEFLATE_LEVEL).toBe(6);
  });

  it('ZIP32 硬闸：单条目/总字节越界 → E_TOO_LARGE（v1 不做分卷）', () => {
    expect(() => assertZip32Size(1024, 'test')).not.toThrow();
    expect(codeOf(() => assertZip32Size(ZIP32_MAX_BYTES, '包内总字节'))).toBe('E_TOO_LARGE');
    expect(codeOf(() => assertZip32Size(-1, '条目'))).toBe('E_MALFORMED');
  });

  it('manifest：checksums 逐条 + 排除清单 + 库名/版本/schema 号', () => {
    const entry = portableEntryMeta('sync/seg-a.jsonl', new TextEncoder().encode(SEGMENT_TEXT), 'segment');
    const manifest = buildPortableManifest({
      library: LIBRARY,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_NOW,
      entries: [entry],
      warnings: ['段清单为空'],
    });
    expect(manifest.format).toBe('septcats-portable');
    expect(manifest.library).toBe(LIBRARY);
    expect(manifest.appVersion).toBe(APP_VERSION);
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(manifest.segments).toBe(1);
    expect(manifest.entries[0]?.sha256).toBe(sha256(new TextEncoder().encode(SEGMENT_TEXT)));
    expect(manifest.excluded).toContain('logs/');
    expect(manifest.excluded).toContain('sync/quarantine/');
    expect(manifest.excluded).toContain('*.db.bak-*');
    expect(manifest.warnings).toEqual(['段清单为空']);
  });

  it('归档名：库名 slug + 时间戳；同名加序号不覆盖', () => {
    const stamp = portableStamp(FIXED_NOW);
    expect(stamp).toMatch(/^\d{8}-\d{6}$/);
    const base = portableArchiveBase(LIBRARY, FIXED_NOW);
    expect(base).toBe(`septcats-portable-我的-库-${stamp}.zip`);
    const existing = new Set([base, `septcats-portable-我的-库-${stamp}-2.zip`]);
    expect(uniquePortableArchiveName(base, (name) => existing.has(name))).toBe(
      `septcats-portable-我的-库-${stamp}-3.zip`,
    );
    expect(uniquePortableArchiveName('fresh.zip', () => false)).toBe('fresh.zip');
  });
});

// ---------------------------------------------------------------------------
// 服务（内存 IO 夹具）
// ---------------------------------------------------------------------------

describe('便携包导出服务', () => {
  it('preview 只读：清单 + 总字节，零落盘', async () => {
    const fx = fixture();
    const service = serviceOf(fx);
    const preview = await service.preview({});

    expect(preview.fileName).toBe(`septcats-portable-我的-库-${portableStamp(FIXED_NOW)}.zip`);
    expect(preview.files.map((file) => file.relPath).sort()).toEqual([
      `attachments/${fx.attachmentName}`,
      PORTABLE_DB_ENTRY,
      `sync/${fx.segmentName}`,
    ]);
    expect(preview.counts).toEqual({ segments: 1, attachments: 1, db: 1, entries: 3 });
    expect(preview.totalBytes).toBe(
      fx.io.size(fx.dbPath) + fx.io.size(join(fx.syncDir, fx.segmentName)) + PNG_BYTES.byteLength,
    );
    // 排除项不入包
    expect(preview.files.some((file) => file.relPath.includes('manifest.json'))).toBe(false);
    expect(preview.files.some((file) => file.relPath.includes('snapshot-'))).toBe(false);
    expect(preview.files.some((file) => file.relPath.includes('bak-'))).toBe(false);
    expect(preview.files.some((file) => file.relPath.includes('quarantine'))).toBe(false);
    expect(preview.warnings).toEqual([]);
    // 零落盘 + 不动库/段（preview 不 checkpoint、不封段）
    expect(fx.io.writes).toHaveLength(0);
    expect(fx.io.renames).toHaveLength(0);
    expect(fx.calls).toHaveLength(0);
  });

  it('confirm：zip roundtrip（中文/空格条目名逐字节一致）', async () => {
    const fx = fixture();
    const service = serviceOf(fx);
    const result = await service.confirm({});
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }

    const zip = fx.io.files.get(result.path);
    expect(zip).toBeDefined();
    const unzipped = unzipSync(zip!);
    expect(Object.keys(unzipped).sort()).toEqual(
      [PORTABLE_MANIFEST_NAME, PORTABLE_DB_ENTRY, `attachments/${fx.attachmentName}`, `sync/${fx.segmentName}`].sort(),
    );
    expect([...(unzipped[`attachments/${fx.attachmentName}`] ?? [])]).toEqual([...PNG_BYTES]);
    expect(new TextDecoder().decode(unzipped[`sync/${fx.segmentName}`])).toBe(SEGMENT_TEXT);
    expect(new TextDecoder().decode(unzipped[PORTABLE_DB_ENTRY])).toBe('sqlite-main-db-bytes');
  });

  it('STORED 断言：PNG 附件不压缩（compression 0），文本类 DEFLATE（compression 8）', async () => {
    const fx = fixture({ attachmentName: 'photo.png' });
    const service = serviceOf(fx);
    const result = await service.confirm({});
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }
    const zip = fx.io.files.get(result.path)!;
    const compressions = new Map<string, number>();
    unzipSync(zip, {
      filter: (entry) => {
        compressions.set(entry.name, entry.compression);
        return false;
      },
    });
    expect(compressions.get('attachments/photo.png')).toBe(0);
    expect(compressions.get(PORTABLE_DB_ENTRY)).toBe(8);
    expect(compressions.get(`sync/${fx.segmentName}`)).toBe(8);
  });

  it('checksums 逐条对：manifest 里的 sha256 = 条目实际字节', async () => {
    const fx = fixture();
    const service = serviceOf(fx);
    const result = await service.confirm({});
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }
    const unzipped = unzipSync(fx.io.files.get(result.path)!);
    const manifest = JSON.parse(new TextDecoder().decode(unzipped[PORTABLE_MANIFEST_NAME])) as {
      format: string;
      segments: number;
      entries: Array<{ name: string; sha256: string; bytes: number; kind: string }>;
      excluded: string[];
    };
    expect(manifest.format).toBe('septcats-portable');
    expect(manifest.segments).toBe(1);
    for (const entry of manifest.entries) {
      if (entry.name === PORTABLE_MANIFEST_NAME) {
        continue; // 清单不自指
      }
      const bytes = unzipped[entry.name];
      expect(bytes).toBeDefined();
      expect(entry.bytes).toBe(bytes!.byteLength);
      expect(entry.sha256).toBe(sha256(bytes!));
    }
    expect(manifest.excluded).toContain('tmp/');
  });

  it('zip slip：上跳条目名 → E_ENTRY_NAME，且零落盘', async () => {
    const fx = fixture({ rawAttachmentNames: ['a/../../evil.png'] });
    const service = serviceOf(fx);
    await expect(service.confirm({})).rejects.toMatchObject({ code: 'E_ENTRY_NAME' });
    expect(fx.io.writes).toHaveLength(0);
    expect(fx.io.renames).toHaveLength(0);
  });

  it('语句序：checkpoint 第一步（早于封段与任何读）', async () => {
    const fx = fixture();
    const service = serviceOf(fx);
    await service.confirm({});
    expect(fx.calls[0]).toBe('checkpoint');
    expect(fx.calls.indexOf('seal')).toBe(1);
    expect(fx.calls.indexOf('read:septcats.db')).toBeGreaterThan(fx.calls.indexOf('seal'));
  });

  it('取消（目录选择回 null）= 零落盘', async () => {
    const fx = fixture();
    const service = serviceOf(fx, { picked: null });
    const result = await service.confirm({});
    expect(result).toEqual({ canceled: true });
    expect(fx.io.writes).toHaveLength(0);
    expect(fx.io.renames).toHaveLength(0);
    expect(fx.calls).toHaveLength(0); // 取消发生在 checkpoint 之前
  });

  it('原子写：先写 .tmp 再 rename；同名加序号不覆盖', async () => {
    const fx = fixture();
    const service = serviceOf(fx);
    const first = await service.confirm({});
    const second = await service.confirm({});
    if (first.canceled || second.canceled) {
      throw new Error('unexpected cancel');
    }
    expect(fx.io.writes[0]?.endsWith('.tmp')).toBe(true);
    expect(fx.io.renames[0]?.from).toBe(fx.io.writes[0]);
    expect(fx.io.renames[0]?.to).toBe(first.path);
    expect(second.path.endsWith('-2.zip')).toBe(true);
    expect(second.renamed).toBe(true);
    expect(first.renamed).toBe(false);
    // 两次产物都在（无覆盖）
    expect(fx.io.exists(first.path)).toBe(true);
    expect(fx.io.exists(second.path)).toBe(true);
  });

  it('加密库硬闸：E_PORTABLE_ENCRYPTED_UNSUPPORTED（preview/confirm 都不落盘）', async () => {
    const fx = fixture();
    const service = serviceOf(fx, { encrypted: true });
    await expect(service.preview({})).rejects.toMatchObject({
      code: 'E_PORTABLE_ENCRYPTED_UNSUPPORTED',
      message: PORTABLE_ENCRYPTED_MESSAGE,
    });
    await expect(service.confirm({})).rejects.toMatchObject({ code: 'E_PORTABLE_ENCRYPTED_UNSUPPORTED' });
    expect(fx.io.writes).toHaveLength(0);
    expect(fx.calls).toHaveLength(0);
  });

  it('未封段残留：E_PORTABLE_PENDING_UNSEALED（段是导入侧真相，不静默丢数据）', async () => {
    const fx = fixture();
    const service = serviceOf(fx, { pendingOps: 3 });
    await expect(service.confirm({})).rejects.toMatchObject({ code: 'E_PORTABLE_PENDING_UNSEALED' });
    expect(fx.io.writes).toHaveLength(0);
    expect(fx.calls).toEqual(['checkpoint', 'seal']);
  });

  it('段清单为空：manifest 留痕 warning，仍可导出（主库兜底）', async () => {
    const fx = fixture();
    fx.io.files.delete(join(fx.syncDir, fx.segmentName));
    const service = serviceOf(fx);
    const result = await service.confirm({});
    if (result.canceled) {
      throw new Error('unexpected cancel');
    }
    expect(result.counts.segments).toBe(0);
    expect(result.warnings.length).toBe(1);
    const unzipped = unzipSync(fx.io.files.get(result.path)!);
    const manifest = JSON.parse(new TextDecoder().decode(unzipped[PORTABLE_MANIFEST_NAME])) as {
      warnings: string[];
    };
    expect(manifest.warnings).toEqual(result.warnings);
  });

  it('IPC 注册：service=null → E_INVARIANT 前缀（DbServer 未就绪降级）', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    registerPortableExportIpc(null, { handle: (channel, listener) => handlers.set(channel, listener) });
    const preview = handlers.get('portable:export:preview');
    const confirm = handlers.get('portable:export:confirm');
    expect(preview).toBeDefined();
    expect(confirm).toBeDefined();
    await expect(preview!({})).rejects.toThrow(/E_INVARIANT/);
    await expect(confirm!({ dir: '/tmp' })).rejects.toThrow(/E_INVARIANT/);
  });
});
