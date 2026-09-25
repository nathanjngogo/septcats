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
