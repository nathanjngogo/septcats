/**
 * main/portable.ts —— 主进程「便携包导出」服务（R28 · TASK-T80-01 §1/§2）。
 *
 * 形状照 R27 的 `pageExport`：**preview 只读（列条目 + 字节，零落盘）→ confirm
 * （dir 显式；缺 dir 走系统目录选择，取消 = 零落盘）**。confirm 的语句序固定
 * （任务书 §3）：**加密闸 → `PRAGMA wal_checkpoint(TRUNCATE)` → 封段 → 读字节 →
 * 打包 → 原子写（tmp → rename，同名加序号）**。
 *
 * 包内条目（PRD §1）：`manifest-portable.json` + 主库 `septcats.db` + `sync/seg-*.jsonl`
 * （= 导入侧 `rebuildFromSegments` 的输入形态）+ `attachments/**`；排除
 * `logs/` `tmp/` `crashDumps/` `sync/quarantine/` `sync/manifest.json`
 * `sync/snapshot-*.json` `*.db.bak-*`（清单写进 manifest.excluded，用户可读）。
 *
 * 纪律：不 import electron（目录选择/打开经 DI 注入）；zip 容器只在这里碰 fflate
 * （packages 侧保持纯逻辑）；导出对库与同步数据全只读——唯一的写是**包本身**。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import {
  DEFLATE_LEVEL,
  PORTABLE_DB_ENTRY,
  PORTABLE_MANIFEST_NAME,
  STORED_LEVEL,
  assertZip32Size,
  buildPortableManifest,
  encodePortableManifest,
  parseSegmentFileName,
  portableArchiveBase,
  portableAttachmentEntry,
  portableEntryMeta,
  portableSegmentEntry,
  sha256Hex,
  uniquePortableArchiveName,
  type PortableEntryMeta,
} from '@septcats/sync';
import { CHANNEL_PORTABLE_EXPORT_CONFIRM, CHANNEL_PORTABLE_EXPORT_PREVIEW } from '../shared/ipc';
import type {
  PortableExportConfirmResponse,
  PortableExportFilePreview,
  PortableExportInput,
  PortableExportPreview,
} from '../shared/portable';
import type { PortableEntryKind } from '../shared/portable';

// 契约类型单一来源在 shared/portable.ts（renderer 侧直接 import 该文件，不引本实现）
export type {
  PortableExportCanceled,
  PortableExportConfirmResponse,
  PortableExportConfirmResult,
  PortableExportFilePreview,
  PortableExportInput,
  PortableExportPreview,
} from '../shared/portable';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形）
// ---------------------------------------------------------------------------

export type PortableExportErrorCode =
  | 'E_MALFORMED'
  | 'E_INVARIANT'
  /** v1 硬闸：加密库不出门（DEK 机器绑定，跨机不可解）。 */
  | 'E_PORTABLE_ENCRYPTED_UNSUPPORTED'
  /** 封段后仍有未入段的本地 op —— 段是导入侧真相，拒导不静默丢数据。 */
  | 'E_PORTABLE_PENDING_UNSEALED'
  /** 单条目 / 总字节越 ZIP32 上限（fflate zipSync 只写 32 位字段，v1 不做分卷）。 */
  | 'E_TOO_LARGE'
  | 'E_ENTRY_NAME';

export class PortableExportApiError extends Error {
  readonly code: PortableExportErrorCode;

  constructor(code: PortableExportErrorCode, message: string) {
    super(message);
    this.name = 'PortableExportApiError';
    this.code = code;
    Object.setPrototypeOf(this, PortableExportApiError.prototype);
  }
}

export const PORTABLE_ENCRYPTED_MESSAGE = '加密库暂不支持导出便携包（数据密钥绑定本机，跨机无法解密）';
export const PORTABLE_PENDING_MESSAGE = '仍有改动未写入同步段，请稍候重试（导出不会改动你的数据）';

export function toPortableExportError(error: unknown): PortableExportApiError {
  if (error instanceof PortableExportApiError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'E_TOO_LARGE' || code === 'E_ENTRY_NAME' || code === 'E_MALFORMED') {
    return new PortableExportApiError(code, error instanceof Error ? error.message : String(error));
  }
  return new PortableExportApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// IO 注入面（测试用假实现；生产用 node fs）
// ---------------------------------------------------------------------------

export interface PortableExportIo {
  /** 目录内文件名（不存在/不可读 → []）。 */
  listFiles(dir: string): string[];
  readFile(path: string): Uint8Array;
  size(path: string): number;
  exists(path: string): boolean;
  isFile(path: string): boolean;
  mkdir(path: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
  rename(from: string, to: string): void;
}

export const nodePortableExportIo: PortableExportIo = {
  listFiles: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  readFile: (path) => new Uint8Array(readFileSync(path)),
  size: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  },
  exists: (path) => existsSync(path),
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  writeFile: (path, bytes) => {
    writeFileSync(path, bytes);
  },
  rename: (from, to) => {
    renameSync(from, to);
  },
};

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface PortableExportServiceOptions {
  /** 主库文件绝对路径（checkpoint 后读它）。 */
  readonly dbPath: string;
  /** 同步目录（`<root>/sync`；段清单来源）。 */
  readonly syncDir: string;
  /** 附件目录（真相 = layout.attachments）。 */
  readonly attachmentsDir: string;
  /** 库名（活动工作区名；进 manifest.library 与文件名 slug）。 */
  readonly libraryName: () => Promise<string>;
  readonly appVersion: string;
  /** SQLite schema 版本（PRAGMA user_version）。 */
  readonly schemaVersion: () => Promise<number>;
  /** 前置 `PRAGMA wal_checkpoint(TRUNCATE)`（先例 db/migrations.ts:391）。 */
  readonly checkpoint: () => Promise<void>;
  /** 强制封段（复用 SyncRuntime 既有发布语义），返回剩余未入段 op 数。 */
  readonly sealSegments: () => Promise<number>;
  /** 加密库判定（settings.sync.encrypt）。 */
  readonly encrypted: () => boolean;
  /** confirm 缺 dir 时的目录选择（main 注入系统对话框；取消回 null）。 */
  readonly pickDirectory: () => Promise<string | null>;
  /** 墙上时钟（测试注入）。 */
  readonly now?: () => number;
  readonly io?: PortableExportIo;
}

export interface PortableExportService {
  preview(input: PortableExportInput): Promise<PortableExportPreview>;
  confirm(input: PortableExportInput): Promise<PortableExportConfirmResponse>;
}

/** 段文件判定：`sync/` 根下能解析出 (c_from, dev, n) 的 `seg-*.jsonl`（密文段除外）。 */
function isPortableSegment(name: string): boolean {
  if (name.endsWith('.enc')) {
    return false; // 密文段：导出加密库已由硬闸拒绝，明文包不收密文
  }
  return parseSegmentFileName(name) !== null;
}

/** 排除规则（与 manifest.excluded 同口径）：备份/隐藏/坏段隔离。 */
function isExcludedDataFile(name: string): boolean {
  return name.startsWith('.') || name.includes('.bak-');
}

interface Entry {
  readonly name: string;
  readonly kind: PortableEntryKind;
  readonly bytes: Uint8Array;
}

export function createPortableExportService(options: PortableExportServiceOptions): PortableExportService {
  const io = options.io ?? nodePortableExportIo;
  const now = options.now ?? Date.now;
  const pickDirectory = options.pickDirectory;

  /** 段清单（同步目录根；quarantine/ 是子目录，天然不入）。 */
  function segmentNames(): string[] {
    return io
      .listFiles(options.syncDir)
      .filter((name) => isPortableSegment(name) && io.isFile(join(options.syncDir, name)))
      .sort();
  }

  /** 附件清单（内容寻址 `<hash>[.<ext>]`）。 */
  function attachmentNames(): string[] {
    return io
      .listFiles(options.attachmentsDir)
      .filter((name) => !isExcludedDataFile(name) && io.isFile(join(options.attachmentsDir, name)))
      .sort();
  }

  function warningsOf(segmentCount: number): string[] {
    if (segmentCount > 0) {
      return [];
    }
    return ['同步段为空（未启用同步或尚未产段）：包内只有主库与附件，导入侧重放将得到空库'];
  }

  /** 只读清单（不入 checksums：manifest 自身尚未生成）。 */
  function planFiles(): PortableExportFilePreview[] {
    const files: PortableExportFilePreview[] = [];
    if (io.isFile(options.dbPath)) {
      files.push({ relPath: PORTABLE_DB_ENTRY, kind: 'db', bytes: io.size(options.dbPath) });
    }
    for (const name of segmentNames()) {
      files.push({ relPath: portableSegmentEntry(name), kind: 'segment', bytes: io.size(join(options.syncDir, name)) });
    }
    for (const name of attachmentNames()) {
      files.push({
        relPath: portableAttachmentEntry(name),
        kind: 'attachment',
        bytes: io.size(join(options.attachmentsDir, name)),
      });
    }
    return files;
  }

  function countsOf(files: readonly PortableExportFilePreview[]): PortableExportPreview['counts'] {
    return {
      segments: files.filter((file) => file.kind === 'segment').length,
      attachments: files.filter((file) => file.kind === 'attachment').length,
      db: files.filter((file) => file.kind === 'db').length,
      entries: files.length,
    };
  }

  function previewOf(fileName: string, files: readonly PortableExportFilePreview[]): PortableExportPreview {
    const counts = countsOf(files);
    return {
      fileName,
      files,
      counts,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      warnings: warningsOf(counts.segments),
    };
  }

  /** 读全部条目字节（checkpoint/封段之后调用）。 */
  function readEntries(): Entry[] {
    const entries: Entry[] = [];
    if (io.isFile(options.dbPath)) {
      entries.push({ name: PORTABLE_DB_ENTRY, kind: 'db', bytes: io.readFile(options.dbPath) });
    }
    for (const name of segmentNames()) {
      entries.push({ name: portableSegmentEntry(name), kind: 'segment', bytes: io.readFile(join(options.syncDir, name)) });
    }
    for (const name of attachmentNames()) {
      entries.push({
        name: portableAttachmentEntry(name),
        kind: 'attachment',
        bytes: io.readFile(join(options.attachmentsDir, name)),
      });
    }
    return entries;
  }

  async function buildZip(createdAt: number, pendingOps: number, warnings: readonly string[]): Promise<{
    readonly zip: Uint8Array;
    readonly files: readonly PortableExportFilePreview[];
    readonly entries: readonly PortableEntryMeta[];
  }> {
    const raw = readEntries();
    const metas = raw.map((entry) => portableEntryMeta(entry.name, entry.bytes, entry.kind));
    const manifest = buildPortableManifest({
      library: await options.libraryName(),
      appVersion: options.appVersion,
      schemaVersion: await options.schemaVersion(),
      createdAt,
      entries: metas,
      pendingOps,
      warnings,
    });
    const manifestBytes = encodePortableManifest(manifest);
    const manifestMeta: PortableEntryMeta = {
      name: PORTABLE_MANIFEST_NAME,
      kind: 'manifest',
      bytes: manifestBytes.byteLength,
      sha256: sha256Hex(manifestBytes),
      stored: false,
    };
    const entries: PortableEntryMeta[] = [manifestMeta, ...metas];
    const seen = new Set<string>();
    const zippable: Zippable = {};
    const all: Entry[] = [{ name: PORTABLE_MANIFEST_NAME, kind: 'manifest', bytes: manifestBytes }, ...raw];
    for (const entry of all) {
      if (seen.has(entry.name)) {
        throw new PortableExportApiError('E_MALFORMED', `包内条目名重复：${entry.name}`);
      }
      seen.add(entry.name);
      const level = entries.find((meta) => meta.name === entry.name)?.stored === true ? STORED_LEVEL : DEFLATE_LEVEL;
      zippable[entry.name] = [entry.bytes, { level }];
    }
    const zip = zipSync(zippable);
    assertZip32Size(zip.byteLength, '归档总字节');
    const files: PortableExportFilePreview[] = entries.map((meta) => ({
      relPath: meta.name,
      kind: meta.kind,
      bytes: meta.bytes,
    }));
    return { zip, files, entries };
  }

  return {
    async preview() {
      if (options.encrypted()) {
        throw new PortableExportApiError('E_PORTABLE_ENCRYPTED_UNSUPPORTED', PORTABLE_ENCRYPTED_MESSAGE);
      }
      const files = planFiles();
      return previewOf(portableArchiveBase(await options.libraryName(), now()), files);
    },

    async confirm(input) {
      assertInput(input);
      // 闸 1：加密库不出门（放在最前——拒导前不做任何副作用）
      if (options.encrypted()) {
        throw new PortableExportApiError('E_PORTABLE_ENCRYPTED_UNSUPPORTED', PORTABLE_ENCRYPTED_MESSAGE);
      }
      const chosen = typeof input.dir === 'string' && input.dir.length > 0 ? input.dir : await pickDirectory();
      if (chosen === null) {
        return { canceled: true }; // 取消 = 零落盘
      }
      // 闸 2：checkpoint 必须是导出第一步（wal 未落账会导致包内主库落后）
      await options.checkpoint();
      // 闸 3：把已落账但未发布的 op 封进段（复用 sync 既有发布语义，零新增 op）
      const pendingOps = await options.sealSegments();
      if (pendingOps > 0) {
        throw new PortableExportApiError('E_PORTABLE_PENDING_UNSEALED', PORTABLE_PENDING_MESSAGE);
      }
      const createdAt = now();
      const baseName = portableArchiveBase(await options.libraryName(), createdAt);
      const filesBefore = planFiles();
      const warnings = warningsOf(countsOf(filesBefore).segments);
      const built = await buildZip(createdAt, pendingOps, warnings);

      // 原子写：tmp → rename（同目录 rename 不出现半截包）；同名加序号，绝不静默覆盖
      io.mkdir(chosen);
      const finalName = uniquePortableArchiveName(baseName, (name) => io.exists(join(chosen, name)));
      const target = join(chosen, finalName);
      const tmp = `${target}.${process.pid}.${String(createdAt)}.tmp`;
      io.writeFile(tmp, built.zip);
      io.rename(tmp, target);

      const preview = previewOf(finalName, built.files);
      return {
        ...preview,
        canceled: false,
        path: target,
        dir: chosen,
        renamed: finalName !== baseName,
      };
    },
  };
}

function assertInput(input: PortableExportInput): void {
  if (input === null || typeof input !== 'object') {
    throw new PortableExportApiError('E_MALFORMED', 'IPC 参数必须是对象');
  }
  if (input.dir !== undefined && typeof input.dir !== 'string') {
    throw new PortableExportApiError('E_MALFORMED', 'dir 必须是字符串');
  }
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

export interface PortableExportIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 `portable:export:preview` / `confirm` 两通道。`service === null`（DbServer
 * 未就绪）时统一回 `E_INVARIANT`。参数在边界再校验（不信任 renderer）。
 */
export function registerPortableExportIpc(
  service: PortableExportService | null,
  registrar: PortableExportIpcRegistrar,
): void {
  const requireService = (): PortableExportService => {
    if (service === null) {
      throw new PortableExportApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };
  const on = (channel: string, run: (input: Record<string, unknown>) => Promise<unknown>): void => {
    registrar.handle(channel, async (raw: unknown): Promise<unknown> => {
      try {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new PortableExportApiError('E_MALFORMED', 'IPC 参数必须是对象');
        }
        return await run(raw as Record<string, unknown>);
      } catch (error) {
        const mapped = toPortableExportError(error);
        throw new Error(`${mapped.code}: ${mapped.message}`);
      }
    });
  };

  on(CHANNEL_PORTABLE_EXPORT_PREVIEW, () => requireService().preview({}));
  on(CHANNEL_PORTABLE_EXPORT_CONFIRM, (input) =>
    requireService().confirm({
      ...(typeof input['dir'] === 'string' ? { dir: input['dir'] } : {}),
    }),
  );
}
