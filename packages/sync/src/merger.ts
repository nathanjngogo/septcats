import {
  SCHEMA_VERSION,
  decodeSegment,
  replay,
  type CrdtUpdateEntry,
  type Op,
  type Segment,
} from '@septcats/core';
import { SyncErrorCodes, type SyncReport } from './errors';
import { contentFingerprint, isSidecarCopy, parseSegmentFileName } from './naming';
import type { SyncProvider } from './provider';

/**
 * 核心合并器（任务书 §4）：远端段集合 + 本地账 → 新段计划 + SyncReport。
 *
 * 规则：
 *  a) 内容 hash 去重（byHash + duplicates）：同内容只处理一份，其余 skipped.duplicate；
 *  b) 段解析失败 / schema_ver 过高 → quarantined（不 throw，不中断整轮，S2）；
 *  c) 命中 seenContentHashes → skipped.duplicate（S3 网盘副本）；
 *  d) 全部合法段 + localLedger 交 core.replay → 只回写「本地没有的 op_id」到 applied（幂等）；
 *  e) 顺序无关：内部统一 sort by (c_from, dev, n)，不依赖 list() 顺序；
 *  f) crdt_update 分流（T19-04 §0.4）：不进 LWW（core.replay 自行收集，不作用于实体
 *     投影），报告以 crdtUpdates 透出，交上层 Y.Doc 幂等应用；applied 仍包含这些 op
 *     （照常入 op_ledger 审计真相层），payload 字节保真——sync 对 updateB64 不透明、
 *     不解码不改写。
 *
 * 快照播种（§4 规则 a 的 S5）与 needsSnapshot 由 C 阶段（snapshot.ts）负责。
 */

/**
 * 跨报告合并 crdtUpdates（T19-04 §0.4）：按 opId 去重取并集。
 *
 * 每份输入都假定已处于 core.replay 的全序（lamport, deviceId, op_id 升序）——
 * 本函数不重排、只做保序并集（先到者留下），因此：
 * - 同输入任意次调用结果逐项一致（确定性）；
 * - 各报告内部的全序在结果中保持相对先后（稳定）。
 * opId 是去重键（审计可回溯 op_ledger 的 op_id）。
 */
export function mergeCrdtUpdates(
  existing: readonly CrdtUpdateEntry[],
  incoming: readonly CrdtUpdateEntry[],
): CrdtUpdateEntry[] {
  const seen = new Set<string>();
  const out: CrdtUpdateEntry[] = [];
  for (const entry of [...existing, ...incoming]) {
    if (seen.has(entry.opId)) {
      continue;
    }
    seen.add(entry.opId);
    out.push(entry);
  }
  return out;
}

export interface MergeInput {
  provider: SyncProvider;
  /** 本地已应用（op_ledger 导出）。 */
  localLedger: Op[];
  /** 去重记忆（段文件 sha256）；mergeRemote 会向其中追加已处理段的 hash。 */
  seenContentHashes: Set<string>;
  /** 本轮墙上时间（ms）；供 C 阶段 retention/快照决策使用，B 阶段暂未消费。 */
  now: number;
}

/** 段文件名排序键：(c_from, dev, n, copySuffix)，不可解析者排最后。 */
function segmentSortKey(name: string): [number, string, number, number] {
  const info = parseSegmentFileName(name);
  if (info === null) {
    return [Number.POSITIVE_INFINITY, '', 0, 0];
  }
  return [info.cFrom, info.dev, info.n, info.copySuffix];
}

function compareSegmentFiles(a: string, b: string): number {
  const ka = segmentSortKey(a);
  const kb = segmentSortKey(b);
  for (let i = 0; i < 4; i += 1) {
    const va = ka[i] ?? 0;
    const vb = kb[i] ?? 0;
    if (va !== vb) {
      return va < vb ? -1 : 1;
    }
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

/** 同内容副本里优先选「非网盘副本」为规范文件，其次按排序键。 */
function compareForCanonical(a: string, b: string): number {
  const aSide = isSidecarCopy(a) ? 1 : 0;
  const bSide = isSidecarCopy(b) ? 1 : 0;
  if (aSide !== bSide) {
    return aSide - bSide;
  }
  return compareSegmentFiles(a, b);
}

/** 段解码失败时归类原因（返回稳定错误码），供 quarantined.reason 使用。 */
function classifySegmentError(text: string): string {
  // 1) 未来 schema_ver：首行段头可解析且高于本端 → 拒收并提示升级。
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  try {
    const parsed = JSON.parse(firstLine) as { h?: { schema_ver?: unknown } };
    const schemaVer = parsed?.h?.schema_ver;
    if (typeof schemaVer === 'number' && Number.isInteger(schemaVer) && schemaVer > SCHEMA_VERSION) {
      return SyncErrorCodes.SCHEMA_TOO_NEW;
    }
  } catch {
    // 首行非 JSON → 继续走截断/结构判定。
  }
  // 2) 合法段 encodeSegment 恒以 '\n' 结尾；半截写截断 → 无结尾换行。
  if (!text.endsWith('\n')) {
    return SyncErrorCodes.SEGMENT_TRUNCATED;
  }
  return SyncErrorCodes.SEGMENT_INVALID;
}

export async function mergeRemote(input: MergeInput): Promise<SyncReport> {
  const { provider, localLedger, seenContentHashes } = input;

  const report: SyncReport = {
    pulled: 0,
    applied: [],
    skipped: [],
    quarantined: [],
    conflicts: [],
    crdtUpdates: [],
    highWatermark: 0,
    needsSnapshot: false,
  };

  const localOpIds = new Set(localLedger.map((op) => op.op_id));
  let highWatermark = 0;
  for (const op of localLedger) {
    highWatermark = Math.max(highWatermark, op.lamport.c);
  }

  // 1) 读全部段内容并计算 hash，构建 byHash 索引（复用 §4 buildFileIndex 语义）。
  const fileText = new Map<string, string>();
  const byHash = new Map<string, string[]>();
  for (const { file } of await provider.listSegments()) {
    const text = await provider.get(file);
    if (text === null) {
      continue; // list 与 get 之间文件消失，跳过
    }
    fileText.set(file, text);
    const hash = contentFingerprint(text);
    const group = byHash.get(hash);
    if (group === undefined) {
      byHash.set(hash, [file]);
    } else {
      group.push(file);
    }
  }

  // 2) 每个 hash 组选一个规范文件，其余记为 duplicate；命中记忆则整组 duplicate。
  const canonical: string[] = [];
  for (const [hash, files] of byHash) {
    files.sort(compareForCanonical);
    if (seenContentHashes.has(hash)) {
      for (const file of files) {
        report.skipped.push({ file, reason: 'duplicate' });
      }
      continue;
    }
    canonical.push(files[0] ?? '');
    for (const file of files.slice(1)) {
      report.skipped.push({ file, reason: 'duplicate' });
    }
  }
  canonical.sort(compareSegmentFiles);

  // 3) 逐规范文件解码：空 → empty；坏 → quarantined（不抛）；好 → 收 op 并标记内容已见。
  const remoteOps: Op[] = [];
  for (const file of canonical) {
    if (file === '') {
      continue;
    }
    report.pulled += 1;
    const text = fileText.get(file);
    if (text === undefined) {
      continue;
    }

    if (text.trim() === '') {
      report.skipped.push({ file, reason: 'empty' });
      continue;
    }

    let segment: Segment;
    try {
      segment = decodeSegment(text);
    } catch {
      report.quarantined.push({ file, reason: classifySegmentError(text) });
      continue;
    }

    seenContentHashes.add(contentFingerprint(text));

    if (segment.ops.every((op) => localOpIds.has(op.op_id))) {
      report.skipped.push({ file, reason: 'already-applied' });
      continue;
    }

    for (const op of segment.ops) {
      if (!localOpIds.has(op.op_id)) {
        remoteOps.push(op);
        highWatermark = Math.max(highWatermark, op.lamport.c);
      }
    }
  }

  // 4) 交 core.replay 判定冲突（禁止在 sync 里另写冲突判定）。
  //    crdt_update 由 replay 分派层收集（不进 LWW、不碰实体投影）；
  //    本地已有的 crdt_update 一并参与 replay（保证去重键 seen 覆盖本地），但报告只
  //    透出「对本地为新 op」的条目（与 applied 的幂等口径一致，避免上层重复应用）。
  const { report: replayReport } = replay([...localLedger, ...remoteOps]);
  const remoteOpIds = new Set(remoteOps.map((op) => op.op_id));

  report.applied = remoteOps;
  report.conflicts = replayReport.conflicts;
  report.crdtUpdates = replayReport.crdtUpdates.filter((entry) => remoteOpIds.has(entry.opId));
  report.highWatermark = highWatermark;

  return report;
}
