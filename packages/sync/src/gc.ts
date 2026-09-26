import type { ActorId } from '@septcats/core';
import type { Manifest } from './manifest';

/**
 * 保留窗口与清理计划（任务书 §4 / S9）。
 *
 * 只产出「可删清单」，真删由 runtime 决定（铁律 §0：删除永远先 tombstone，
 * retention 未越过前不得物理清除）。
 *
 * 双重门：
 * 1) retention 已过：目录已静默满 retention_days（以 manifest.updated_at 为最近活动参考）；
 * 2) 所有已知设备水位越过：每台已知设备 last_lamport >= 段的 cTo（都拿到过这段数据）。
 * 未知/掉线设备（manifest 里有、但 watermarks 里无）按 last_seen_at + 7 天宽限期保守不放行；
 * 静默超 7 天视为离场，不再阻塞清理。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * DAY_MS;

/** 待清理候选段：file 为文件名，cTo 为该段最大 lamport，dev 为段归属设备。 */
export interface CleanupCandidate {
  file: string;
  cTo: number;
  dev: ActorId;
}

/** 段是否已被所有已知设备越过（水位 >= cTo），掉线设备按宽限期保守处理。 */
function allDevicesCrossed(
  manifest: Manifest,
  watermarks: Map<ActorId, number>,
  cTo: number,
  now: number,
): boolean {
  for (const [dev, info] of Object.entries(manifest.devices)) {
    const watermark = watermarks.get(dev);
    if (watermark !== undefined) {
      if (watermark < cTo) {
        return false;
      }
      continue;
    }
    // 未知/掉线：manifest 记录了该设备，但本轮无其水位。
    // 宽限期（7 天）内保守不放行；超期视为离场，不再阻塞。
    if (now - info.last_seen_at < OFFLINE_GRACE_MS) {
      return false;
    }
  }
  return true;
}

/**
 * 计算清理计划：返回可物理删除的段文件名列表。
 *
 * - retention 未过（目录静默不足 retention_days）→ 空列表（S9 方向一）；
 * - 任一已知设备水位未越过某段 cTo，或掉线设备仍在宽限期内 → 该段不放行（S9 方向二）；
 * - 两者全过才放行。
 */
export function planCleanup(
  manifest: Manifest,
  segs: CleanupCandidate[],
  knownDeviceWatermarks: Map<ActorId, number>,
  now: number,
): string[] {
  const retentionPassed = now - manifest.updated_at >= manifest.retention_days * DAY_MS;
  if (!retentionPassed) {
    return [];
  }

  const removable: string[] = [];
  for (const seg of segs) {
    if (allDevicesCrossed(manifest, knownDeviceWatermarks, seg.cTo, now)) {
      removable.push(seg.file);
    }
  }
  return removable;
}

// ---------------------------------------------------------------------------
// DB 面墓碑 GC（T81-01）：page 墓碑行的物理清除计划
//
// `main/pages.ts` 的 purgePage 只把墓碑标 `deleted_at=0`（页从此不可达、FTS 已清），
// 注释承诺的「物理清除归 GC 任务」此前无实现 → page/block 墓碑行永久残留。
//
// 与 planCleanup 同纪律：**本函数只产出「可删清单」，绝不真删**（真删归 main/dbgc.ts）。
// 与段 GC 的差别：段 GC 的门是「目录静默满 retention + 全设备水位越过」；DB 面没有
// 设备水位概念（物化行是本地派生态，删了可由账本重放复现），门是「墓碑满期 + 无任何
// 引用它、删了会悬空的活物」。**op_ledger 不在判定面内**：账本是真相层，删物化行不删账。
// ---------------------------------------------------------------------------

/**
 * DB 面 GC 候选：一行 page 墓碑（alive=0）的**脱敏描述子**。
 * 纯数据（本函数零 IO）：由调用方（main/dbgc.ts）查库装配后传入。
 */
export interface DbGcTombstone {
  /** page.id。 */
  readonly id: string;
  /**
   * page.deleted_at 原值：
   * - `0` = 「彻底删除」标记（purgePage 写入，回收站已不可见）→ 不受 retention 门约束；
   * - `> 0` = 回收站软删除时刻（ms）；
   * - `null` = 无标记（旧版本 `page.softDelete` 只置 alive=0）→ 无法判龄，保守不放行。
   */
  readonly deletedAt: number | null;
  /** 进入墓碑的年龄锚（软删 = deleted_at；purge = 写标记时的 updated_at）。retention 判定用。 */
  readonly tombstonedAt: number;
  /** page.parent_id 指向本行的子页 id 集合（任意存活态）。子树完整性判定用。 */
  readonly childIds: readonly string[];
  /** 有 page_lock 或 block_cipher 行（锁/密文未清）——正常 purge/delete 都会清，出现即异常态。 */
  readonly locked: boolean;
}

/**
 * 不放行原因。同一行可能命中多条，按此**优先级**只报第一条：
 * `unreachable` > `retention` > `locked` > `has-children`。
 *
 * 注意 favorite/recent/page_link_index/import_source 等**设备本地派生态不在此列**：
 * 它们对墓碑不可见（favorite/recent 列表均 `JOIN page … alive = 1`）且无取消入口，
 * 若作扣留理由则「彻底删除」永远不会完成——故一律**随页级联清除**（见 main/dbgc.ts）。
 */
export type DbGcHoldReason =
  /** deleted_at 无标记（旧 softDelete 残留），年龄不可判定 → 保守不放行。 */
  | 'unreachable'
  /** 回收站软删未满 retentionDays。 */
  | 'retention'
  /** 锁行/密文仍在（数据仅在密文里，异常态 → 保守不放行）。 */
  | 'locked'
  /** 有子页不随迁（子页存活，或子页自身被扣留）→ 删父会留下悬空 parent_id。 */
  | 'has-children';

export interface DbGcHeld<T extends DbGcTombstone = DbGcTombstone> {
  readonly tombstone: T;
  readonly reason: DbGcHoldReason;
}

export interface DbGcPlan<T extends DbGcTombstone = DbGcTombstone> {
  /** 放行（可物理删除）的墓碑，保持入参顺序（确定性）。 */
  readonly deletable: readonly T[];
  /** 扣留的墓碑 + 原因，保持入参顺序。 */
  readonly held: readonly DbGcHeld<T>[];
}

export interface DbGcOptions {
  /**
   * 回收站保留天数。`<= 0` = 不设限（软删恒视为满期）。
   * **purge 墓碑（deletedAt === 0）不受此门约束**：用户已显式选择彻底删除。
   */
  readonly retentionDays: number;
}

/**
 * 计算 DB 面墓碑清除计划：`{ deletable, held }`。
 *
 * 放行判据（全部满足）：
 * 1) 年龄可知（deletedAt !== null）且（purge 标记 或 软删满 retentionDays）；
 * 2) 无锁行/密文（有则视为异常态，保守扣留）；
 * 3) **子树完整性**：其 childIds 里没有「不在放行集合内」的 id（活子页、或自身被扣留
 *    的子页都会阻塞父行）。本判据在候选集内迭代到不动点——父子同为墓碑且都过 1)/2)
 *    时可整棵一起放行。
 *
 * 未知/畸形输入一律保守（扣留），绝不因数据形态异常放行物理删除。
 */
export function planDbGc<T extends DbGcTombstone>(
  tombstones: readonly T[],
  now: number,
  opts: DbGcOptions,
): DbGcPlan<T> {
  const retentionMs = Math.max(0, opts.retentionDays) * DAY_MS;
  const holdReason = new Map<string, DbGcHoldReason>();

  // 1)/2) 逐条基础门（不看彼此关系）。
  for (const tomb of tombstones) {
    if (tomb.deletedAt === null) {
      holdReason.set(tomb.id, 'unreachable');
      continue;
    }
    const retentionPassed =
      tomb.deletedAt === 0 || opts.retentionDays <= 0 || now - tomb.tombstonedAt >= retentionMs;
    if (!retentionPassed) {
      holdReason.set(tomb.id, 'retention');
      continue;
    }
    if (tomb.locked) {
      holdReason.set(tomb.id, 'locked');
    }
  }

  // 3) 子树完整性：从「基础门全过」的集合出发，反复剔除含未放行子页的行，直到不动点。
  const released = new Set<string>();
  for (const tomb of tombstones) {
    if (!holdReason.has(tomb.id)) {
      released.add(tomb.id);
    }
  }
  const byId = new Map(tombstones.map((tomb) => [tomb.id, tomb]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...released]) {
      const tomb = byId.get(id);
      if (tomb === undefined) {
        released.delete(id);
        changed = true;
        continue;
      }
      const dangling = tomb.childIds.some((childId) => childId !== id && !released.has(childId));
      if (dangling) {
        released.delete(id);
        holdReason.set(id, 'has-children');
        changed = true;
      }
    }
  }

  const deletable: T[] = [];
  const held: DbGcHeld<T>[] = [];
  for (const tomb of tombstones) {
    const reason = holdReason.get(tomb.id);
    if (reason === undefined) {
      deletable.push(tomb);
    } else {
      held.push({ tombstone: tomb, reason });
    }
  }
  return { deletable, held };
}

// ---------------------------------------------------------------------------
// 附件孤儿回收（T83-02）：`layout.attachments/` 目录的物理清除计划
//
// T81-01 的 DB 面 GC 只清墓碑行，**盘上附件文件从未对账** → 页面被彻底删除后其独占
// 附件（不再被任何行引用）永久占盘。本函数补上这一面。
//
// 与 planDbGc 同区同纪律：**本函数只产出「可删清单」，绝不真删**（真删归 main/assetGc.ts）。
// 差别只在判据：DB 面是「墓碑满期 + 无子页悬空」；附件面是「盘上文件的内容哈希不再被
// 库里任何一行引用」——引用面由调用方（main）查库装配成 `referencedHashes` 传入。
//
// **铁律：任何有引用的文件绝不删。** 文件名 → 哈希的解析口径**必须逐字复刻**
// `apps/desktop/src/main/assets.ts` 的 `findHashFile`（精确 `<hash>` → 前缀 `<hash>.<ext>`），
// 否则扩展名变体命中的引用会被误删——这是本单最大的误删风险点。
// ---------------------------------------------------------------------------

/** 磁盘附件条目（脱敏描述子；本函数零 IO，由调用方列举目录后传入）。 */
export interface AssetDiskFile {
  /** 文件名（内容寻址：`<hash>` 或 `<hash>.<ext>`）。 */
  readonly name: string;
  /** 字节数（仅报告用，不参与判定）。 */
  readonly bytes: number;
  /** mtime（ms）：保护期判定锚。 */
  readonly mtimeMs: number;
}

/**
 * 不放行原因。同一文件只报**第一条**命中的原因，按此**优先级**：
 * `referenced` > `blind` > `unknown` > `recent`。
 */
export type AssetGcHoldReason =
  /** 文件名哈希仍被库里某行引用（含墓碑页引用、扩展名变体命中）。 */
  | 'referenced'
  /** 库里存在密文块（锁页正文）→ 明文扫描看不到其引用面 → 一律不放行。 */
  | 'blind'
  /** 文件名不是内容寻址形态（无法判归属）→ 保守不放行。 */
  | 'unknown'
  /** mtime 在保护期内（刚写入、可能尚未落块被引用）→ 本次不放行。 */
  | 'recent';

export interface AssetGcHeld<T extends AssetDiskFile = AssetDiskFile> {
  readonly file: T;
  readonly reason: AssetGcHoldReason;
}

export interface AssetGcPlan<T extends AssetDiskFile = AssetDiskFile> {
  /** 放行（可物理删除）的文件，保持入参顺序（确定性）。 */
  readonly deletable: readonly T[];
  /** 扣留的文件 + 原因，保持入参顺序。 */
  readonly held: readonly AssetGcHeld<T>[];
}

export interface AssetGcOptions {
  /**
   * 保护期天数：mtime 距今 < `retentionDays * 24h` → 扣留 `recent`。
   * `<= 0` = 不设保护期。缺省值由调用方决定（与 DB 面回收站保留同值 30）。
   */
  readonly retentionDays: number;
  /**
   * 引用面是否完整可枚举（缺省 true）。库里存在 `block_cipher` 行（锁页正文密文）时为
   * false：明文扫描看不到锁页的附件引用，此时**除已确认被引用的之外一律扣留**——宁可留，
   * 绝不可误删。
   */
  readonly referencesComplete?: boolean;
}

/**
 * 内容寻址文件名 → 内容哈希；非该形态回 `null`。
 *
 * 口径 = `main/assets.ts` 的 `findHashFile`：精确 `<hash>`（64 位小写 hex）或
 * 前缀 `<hash>.`（`attachment://` 按前缀取唯一命中）。大小写敏感——与 handler 一致
 * （`url.host` 已 toLowerCase），故大写/畸形名解析不出哈希 → 落 `unknown` 扣留（安全侧）。
 */
function hashOfName(name: string): string | null {
  if (/^[0-9a-f]{64}$/.test(name)) {
    return name;
  }
  const match = /^([0-9a-f]{64})\./.exec(name);
  return match === null ? null : (match[1] ?? null);
}

/**
 * 计算附件孤儿回收计划：`{ deletable, held }`。
 *
 * 逐文件按优先级判定（第一条命中即扣留）：
 * 1) 解析出的哈希在 `referencedHashes` 里 → `referenced`（**唯一无条件的守卫**：
 *    即便引用面不完整、即便文件很新，只要有引用就绝不删）；
 * 2) `referencesComplete === false` → `blind`（锁页密文使扫描失明，无法证明孤儿）；
 * 3) 文件名解析不出哈希 → `unknown`（非内容寻址形态，无法判归属）；
 * 4) mtime 在保护期内 → `recent`（刚写入、可能尚未落块被引用）；
 * 5) 其余 → 放行。
 *
 * 未知/畸形输入一律保守（扣留），绝不因数据形态异常放行物理删除。
 */
export function planAssetGc<T extends AssetDiskFile>(
  referencedHashes: ReadonlySet<string>,
  diskFiles: readonly T[],
  now: number,
  opts: AssetGcOptions,
): AssetGcPlan<T> {
  const referencesComplete = opts.referencesComplete ?? true;
  const retentionMs = Math.max(0, opts.retentionDays) * DAY_MS;

  const deletable: T[] = [];
  const held: AssetGcHeld<T>[] = [];

  for (const file of diskFiles) {
    const hash = hashOfName(file.name);
    if (hash !== null && referencedHashes.has(hash)) {
      held.push({ file, reason: 'referenced' });
      continue;
    }
    if (!referencesComplete) {
      held.push({ file, reason: 'blind' });
      continue;
    }
    if (hash === null) {
      held.push({ file, reason: 'unknown' });
      continue;
    }
    // mtime 在未来（时钟回拨/跨机复制）→ 差值为负 < retentionMs → 同样扣留（安全侧）。
    if (retentionMs > 0 && now - file.mtimeMs < retentionMs) {
      held.push({ file, reason: 'recent' });
      continue;
    }
    deletable.push(file);
  }

  return { deletable, held };
}
