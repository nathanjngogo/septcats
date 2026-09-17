import {
  SnapshotValidationError,
  opsToSnapshot,
  replay,
  snapshotToOps,
  stableStringify,
  type ActorId,
  type CrdtUpdateEntry,
  type Op,
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
 *
 * crdtUpdates 区段（T19-04 §0.2/§0.3）：
 * - 实体投影仍由 LWW/字段级 LWW 折叠；`crdt_update` 的 Yjs 增量**原样保留、不丢不折叠**
 *   （Yjs update 本身幂等、可重复应用，无需在 sync 层合并）；
 * - 快照顶层新增 `crdtUpdates`（按 pageId 分组的 `{opId, updateB64, svFromB64?}` 列表），
 *   与实体投影并列；v1/v2 旧快照无该区段 → 读成空数组（向后兼容）；
 * - `seedFromSnapshot` 返回结构带上 crdtUpdates，供 desktop 层建 Y.Doc（T19-05）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 快照折叠计划：through 为折叠上界（某段的 c_to），foldSegIds 为待折叠段（按 (c_from,dev,n) 升序）。 */
export interface SnapshotPlan {
  through: number;
  foldSegIds: string[];
}

/** 快照 crdtUpdates 区段内的单条 update（对 sync 不透明，原样透传）。 */
export interface SnapshotCrdtUpdate {
  opId: string;
  updateB64: string;
  svFromB64?: string;
}

/** 快照 crdtUpdates 区段：按 pageId（页级 Y.Doc 键）分组。 */
export interface SnapshotCrdtPage {
  pageId: string;
  updates: SnapshotCrdtUpdate[];
}

/** seedFromSnapshot 的产出：播种 upsert op + 快照携带的 crdtUpdates。 */
export interface SeedFromSnapshotResult {
  seedOps: Op[];
  crdtUpdates: SnapshotCrdtPage[];
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
 * 把 core.replay 收集的 crdtUpdates 按 pageId 分组（保序：页按首次出现序，
 * 页内条目保持 replay 全序；opId 已由 replay 去重）。
 */
function groupCrdtUpdates(entries: readonly CrdtUpdateEntry[]): SnapshotCrdtPage[] {
  const pages: SnapshotCrdtPage[] = [];
  const byPageId = new Map<string, SnapshotCrdtPage>();
  for (const entry of entries) {
    let page = byPageId.get(entry.pageId);
    if (page === undefined) {
      page = { pageId: entry.pageId, updates: [] };
      byPageId.set(entry.pageId, page);
      pages.push(page);
    }
    const update: SnapshotCrdtUpdate = { opId: entry.opId, updateB64: entry.updateB64 };
    if (entry.svFromB64 !== undefined) {
      update.svFromB64 = entry.svFromB64;
    }
    page.updates.push(update);
  }
  return pages;
}

/** 读取并校验快照顶层 crdtUpdates 区段；缺失（v1 旧快照）→ 空数组；存在但畸形 → 校验错误。 */
function readCrdtUpdatesSection(raw: unknown): SnapshotCrdtPage[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return []; // 非对象顶层由 snapshotToOps/snapshotSchema 报错，此处不重复判型
  }
  const section = (raw as Record<string, unknown>)['crdtUpdates'];
  if (section === undefined) {
    return []; // v1/v2 旧快照：无该区段 → 空数组（T19-04 §0.2 向后兼容）
  }
  if (!Array.isArray(section)) {
    throw new SnapshotValidationError(['crdtUpdates 区段必须是数组']);
  }
  const pages: SnapshotCrdtPage[] = [];
  section.forEach((pageRaw, pageIndex) => {
    if (typeof pageRaw !== 'object' || pageRaw === null || Array.isArray(pageRaw)) {
      throw new SnapshotValidationError([`crdtUpdates[${pageIndex}] 必须是对象`]);
    }
    const page = pageRaw as Record<string, unknown>;
    if (typeof page['pageId'] !== 'string' || page['pageId'].length === 0) {
      throw new SnapshotValidationError([`crdtUpdates[${pageIndex}].pageId 必须是非空字符串`]);
    }
    if (!Array.isArray(page['updates'])) {
      throw new SnapshotValidationError([`crdtUpdates[${pageIndex}].updates 必须是数组`]);
    }
    const updates: SnapshotCrdtUpdate[] = [];
    (page['updates'] as unknown[]).forEach((updateRaw, updateIndex) => {
      const at = `crdtUpdates[${pageIndex}].updates[${updateIndex}]`;
      if (typeof updateRaw !== 'object' || updateRaw === null || Array.isArray(updateRaw)) {
        throw new SnapshotValidationError([`${at} 必须是对象`]);
      }
      const update = updateRaw as Record<string, unknown>;
      if (typeof update['opId'] !== 'string' || update['opId'].length === 0) {
        throw new SnapshotValidationError([`${at}.opId 必须是非空字符串`]);
      }
      if (typeof update['updateB64'] !== 'string' || update['updateB64'].length === 0) {
        throw new SnapshotValidationError([`${at}.updateB64 必须是非空字符串`]);
      }
      const item: SnapshotCrdtUpdate = {
        opId: update['opId'],
        updateB64: update['updateB64'],
      };
      const sv = update['svFromB64'];
      if (sv !== undefined) {
        if (typeof sv !== 'string' || sv.length === 0) {
          throw new SnapshotValidationError([`${at}.svFromB64 必须是非空字符串或缺省`]);
        }
        item.svFromB64 = sv;
      }
      updates.push(item);
    });
    pages.push({ pageId: page['pageId'], updates });
  });
  return pages;
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
 * 把覆盖到 through 的段折叠成快照文本（稳定键序，`{v, entities, crdtUpdates}`）。
 *
 * 只折叠整段（c_to <= through），绝不切在段中间；实体投影经 core.opsToSnapshot 压平
 * （仍由 LWW/字段级 LWW 折叠），crdt_update 条目按 pageId 分组原样保留（不丢不折叠），
 * 并自检「该快照可被 dev 播种回读」（seedFromSnapshot 往返不抛）——这是 S5 新设备
 * 追平的前置不变量。
 */
export function buildSnapshotText(segments: Segment[], through: number, dev: ActorId): string {
  const toFold = segments.filter((seg) => seg.header.c_to <= through);
  const ops = toFold.flatMap((seg) => seg.ops);
  const { projection, report } = replay(ops);
  // core 文本只含 {v, entities}；在此之上并列 crdtUpdates 区段（sync 层职责，不改 core）。
  const core = JSON.parse(opsToSnapshot(projection)) as { v: unknown; entities: unknown[] };
  const text = stableStringify({
    v: core.v,
    entities: core.entities,
    crdtUpdates: groupCrdtUpdates(report.crdtUpdates),
  });
  // 自检：快照必须能经 seedFromSnapshot(snap, dev) 回转，供新设备播种（S5）。
  seedFromSnapshot(text, dev);
  return text;
}

/**
 * 快照播种（S5，T19-04 §0.3）：快照文本 → 播种 upsert op + crdtUpdates。
 *
 * - seedOps 复用 core.snapshotToOps（校验 v 区间/entities 外形；v1 快照照常可读）；
 * - crdtUpdates 读顶层区段：缺失（v1/v2 旧快照）→ 空数组；存在但畸形 → SnapshotValidationError；
 * - desktop 层据 crdtUpdates 建各页 Y.Doc（否则新设备同步后文本层是空的）。
 */
export function seedFromSnapshot(snap: string, dev: ActorId): SeedFromSnapshotResult {
  const seedOps = snapshotToOps(snap, dev);
  let raw: unknown;
  try {
    raw = JSON.parse(snap);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SnapshotValidationError([`不是合法 JSON：${reason}`]);
  }
  return { seedOps, crdtUpdates: readCrdtUpdatesSection(raw) };
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
