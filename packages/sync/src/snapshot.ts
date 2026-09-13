import {
  opsToSnapshot,
  replay,
  snapshotToOps,
  type ActorId,
  type Segment,
} from '@septcats/core';
import { SkipError } from './errors';
import type { SyncFs } from './fs';
import type { Manifest } from './manifest';

/**
 * 快照生成（任务书 §4）：折叠旧段 -> snapshot-N.json + 保留集计算（S6）。
 *
 * - `planSnapshot` 只产出折叠计划（through + foldSegIds），不写盘；
 * - `buildSnapshotText` 把折叠集重放成投影后压成稳定键序快照文本；
 * - `publishSnapshot` 幂等 ifAbsent 写盘（S6 崩溃后重跑 -> 'existed'）。
 * 段不可变（铁律 §0）：快照只读不写回旧段。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 快照折叠计划：through 为折叠上界（某段的 c_to），foldSegIds 为待折叠段（按 (c_from,dev,n) 升序）。 */
export interface SnapshotPlan {
  through: number;
  foldSegIds: string[];
}

/** 段排序键：(c_from, dev, n)，升序。 */
function compareSegments(a: Segment, b: Segment): number {
  if (a.header.c_from !== b.header.c_from) {
    return a.header.c_from < b.header.c_from ? -1 : 1;
  }
  if (a.header.dev !== b.header.dev) {
    return a.header.dev < b.header.dev ? -1 : 1;
  }
  if (a.header.n !== b.header.n) {
    return a.header.n < b.header.n ? -1 : 1;
  }
  return 0;
}

/**
 * 计算折叠计划。
 *
 * 折叠条件（任务书 §4）：
 * - retention 已过：段 created_at 距今（以 manifest.updated_at 为最近活动参考）超过 retention_days；
 * - 段数 > maxKeepSegs：折叠最老的 (count - maxKeepSegs) 段。
 * 两者取较大者为折叠数量；through 恒为某段的 c_to（绝不切在段中间）。
 * 无段可折叠（段数为 0 或无需折叠）返回 null。
 */
export function planSnapshot(
  allSegs: Segment[],
  current: Manifest,
  maxKeepSegs: number,
): SnapshotPlan | null {
  const sorted = [...allSegs].sort(compareSegments);
  const unfolded = sorted.filter((seg) => seg.header.c_to > current.snapshot.covers_through);
  if (unfolded.length === 0) {
    return null;
  }

  const referenceNow = current.updated_at > 0 ? current.updated_at : current.created_at;
  const retentionMs = current.retention_days * DAY_MS;

  // retention-cut：从最老段起，连续满足「created_at + retention <= now」的前缀长度。
  let retentionCut = 0;
  for (const seg of unfolded) {
    if (seg.header.created_at + retentionMs <= referenceNow) {
      retentionCut += 1;
    } else {
      break;
    }
  }

  // count-cut：段数超限时必须折叠掉最老的 count - maxKeepSegs 段。
  const countCut = Math.max(0, unfolded.length - maxKeepSegs);
  const foldCount = Math.max(retentionCut, countCut);
  if (foldCount <= 0) {
    return null;
  }

  const toFold = unfolded.slice(0, foldCount);
  const last = toFold[toFold.length - 1];
  if (last === undefined) {
    return null;
  }
  return {
    through: last.header.c_to,
    foldSegIds: toFold.map((seg) => seg.seg_id),
  };
}

/**
 * 把覆盖到 through 的段折叠成快照文本（稳定键序，`{v, entities}`）。
 *
 * 只折叠整段（c_to <= through），绝不切在段中间；重放后经 core.opsToSnapshot 压平，
 * 并自检「该快照可被 dev 播种回读」（snapshotToOps 往返不抛）——这是 S5 新设备追平的前置不变量。
 */
export function buildSnapshotText(segments: Segment[], through: number, dev: ActorId): string {
  const toFold = segments.filter((seg) => seg.header.c_to <= through);
  const ops = toFold.flatMap((seg) => seg.ops);
  const { projection } = replay(ops);
  const text = opsToSnapshot(projection);
  // 自检：快照必须能经 snapshotToOps(snap, dev) 回转，供新设备播种（S5）。
  snapshotToOps(text, dev);
  return text;
}

/** 快照文件名：`snapshot-<seq:6hex>.json`（与 provider.SNAPSHOT_NAME_RE 对齐）。 */
function snapshotName(seq: number): string {
  return `snapshot-${String(seq).padStart(6, '0')}.json`;
}

/** 快照路径：`<prefix>/<snapshotName>`（prefix 可为空）。 */
function snapshotPath(prefix: string, name: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed === '' ? name : `${trimmed}/${name}`;
}

/**
 * 原子发布一个快照：ifAbsent 写入；已存在（同名=同 seq）→ 'existed'（幂等，S6）。
 * 半写崩溃后重跑同 seq 得到 'existed'，不会产生第二个快照文件，水位由上层据 seq 维护、不因重跑翻倍。
 */
export async function publishSnapshot(
  fs: SyncFs,
  prefix: string,
  seq: number,
  text: string,
): Promise<'written' | 'existed'> {
  const path = snapshotPath(prefix, snapshotName(seq));
  try {
    await fs.write(path, text, { ifAbsent: true });
    return 'written';
  } catch (error) {
    if (error instanceof SkipError) {
      return 'existed';
    }
    throw error;
  }
}
