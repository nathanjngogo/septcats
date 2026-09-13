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
