import { SCHEMA_VERSION, decodeSegment } from '@septcats/core';
import { SyncErrorCodes, type SyncQuarantineEntry } from './errors';

/**
 * 坏段隔离清单生成（任务书 §4）：只计算「哪些段该搬进 quarantine/」，真正的搬移语义在 runtime。
 *
 * 判定标准与合并器一致：半截（缺结尾换行）→ SEGMENT_TRUNCATED；首行可解析且 schema_ver
 * 高于本端 → SCHEMA_TOO_NEW；其余解码失败 → SEGMENT_INVALID。空内容不隔离（按 empty 处理）。
 */

/** 段文件候选：file 为文件名，text 为其内容。 */
export interface SegmentCandidate {
  file: string;
  text: string;
}

/** 段解码失败时归类原因（返回稳定错误码），与 merger 的归类口径保持一致。 */
function classifySegmentError(text: string): string {
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
  if (!text.endsWith('\n')) {
    return SyncErrorCodes.SEGMENT_TRUNCATED;
  }
  return SyncErrorCodes.SEGMENT_INVALID;
}

/**
 * 计算坏段隔离清单：对每个候选段尝试解码，失败的记入结果（file + 稳定 reason）。
 * 空内容视为「空段」而非坏段，不隔离。
 */
export function planQuarantine(candidates: SegmentCandidate[]): SyncQuarantineEntry[] {
  const out: SyncQuarantineEntry[] = [];
  for (const { file, text } of candidates) {
    if (text.trim() === '') {
      continue;
    }
    try {
      decodeSegment(text);
    } catch {
      out.push({ file, reason: classifySegmentError(text) });
    }
  }
  return out;
}
