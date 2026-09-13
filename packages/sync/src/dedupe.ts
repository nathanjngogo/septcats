/**
 * 内容寻址附件索引（任务书 §4）：sha256 -> 路径，网盘副本去重（S3 口径）。
 *
 * 输入文件的 `sha` 由调用方按内容计算（见 naming.contentFingerprint）；本函数只负责
 * 把同 hash 的文件归组并标记非规范副本为 duplicate，不碰文件内容。
 */

export interface FileRef {
  file: string;
  sha?: string;
}

export interface FileIndex {
  /** sha256 -> 同名内容文件列表（按文件名字典序，首个为规范副本）。 */
  byHash: Map<string, string[]>;
  /** 非规范副本（同 hash 组内第 2 个及以后）的文件名。 */
  duplicates: string[];
}

/**
 * 按内容 hash 建立文件索引。
 *
 * - 有 sha 的文件按 hash 归组（byHash 含单文件组，便于按 hash 查路径）；
 * - 同 hash 多副本时，字典序首个为规范副本，其余计入 duplicates（S3 网盘副本去重）；
 * - 无 sha 的文件不参与内容去重（无法判定内容相同），直接跳过。
 */
export function buildFileIndex(files: FileRef[]): FileIndex {
  const byHash = new Map<string, string[]>();
  for (const { file, sha } of files) {
    if (sha === undefined) {
      continue;
    }
    const group = byHash.get(sha);
    if (group === undefined) {
      byHash.set(sha, [file]);
    } else {
      group.push(file);
    }
  }

  const duplicates: string[] = [];
  for (const names of byHash.values()) {
    names.sort();
    if (names.length > 1) {
      duplicates.push(...names.slice(1));
    }
  }

  return { byHash, duplicates };
}
