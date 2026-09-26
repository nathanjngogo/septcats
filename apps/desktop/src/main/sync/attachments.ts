/**
 * attachments.ts —— 附件同步引擎（T84-02/03，PRD-T84 方案 A：files/ 内容寻址双向）。
 *
 * 一引擎两向：
 *  - **上行 push**：六路引用枚举（assetGc.loadReferencedHashes——红线「复用不另造」）
 *    命中且远端 files/ 缺失的本机附件 → 护栏内流式原子拷入 `<syncRoot>/files/<name>`
 *    （加密开启时落 `<name>.enc`，SCAF1 流式信封）；
 *  - **下行 pull**：远端 files/ 名单（含 .enc 变体）中本地缺同 hash 族的 → 流式拉取
 *    → **sha256 复验**（不符=隔离：不重试、不落活附件，错误上账）→ 原子落 attachments/。
 *
 * 护栏（PRD §2 Q6 逐条）：流式 64KB（禁整读）｜磁盘预检 ×1.2+32MB｜并发 ≤3
 * ｜per-item 指数退避（1s→…→5min 封顶；失败不阻断队列）｜tmp(.part-)+rename 原子
 * ｜pause/stop 中止在途并清 tmp（T80-04 不留半截纪律）｜幂等（同 hash=同内容，
 * exists 快路径跳过——双写同 hash 是成功不是错误）。
 *
 * 一期口径（老板 09-26 拍板）：**只增不删**——files/ 永不删除（GC 随 G6）。
 * 加密=传输面保护（网盘方不可读）；混合态诚实处理：远端明文件校验通过照样收
 * （内容寻址诚信闸=sha256，加密与否只影响网盘上的可读性），并记一次告警。
 *
 * 隐私红线：仅 sync.enabled 时被 runtime 调用；零外联、无常驻定时器（周期=sync 轮）。
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { keyIdBytes } from './crypto';
import { loadReferencedHashes } from '../assetGc';
import type { StatementExecutor } from '../pages';

/** 同步目录下的附件区（PRD §1 布局）。 */
export const FILES_DIR = 'files';
/** 加密变体后缀（对齐段面 .enc 心智）。 */
export const ENC_SUFFIX = '.enc';

const NAME_RE = /^[0-9a-f]{64}(\.[A-Za-z0-9]{1,10})?$/;
const CHUNK_BYTES = 64 * 1024;
const CONCURRENCY = 3;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 300_000;
const DISK_FACTOR = 1.2;
const DISK_HEADROOM = 32 * 1024 * 1024;
const MAX_HASH_FAILURES = 3; // 同 hash 连续校验失败次数上限→本进程熔断（远端垃圾不无限重试）

export const ATTACH_ERRORS = {
  DISK_FULL: 'E_SYNC_DISK_FULL',
  HASH_MISMATCH: 'E_SYNC_ATTACH_HASH_MISMATCH',
  TRANSFER_FAILED: 'E_SYNC_ATTACH_TRANSFER',
  KEY_MISMATCH: 'E_SYNC_KEY_MISMATCH',
} as const;

/** SCAF1 流式信封：magic(5)|keyId(8)|帧[]；帧=seq(4 LE)|ctLen(4 LE)|iv(12)|tag(16)|ct。
 *  AAD=`<logicalName>#<seq>`（帧错位/重放/跨文件搬帧一律 GCM 拒收）。ctLen=0 且
 *  flags…（seq 连续）——末帧以 ctLen=0 标识（数据帧永不为空）。 */
const SCAF_MAGIC = Buffer.from('SCAF1', 'latin1');
const FRAME_META = 4 + 4 + 12 + 16; // seq|ctLen|iv|tag = 36

export interface AttachmentItemStatus {
  name: string;
  bytes: number;
  attempts: number;
  nextAtMs: number;
  lastError?: string;
}

export interface AttachmentCycleReport {
  /** 本轮扫描的本机待上附件数（入队）。 */
  enqueued: number;
  pushed: number;
  pushedBytes: number;
  pulled: number;
  pulledBytes: number;
  skippedExists: number;
  failed: number;
  diskDeferred: number;
  quarantined: number;
}

export interface AttachmentSyncOptions {
  /** 本地附件真相目录（attachments/）。 */
  attachmentsDir: string;
  /** 同步根目录（syncFolderFor 解析结果；files/ 在其下）。 */
  syncRoot: string;
  /** 六路引用枚举的查询面（与 assetGc 同源；运行时实参 = SyncDbAdapter，只用 .all）。 */
  executor: Pick<StatementExecutor, 'all'>;
  /** 动态加密开关（设置里改即时生效，同段面口径）。 */
  encryptEnabled: () => boolean;
  /** 当前 DEK（加密开启且 runtime 已确保非 null）。 */
  dek: () => Uint8Array | null;
  log?: (line: string) => void;
  now?: () => number;
  /** 注入磁盘读数（单测夹具口；缺省 statfs）。 */
  freeSpaceBytes?: (path: string) => Promise<number>;
}

/** 附件名/逻辑名判定：<64hex>[.ext]（拒绝路径穿越与一切花名）。 */
export function isAttachmentFileName(name: string): boolean {
  return NAME_RE.test(name);
}

function logicalOf(stored: string): string {
  return stored.endsWith(ENC_SUFFIX) ? stored.slice(0, -ENC_SUFFIX.length) : stored;
}

function hashOf(fileName: string): string {
  return fileName.slice(0, 64);
}

/** 指数退避（纯函数可测）：attempts=1 → base；封顶 CAP。 */
export function backoffFor(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

/** 磁盘预检（纯函数可测）：需要 bytes 的传输，目标盘余量 ≥ bytes×1.2+32MB 才放行。 */
export function diskOk(freeBytes: number, bytes: number): boolean {
  // 严格闸：连 32MB 绝对余量都要满足（0 字节附件同理——满盘时 rename/元数据照样写不下）。
  return freeBytes >= Math.ceil(bytes * DISK_FACTOR) + DISK_HEADROOM;
}

/** SCAF1 加密 Transform（流式分块，内存钉在 chunk 级）。 */
export function scafEncrypt(dek: Uint8Array, logicalName: string): Transform {
  const head = Buffer.concat([SCAF_MAGIC, keyIdBytes(dek)]);
  let seq = 0;
  let headDone = false;
  return new Transform({
    transform(data: Buffer, _enc: unknown, cb: (e: Error | null, d?: Buffer) => void): void {
      const out: Buffer[] = [];
      if (!headDone) {
        out.push(head);
        headDone = true;
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), Buffer.from(iv), { authTagLength: 16 });
      cipher.setAAD(Buffer.from(`${logicalName}#${String(seq)}`, 'utf8'));
      const ct = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
      const tag = cipher.getAuthTag();
      const meta = Buffer.alloc(8);
      meta.writeUInt32LE(seq, 0);
      meta.writeUInt32LE(ct.length, 4);
      out.push(Buffer.concat([meta, iv, tag, ct]));
      seq += 1;
      cb(null, Buffer.concat(out));
    },
    flush(cb: (e: Error | null, d?: Buffer) => void): void {
      const out: Buffer[] = headDone ? [] : [head];
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), Buffer.from(iv), { authTagLength: 16 });
      cipher.setAAD(Buffer.from(`${logicalName}#${String(seq)}`, 'utf8'));
      const ct = cipher.final(); // GCM：tag 只能在 final 之后取
      const meta = Buffer.alloc(8);
      meta.writeUInt32LE(seq, 0);
      meta.writeUInt32LE(0, 4); // ctLen=0 = 末帧哨
      out.push(Buffer.concat([meta, iv, cipher.getAuthTag(), ct]));
      cb(null, Buffer.concat(out));
    },
  });
}

/** SCAF1 解密 Transform：验 magic/key_id/帧 AAD+tag+seq 连续；任何不符→抛（→隔离）。 */
export function scafDecrypt(dek: Uint8Array, logicalName: string): Transform {
  let buf = Buffer.alloc(0);
  let headOk = false;
  let expectSeq = 0;
  let sawEnd = false;
  return new Transform({
    transform(data: Buffer, _enc: unknown, cb: (e: Error | null, d?: Buffer) => void): void {
      try {
        if (sawEnd) {
          throw new Error('E_SYNC_ATTACH_FRAME_AFTER_END');
        }
        buf = Buffer.concat([buf, Buffer.from(data)]);
        if (!headOk) {
          if (buf.length < SCAF_MAGIC.length + 8) {
            cb(null);
            return;
          }
          if (!buf.subarray(0, SCAF_MAGIC.length).equals(SCAF_MAGIC)) {
            throw new Error('E_SYNC_ATTACH_BAD_MAGIC');
          }
          if (!buf.subarray(SCAF_MAGIC.length, SCAF_MAGIC.length + 8).equals(keyIdBytes(dek))) {
            throw new Error(ATTACH_ERRORS.KEY_MISMATCH);
          }
          buf = buf.subarray(SCAF_MAGIC.length + 8);
          headOk = true;
        }
        for (;;) {
          if (buf.length < FRAME_META) {
            break;
          }
          const seq = buf.readUInt32LE(0);
          const ctLen = buf.readUInt32LE(4);
          const frameLen = FRAME_META + ctLen;
          if (buf.length < frameLen) {
            break;
          }
          const iv = buf.subarray(8, 20);
          const tag = buf.subarray(20, FRAME_META);
          const ct = buf.subarray(FRAME_META, frameLen);
          buf = buf.subarray(frameLen);
          const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dek), Buffer.from(iv), { authTagLength: 16 });
          decipher.setAAD(Buffer.from(`${logicalName}#${String(seq)}`, 'utf8'));
          decipher.setAuthTag(Buffer.from(tag));
          const plain = Buffer.concat([decipher.update(Buffer.from(ct)), decipher.final()]);
          if (seq !== expectSeq) {
            throw new Error('E_SYNC_ATTACH_FRAME_SEQ');
          }
          if (ctLen === 0) {
            sawEnd = true;
            break;
          }
          this.push(plain);
          expectSeq += 1;
        }
        cb(null);
      } catch (error) {
        cb(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(cb: (e: Error | null, d?: Buffer) => void): void {
      cb(sawEnd ? null : new Error('E_SYNC_ATTACH_TRUNCATED_ENVELOPE'));
    },
  });
}

interface QueueEntry {
  /** 本地 attachments 里的实际文件名（含扩展名）。 */
  name: string;
  hash: string;
  bytes: number;
  attempts: number;
  nextAtMs: number;
  lastError?: string;
}

/**
 * 引擎实例：runCycle() 由 SyncRuntime.cycleBody 末尾调用（同一轮次节拍，无常驻定时器）。
 * 队列=进程内 Map（幂等重扫保证重启后自愈：中断半截被 tmp 清理规则吞掉）。
 */
export class AttachmentSyncService {
  private readonly opts: AttachmentSyncOptions;
  private readonly log: (line: string) => void;
  private readonly nowFn: () => number;
  private readonly freeSpace: (path: string) => Promise<number>;
  /** 上行队列（name → 状态）。 */
  private readonly queue = new Map<string, QueueEntry>();
  /** 本进程已成功推送的名字（重扫快路径）。 */
  private readonly pushedOk = new Set<string>();
  /** 连续 sha 复验失败熔断：hash → 次数。 */
  private readonly hashFailures = new Map<string, number>();
  /** 已记过盘上明文告警的 hash（一次即止，不刷屏）。 */
  private readonly plainWarned = new Set<string>();
  private inFlight = 0;
  private paused = false;
  /** 中止闸（stop/暂停置位；在途传输在下个 chunk 处抛 aborted 并清 tmp）。 */
  private abort: { aborted: boolean } = { aborted: false };

  constructor(options: AttachmentSyncOptions) {
    this.opts = options;
    this.log = options.log ?? ((line: string) => { void line; });
    this.nowFn = options.now ?? ((): number => Date.now());
    this.freeSpace =
      options.freeSpaceBytes ??
      (async (path: string): Promise<number> => {
        const s = await statfs(path);
        return s.bavail * s.bsize;
      });
  }

  /** 状态行/面板消费（PRD §2 进度可视）。 */
  status(): { pending: number; active: number; bytes: number; failed: number } {
    let failed = 0;
    let bytes = 0;
    for (const e of this.queue.values()) {
      if (e.attempts > 0) {
        failed += 1;
      }
      bytes += e.bytes;
    }
    return { pending: this.queue.size, active: this.inFlight, bytes, failed };
  }

  pause(): void {
    this.paused = true;
    this.abort.aborted = true;
  }

  resume(): void {
    this.paused = false;
    this.abort = { aborted: false };
  }

  /** 停机：中止在途 + 清 tmp（调用方 await 本方法后再关目录句柄）。 */
  async stop(): Promise<void> {
    this.paused = true;
    this.abort.aborted = true;
    // 在途传输的 tmp 由 copy 路径的 finally 清；此处兜底扫 attachments/files 两目录
    await this.sweepTemps().catch((error: unknown) => {
      this.log(`attach sweep 失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private filesDir(): string {
    return join(this.opts.syncRoot, FILES_DIR);
  }

  /** 兜底清残尸 .part-*（两目录）；只认自己前缀，绝不碰别的。 */
  private async sweepTemps(): Promise<void> {
    for (const dir of [this.filesDir(), this.opts.attachmentsDir]) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (n.includes('.part-')) {
          await rm(join(dir, n), { force: true }).catch(() => undefined);
        }
      }
    }
  }

  /**
   * 一轮：上行扫描入队 → 并发 ≤3 排空 → 下行拉取（引用集本地缺件）。
   * 加密开启但无 DEK → 本轮直接跳过（runtime 的 key 错误态另有红条，不在此叠加）。
   */
  async runCycle(): Promise<AttachmentCycleReport> {
    const report: AttachmentCycleReport = {
      enqueued: 0,
      pushed: 0,
      pushedBytes: 0,
      pulled: 0,
      pulledBytes: 0,
      skippedExists: 0,
      failed: 0,
      diskDeferred: 0,
      quarantined: 0,
    };
    if (this.paused) {
      return report;
    }
    if (this.opts.encryptEnabled() && this.opts.dek() === null) {
      return report; // 无钥不硬传（段面同口径：错误态由 runtime 冒红条）
    }
    await this.sweepTemps();

    // ---- 上行：引用集 ∩ 本机盘上件 −（远端已有 ∪ 本进程已推） ----
    const localFiles = await this.listDir(this.opts.attachmentsDir);
    const remoteFiles = await this.listDir(this.filesDir());
    const remoteLogical = new Set(remoteFiles.filter((n) => !n.includes('.part-')).map(logicalOf));
    let referenced: Set<string>;
    try {
      referenced = await loadReferencedHashes(this.opts.executor);
    } catch (error) {
      this.log(`attach 引用枚举失败（本轮不上行）：${error instanceof Error ? error.message : String(error)}`);
      referenced = new Set();
    }
    // 同 hash 本地取最新 mtime 的文件名代表（族内同内容；扩展名取盘上实际名）
    const localByHash = new Map<string, { name: string; bytes: number }>();
    for (const n of localFiles) {
      if (!isAttachmentFileName(n)) {
        continue;
      }
      const h = hashOf(n);
      const prev = localByHash.get(h);
      if (prev === undefined) {
        try {
          const st = await stat(join(this.opts.attachmentsDir, n));
          localByHash.set(h, { name: n, bytes: st.size });
        } catch {
          /* 竞态删除：本轮不看 */
        }
      }
    }
    const now0 = this.nowFn();
    for (const h of referenced) {
      const local = localByHash.get(h);
      if (local === undefined) {
        continue; // 本机没这份附件（可能是远端引用）——下行面管
      }
      if (this.pushedOk.has(local.name) || remoteLogical.has(local.name)) {
        report.skippedExists += 1;
        continue;
      }
      if (!this.queue.has(local.name)) {
        this.queue.set(local.name, {
          name: local.name,
          hash: h,
          bytes: local.bytes,
          attempts: 0,
          nextAtMs: now0,
        });
        report.enqueued += 1;
      }
    }

    // ---- 排空上行队列（并发 ≤3；退避到期才动） ----
    const runnable = [...this.queue.values()].filter((e) => e.nextAtMs <= this.nowFn());
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, runnable.length) }, async () => {
      for (;;) {
        const entry = runnable[cursor];
        cursor += 1;
        if (entry === undefined) {
          return;
        }
        if (this.abort.aborted || this.paused) {
          return;
        }
        const outcome = await this.pushOne(entry);
        if (outcome === 'pushed') {
          report.pushed += 1;
          report.pushedBytes += entry.bytes;
          this.queue.delete(entry.name);
          this.pushedOk.add(entry.name);
        } else if (outcome === 'exists') {
          report.skippedExists += 1;
          this.queue.delete(entry.name);
          this.pushedOk.add(entry.name);
        } else if (outcome === 'disk') {
          report.diskDeferred += 1;
        } else {
          report.failed += 1;
        }
      }
    });
    await Promise.all(workers);

    // ---- 下行：远端逻辑名 − 本地缺族 ----
    const localHashes = new Set<string>();
    for (const n of localFiles) {
      if (isAttachmentFileName(n)) {
        localHashes.add(hashOf(n));
      }
    }
    const pullCandidates: Array<{ logical: string; stored: string; hash: string }> = [];
    for (const stored of remoteFiles) {
      if (stored.includes('.part-')) {
        continue;
      }
      const logical = logicalOf(stored);
      if (!isAttachmentFileName(logical)) {
        continue; // 野名（含 .bad-/.quarantine 残迹）不拉，留痕交对账
      }
      const h = hashOf(logical);
      if (localHashes.has(h)) {
        continue;
      }
      if ((this.hashFailures.get(h) ?? 0) >= MAX_HASH_FAILURES) {
        report.quarantined += 1;
        continue;
      }
      pullCandidates.push({ logical, stored, hash: h });
    }
    let pcursor = 0;
    const pworkers = Array.from({ length: Math.min(CONCURRENCY, pullCandidates.length) }, async () => {
      for (;;) {
        const cand = pullCandidates[pcursor];
        pcursor += 1;
        if (cand === undefined) {
          return;
        }
        if (this.abort.aborted || this.paused) {
          return;
        }
        const outcome = await this.pullOne(cand);
        if (outcome === 'pulled') {
          report.pulled += 1;
        } else if (outcome === 'exists') {
          report.skippedExists += 1;
        } else if (outcome === 'mismatch') {
          report.quarantined += 1;
        } else if (outcome === 'disk') {
          report.diskDeferred += 1;
        } else {
          report.failed += 1;
        }
      }
    });
    await Promise.all(pworkers);

    if (report.pushed + report.pulled + report.quarantined + report.failed > 0) {
      this.log(
        `附件轮：↑${String(report.pushed)}(${String(report.pushedBytes)}B) ↓${String(report.pulled)}(${String(
          report.pulledBytes,
        )}B) 跳过${String(report.skippedExists)} 隔离${String(report.quarantined)} 失败${String(report.failed)} 盘满缓${String(report.diskDeferred)}`,
      );
    }
    return report;
  }

  private async listDir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  /** 上行单件：磁盘预检 → tmp+流式拷（加密=SCAF1）→ rename。返回状态串。 */
  private async pushOne(entry: QueueEntry): Promise<'pushed' | 'exists' | 'disk' | 'failed'> {
    const enc = this.opts.encryptEnabled();
    const dek = this.opts.dek();
    if (enc && dek === null) {
      return this.failEntry(entry, 'no-dek', 'KEY');
    }
    const dst = join(this.filesDir(), enc ? `${entry.name}${ENC_SUFFIX}` : entry.name);
    const src = join(this.opts.attachmentsDir, entry.name);
    // 并发/双写幂等：目标已存在（对端同内容已传/本端重入）=成功跳过
    try {
      await stat(dst);
      return 'exists';
    } catch {
      /* 不存在，继续 */
    }
    const free = await this.freeSpace(this.filesDir()).catch((): number => 0);
    if (!diskOk(free, entry.bytes)) {
      entry.attempts += 1;
      entry.nextAtMs = this.nowFn() + BACKOFF_CAP_MS; // 盘满：退到最长再探
      entry.lastError = ATTACH_ERRORS.DISK_FULL;
      this.log(`磁盘余量不足（${String(free)}B < ${String(entry.bytes)}×${String(DISK_FACTOR)}），${entry.name} 挂起`);
      return 'disk';
    }
    const tmp = `${dst}.part-${randomBytes(4).toString('hex')}`;
    try {
      await mkdir(this.filesDir(), { recursive: true });
      const stages: unknown[] = [createReadStream(src, { highWaterMark: CHUNK_BYTES })];
      if (enc && dek !== null) {
        stages.push(scafEncrypt(dek, entry.name));
      }
      stages.push(createWriteStream(tmp));
      if (this.abort.aborted) {
        throw new Error('aborted');
      }
      await (pipeline as unknown as (...args: unknown[]) => Promise<void>)(...stages);
      if (this.abort.aborted) {
        throw new Error('aborted');
      }
      // 同内容幂等：rename 前再查一次（对端刚写入）——rename 覆盖同名同字节=等价，直接 rename
      await rename(tmp, dst);
      entry.attempts = 0;
      delete entry.lastError;
      return 'pushed';
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'aborted') {
        return 'failed';
      }
      return this.failEntry(entry, msg, ATTACH_ERRORS.TRANSFER_FAILED);
    }
  }

  /** 下行单件：流式读（.enc=SCAF1 解密）→ sha256 复验 → 原子落 attachments/。 */
  private async pullOne(cand: { logical: string; stored: string; hash: string }): Promise<'pulled' | 'exists' | 'mismatch' | 'disk' | 'failed'> {
    const dek = this.opts.dek();
    const encFile = cand.stored.endsWith(ENC_SUFFIX);
    const dst = join(this.opts.attachmentsDir, cand.logical);
    try {
      await stat(dst);
      return 'exists';
    } catch {
      /* 缺失才拉 */
    }
    const st = await stat(join(this.filesDir(), cand.stored)).catch((): null => null);
    if (st === null) {
      return 'exists'; // 竞态被删：下轮再看
    }
    const free = await this.freeSpace(this.opts.attachmentsDir).catch((): number => 0);
    if (!diskOk(free, st.size)) {
      this.log(`磁盘余量不足，下行 ${cand.logical} 挂起`);
      return 'disk';
    }
    if (encFile && dek === null) {
      this.log(`下行 ${cand.logical} 为密文但本地无钥——跳过（红条由段面 key 态负责）`);
      return 'failed';
    }
    const hasher = createHash('sha256');
    const tmp = `${dst}.part-${randomBytes(4).toString('hex')}`;
    const src = join(this.filesDir(), cand.stored);
    try {
      await mkdir(this.opts.attachmentsDir, { recursive: true });
      const stages: unknown[] = [createReadStream(src, { highWaterMark: CHUNK_BYTES })];
      if (encFile && dek !== null) {
        stages.push(scafDecrypt(dek, cand.logical));
      }
      const gate = this.abort;
      stages.push(
        new Transform({
          transform(chunk: Buffer, _enc2: unknown, cb: (e: Error | null, d?: Buffer) => void): void {
            if (gate.aborted) {
              cb(new Error('aborted'));
              return;
            }
            hasher.update(chunk);
            cb(null, chunk);
          },
        }),
      );
      stages.push(createWriteStream(tmp));
      if (this.abort.aborted) {
        throw new Error('aborted');
      }
      await (pipeline as unknown as (...args: unknown[]) => Promise<void>)(...stages);
      if (this.abort.aborted) {
        throw new Error('aborted');
      }
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === ATTACH_ERRORS.KEY_MISMATCH || msg === 'E_SYNC_KEY_MISMATCH' || msg.startsWith('E_SYNC_ATTACH_')) {
        // 信封非法/钥不符/截断：内容不可信 → 计入熔断（远端垃圾不无限重试），隔离不落地
        return this.quarantine(cand, msg);
      }
      if (msg === 'aborted') {
        return 'failed';
      }
      this.log(`下行 ${cand.logical} 传输失败（退避）：${msg}`);
      return 'failed';
    }
    const digest = hasher.digest('hex');
    if (!digest.startsWith(cand.hash)) {
      await rm(tmp, { force: true }).catch(() => undefined);
      return this.quarantine(cand, ATTACH_ERRORS.HASH_MISMATCH);
    }
    if (!encFile && this.opts.encryptEnabled() && !this.plainWarned.has(cand.hash)) {
      this.plainWarned.add(cand.hash);
      this.log(`注意：${cand.logical} 在同步目录为明文（对端加密关闭时写入）；sha 复验通过仍收取`);
    }
    await rename(tmp, dst);
    return 'pulled';
  }

  private quarantine(cand: { logical: string; hash: string }, reason: string): 'mismatch' {
    const n = (this.hashFailures.get(cand.hash) ?? 0) + 1;
    this.hashFailures.set(cand.hash, n);
    this.log(`附件隔离 ${cand.logical}：${reason}（第 ${String(n)}/${String(MAX_HASH_FAILURES)} 次；不落活附件，本地维持占位态）`);
    return 'mismatch';
  }

  private failEntry(entry: QueueEntry, detail: string, code: string): 'failed' {
    entry.attempts += 1;
    entry.nextAtMs = this.nowFn() + backoffFor(entry.attempts);
    entry.lastError = code;
    this.log(`上行 ${entry.name} 失败（第 ${String(entry.attempts)} 次，退避 ${String(backoffFor(entry.attempts))}ms）：${detail}`);
    return 'failed';
  }
}
