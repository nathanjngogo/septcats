/**
 * rank.ts —— 命令面板的**纯打分/过滤函数**（TASK-T8-01 §3/§4，抽离 UI）。
 *
 * 匹配通道与 editor 的 slashMenu 同风格：中文 label 子串 / 拼音别名全等 /
 * 前缀 / 包含，稳定排序（同分按内置顺序，绝不抖动）。
 * 输入前缀模式：`>` = 仅命令，`@` = 仅页面（§3），无前缀 = 混合（命令 / 页面 / 数据库分组）。
 * 本文件不 import React / store / IPC —— palette.test.ts 直测。
 */
import type { SearchHit } from '../../../shared/search';

export type PaletteMode = 'auto' | 'command' | 'page';

export interface CommandLike {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  /** 展示用说明（可选；纯数据场景可缺省）。 */
  readonly hint?: string;
}

/** 命中条目（SearchHit 的展示子集；直接复用线上类型保证两侧一致）。 */
export type HitLike = Pick<
  SearchHit,
  'kind' | 'id' | 'pageId' | 'title' | 'path' | 'snippet' | 'via'
>;

/** 解析前缀模式：`>` 仅命令、`@` 仅页面，其余 auto。raw 是去掉前缀后的输入。 */
export function parsePaletteMode(query: string): { mode: PaletteMode; raw: string } {
  if (query.startsWith('>')) {
    return { mode: 'command', raw: query.slice(1) };
  }
  if (query.startsWith('@')) {
    return { mode: 'page', raw: query.slice(1) };
  }
  return { mode: 'auto', raw: query };
}

/**
 * 命令打分（与 editor slashMenu.scoreItem 同风格）：
 * label 含 query → 400；别名全等 → 350；别名前缀 → 300；别名包含 → 200；其余 0。
 * orderBonus 保证同分时内置顺序稳定。
 */
export function scoreCommand(item: CommandLike, query: string, index: number, total: number): number {
  const orderBonus = total - index;
  if (item.label.toLowerCase().includes(query)) {
    return 400 + orderBonus;
  }
  if (item.aliases.some((alias) => alias === query)) {
    return 350 + orderBonus;
  }
  if (item.aliases.some((alias) => alias.startsWith(query))) {
    return 300 + orderBonus;
  }
  if (item.aliases.some((alias) => alias.includes(query))) {
    return 200 + orderBonus;
  }
  return 0;
}

/** query → 命令候选（稳定：同分按内置顺序；空 raw 返回全部）。 */
export function rankCommands<TCommand extends CommandLike>(
  raw: string,
  commands: readonly TCommand[],
): TCommand[] {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return [...commands];
  }
  const scored: Array<{ item: TCommand; score: number; index: number }> = [];
  commands.forEach((item, index) => {
    const score = scoreCommand(item, normalized, index, commands.length);
    if (score > 0) {
      scored.push({ item, score, index });
    }
  });
  scored.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.index - b.index));
  return scored.map((entry) => entry.item);
}

export interface PaletteView<TCommand extends CommandLike = CommandLike, THit extends HitLike = HitLike> {
  mode: PaletteMode;
  /** 去掉前缀后的输入。 */
  raw: string;
  commands: TCommand[];
  /** kind = 'page' 的命中（页面与跳转组）。 */
  pageHits: THit[];
  /** kind ∈ block/collection/record 的命中（数据库组）。 */
  dbHits: THit[];
}

/**
 * 面板总打分（§4 纯函数 `rank(query, cmds+hits)`）：
 * - auto：命令 + 页面 + 数据库三组全展示（服务端序）；
 * - `>`：仅命令；
 * - `@`：仅页面。
 * 泛型保形：state 里传 PaletteCommand[] / SearchHit[] 进来，取出来仍带 run()/via 等字段。
 */
export function rankPalette<TCommand extends CommandLike, THit extends HitLike>(
  query: string,
  commands: readonly TCommand[],
  hits: readonly THit[],
): PaletteView<TCommand, THit> {
  const { mode, raw } = parsePaletteMode(query);

  if (mode === 'command') {
    return { mode, raw, commands: rankCommands(raw, commands), pageHits: [], dbHits: [] };
  }
  if (mode === 'page') {
    return {
      mode,
      raw,
      commands: [],
      pageHits: hits.filter((hit) => hit.kind === 'page'),
      dbHits: [],
    };
  }
  return {
    mode,
    raw,
    commands: rankCommands(raw, commands),
    pageHits: hits.filter((hit) => hit.kind === 'page'),
    dbHits: hits.filter((hit) => hit.kind !== 'page'),
  };
}

/** 可选中行总数（供键盘循环取模；分组标题不可选）。 */
export function selectableRowCount(view: PaletteView<CommandLike, HitLike>): number {
  return view.commands.length + view.pageHits.length + view.dbHits.length;
}
