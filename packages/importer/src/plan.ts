/**
 * plan.ts —— 三源统一计划器（任务书 §3）。
 *
 * 职责：解析产物（items/warnings）→ **可执行 ImportPlan** 的全部计划期语义：
 * - 上限熔断：单计划 > 5000 items → throw PlanTooLargeError（E_TOO_LARGE，分批导）；
 * - 去重：对每个 page/collection 的 (path, contentHash) 经注入的 ExistingLookup 查
 *   import_source（desktop 用 SQL，测试用 Map）→ 命中即剔除 + skipped-duplicate warning
 *   （asset 内容寻址天然幂等，不做计划期去重）；
 * - 重名：同 path 冲突 → 后者追加内容 hash 前 6 位 + warning；
 * - 孤儿：parentPath 既不是现存条目 path、也不是任何条目 path 的目录前缀 → 挂根 + warning
 *   （兼容 A 阶段 md-dir 的「目录路径作 parentPath」约定与 B 阶段的「父页逻辑路径」约定）；
 * - counts 汇总（复用 types.buildPlan；skippedDuplicate 由本层回填）。
 *
 * 命名说明：types.ts（A 阶段已合入）已有 `buildPlan(source, items, warnings)`
 * 纯组装函数；本文件的三源统一入口同名——index.ts 以**显式 re-export** 让包根的
 * `buildPlan` 落到本文件版本，types 版本继续供各解析器内部经 './types' 使用。
 */
import { createHash } from 'node:crypto';
import { parseCsvFile } from './csvInfer';
import { parseMdDir, parseMdFile } from './markdown';
import { parseNotionZip } from './notion';
import { buildPlan as assemblePlan } from './types';
import type { ImportItem, ImportPlan, ImportSourceFs, ImportWarning } from './types';

// ---------------------------------------------------------------------------
// 注入面与熔断
// ---------------------------------------------------------------------------

/**
 * 已导入源查询：(path, contentHash) → 已存在的 page_id（未见过 → null）。
 * desktop 用 import_source 表 SQL 实现；测试用内存 Map。
 */
export type ExistingLookup = (path: string, contentHash: string) => string | null;

/** 单计划条目上限（任务书 §3）。 */
export const MAX_PLAN_ITEMS = 5000;

/** 熔断错误：code 恒为 'E_TOO_LARGE'（分批导语义，调用方按 code 分派）。 */
export class PlanTooLargeError extends Error {
  readonly code = 'E_TOO_LARGE';
  readonly itemCount: number;

  constructor(itemCount: number) {
    super(`E_TOO_LARGE: 单计划 ${itemCount} 个条目，超过上限 ${MAX_PLAN_ITEMS}，请分批导`);
    this.name = 'PlanTooLargeError';
    this.itemCount = itemCount;
  }
}

// ---------------------------------------------------------------------------
// 内容 hash（去重与重名后缀共用，键序规范化保证 JSON 形态稳定）
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 条目内容 hash：page={title,blocks}；collection={title,schema,records}；asset=item.hash。 */
export function contentHashOf(item: ImportItem): string {
  if (item.op === 'asset') {
    return item.hash;
  }
  const payload = item.op === 'page' ? { op: item.op, title: item.title, blocks: item.blocks } : { op: item.op, title: item.title, schema: item.schema, records: item.records };
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

// ---------------------------------------------------------------------------
// 计划期语义（解析产物 → 可执行计划）
// ---------------------------------------------------------------------------

/** 父路径是否可解析：是现存条目 path，或是任何条目 path 的目录前缀（md-dir 约定）。 */
function parentResolvable(parentPath: string, items: readonly ImportItem[]): boolean {
  return items.some(
    (item) => item.op !== 'asset' && (item.path === parentPath || item.path.startsWith(`${parentPath}/`)),
  );
}

export function finalizePlan(
  source: { kind: 'notion-zip' | 'md-dir' | 'md-file' | 'csv'; rootName: string },
  items: ImportItem[],
  warnings: ImportWarning[],
  existingLookup: ExistingLookup,
): ImportPlan {
  // 上限熔断（按解析产物原量判，先于一切增删）
  if (items.length > MAX_PLAN_ITEMS) {
    throw new PlanTooLargeError(items.length);
  }

  // 去重：命中 import_source 的 page/collection 剔除 + warning
  let skippedDuplicate = 0;
  const kept: ImportItem[] = [];
  for (const item of items) {
    if (item.op === 'asset') {
      kept.push(item);
      continue;
    }
    const existingId = existingLookup(item.path, contentHashOf(item));
    if (existingId !== null) {
      skippedDuplicate += 1;
      warnings.push({
        path: item.path,
        what: `已导入的${item.op === 'page' ? '页面' : '数据表'}`,
        action: 'skipped-duplicate',
        note: `(path, contentHash) 命中已导入记录（page ${existingId}），跳过`,
      });
      continue;
    }
    kept.push(item);
  }

  // 重名：path 冲突 → 后者追加内容 hash 前 6 位
  const seenPaths = new Set<string>();
  for (const item of kept) {
    if (item.op === 'asset' || !seenPaths.has(item.path)) {
      if (item.op !== 'asset') {
        seenPaths.add(item.path);
      }
      continue;
    }
    const suffix = contentHashOf(item).slice(0, 6);
    warnings.push({
      path: item.path,
      what: '路径冲突',
      action: 'degraded',
      note: `重名条目，path 追加 hash 前 6 位 → ${item.path}-${suffix}`,
    });
    item.path = `${item.path}-${suffix}`;
    seenPaths.add(item.path);
  }

  // 孤儿：父不可解析 → 挂根 + warning
  for (const item of kept) {
    if (item.op === 'asset' || item.parentPath === null) {
      continue;
    }
    if (!parentResolvable(item.parentPath, kept)) {
      warnings.push({
        path: item.path,
        what: '孤儿条目',
        action: 'degraded',
        note: `父级 “${item.parentPath}” 不存在，挂为根级`,
      });
      item.parentPath = null;
    }
  }

  const plan = assemblePlan(source, kept, warnings);
  plan.counts.skippedDuplicate = skippedDuplicate;
  return plan;
}

// ---------------------------------------------------------------------------
// 三源统一入口
// ---------------------------------------------------------------------------

export interface PlanSource {
  kind: 'notion-zip' | 'md-dir' | 'md-file' | 'csv';
  /** 源显示名（notion-zip/md-dir 必填；缺省用「Notion 导出」/「导入文档」） */
  rootName?: string;
  /** md-file / csv 源的源内文件路径 */
  path?: string;
}

/**
 * 三源统一入口：注入已解压文件集（ImportSourceFs）+ 已导入查询 → 可执行 ImportPlan。
 * - notion-zip → parseNotionZip；md-dir → parseMdDir；
 * - md-file → parseMdFile(source.path)；csv → parseCsvFile(source.path)。
 */
export function buildPlan(source: PlanSource, files: ImportSourceFs, existingLookup: ExistingLookup): ImportPlan {
  let parsed: ImportPlan;
  switch (source.kind) {
    case 'notion-zip':
      parsed = parseNotionZip(files, source.rootName ?? 'Notion 导出');
      break;
    case 'md-dir':
      parsed = parseMdDir(files, source.rootName ?? '导入文档');
      break;
    case 'md-file': {
      if (source.path === undefined || source.path.length === 0) {
        throw new Error('md-file 源必须提供 source.path');
      }
      parsed = parseMdFile(files, source.path);
      break;
    }
    case 'csv': {
      if (source.path === undefined || source.path.length === 0) {
        throw new Error('csv 源必须提供 source.path');
      }
      parsed = parseCsvFile(files, source.path);
      break;
    }
  }
  const rootName = parsed.source.rootName;
  return finalizePlan({ kind: source.kind, rootName }, parsed.items, [...parsed.warnings], existingLookup);
}
