/**
 * slashMenu.ts —— 斜杠菜单**纯状态机**（不含任何 UI，UI 在 react/SlashMenu.tsx）。
 *
 * 匹配三通道：中文名（label 子串）/ 拼音全拼 / 拼音首字母 + 英文别名，稳定排序
 * （同分按内置顺序，绝不抖动）。内置 9 个块型的拼音表；标题给 H1–H3 三个菜单项，
 * 共用同一张关键词表。
 */
import type { BlockType } from '../model';

export interface SlashItem {
  /** 命令 id（标题带等级后缀，保证唯一）。 */
  id: string;
  blockType: BlockType;
  level?: 1 | 2 | 3;
  label: string;
  hint: string;
  keywords: readonly string[];
}

/** 9 个块型的拼音/英文关键词表（拼音首字母在 keywords 里，如 'bt'）。 */
export const SLASH_KEYWORDS: Record<BlockType, readonly string[]> = {
  paragraph: ['wenben', 'duanluo', 'wb', 'dl', 'text', 'paragraph', 'p'],
  heading: ['biaoti', 'bt', 'heading', 'title', 'h'],
  bulleted_list: ['wuxuliebiao', 'wxlb', 'bullet', 'bulleted', 'list', 'u'],
  numbered_list: ['youxuliebiao', 'yxlb', 'ordered', 'number', 'list', 'o'],
  to_do: ['daiban', 'dblb', 'todo', 'task', 'checkbox', 'd'],
  quote: ['yinyong', 'yy', 'quote', 'callout', 'blockquote', 'y'],
  code: ['daima', 'dmk', 'code', 'codeblock', 'c'],
  divider: ['fengexian', 'fgx', 'divider', 'hr', 'separator', 'f'],
  image: ['tupian', 'tp', 'image', 'img', 'picture', 't'],
};

function headingItem(level: 1 | 2 | 3, hint: string): SlashItem {
  return {
    id: `heading${String(level)}`,
    blockType: 'heading',
    level,
    label: `标题 ${String(level)}`,
    hint,
    keywords: SLASH_KEYWORDS.heading,
  };
}

/** 菜单顺序对齐 01-editor.html 的 .menu（文本 → 标题 → 列表 → 引用 → 代码 …）。 */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'paragraph',
    blockType: 'paragraph',
    label: '文本',
    hint: '普通段落',
    keywords: SLASH_KEYWORDS.paragraph,
  },
  headingItem(1, '页面级大标题'),
  headingItem(2, '大节标题'),
  headingItem(3, '小节标题'),
  {
    id: 'bulleted_list',
    blockType: 'bulleted_list',
    label: '无序列表',
    hint: '项目符号列表',
    keywords: SLASH_KEYWORDS.bulleted_list,
  },
  {
    id: 'numbered_list',
    blockType: 'numbered_list',
    label: '有序列表',
    hint: '自动编号列表',
    keywords: SLASH_KEYWORDS.numbered_list,
  },
  {
    id: 'to_do',
    blockType: 'to_do',
    label: '待办列表',
    hint: '可勾选任务',
    keywords: SLASH_KEYWORDS.to_do,
  },
  {
    id: 'quote',
    blockType: 'quote',
    label: '引用',
    hint: '引用 / 口径提醒（callout）',
    keywords: SLASH_KEYWORDS.quote,
  },
  {
    id: 'code',
    blockType: 'code',
    label: '代码块',
    hint: '语法高亮片段',
    keywords: SLASH_KEYWORDS.code,
  },
  {
    id: 'divider',
    blockType: 'divider',
    label: '分割线',
    hint: '视觉分隔',
    keywords: SLASH_KEYWORDS.divider,
  },
  {
    id: 'image',
    blockType: 'image',
    label: '图片',
    hint: '附件图片（内容寻址）',
    keywords: SLASH_KEYWORDS.image,
  },
];

function scoreItem(item: SlashItem, query: string, index: number): number {
  const orderBonus = SLASH_ITEMS.length - index;
  if (item.label.toLowerCase().includes(query)) {
    return 400 + orderBonus;
  }
  if (item.keywords.some((keyword) => keyword === query)) {
    return 350 + orderBonus;
  }
  if (item.keywords.some((keyword) => keyword.startsWith(query))) {
    return 300 + orderBonus;
  }
  if (item.keywords.some((keyword) => keyword.includes(query))) {
    return 200 + orderBonus;
  }
  return 0;
}

/** query → 候选块型（稳定：同分按内置顺序）。空 query 返回全部。 */
export function filterSlashCommands(query: string): SlashItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [...SLASH_ITEMS];
  }
  const scored: Array<{ item: SlashItem; score: number; index: number }> = [];
  SLASH_ITEMS.forEach((item, index) => {
    const score = scoreItem(item, normalized, index);
    if (score > 0) {
      scored.push({ item, score, index });
    }
  });
  scored.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.index - b.index));
  return scored.map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

export interface SlashMenuState {
  open: boolean;
  query: string;
  activeIndex: number;
  items: SlashItem[];
}

function clampIndex(index: number, size: number): number {
  if (size <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), size - 1);
}

export function createSlashMenuState(): SlashMenuState {
  return { open: false, query: '', activeIndex: 0, items: filterSlashCommands('') };
}

export function openSlashMenu(state: SlashMenuState, query = ''): SlashMenuState {
  const items = filterSlashCommands(query);
  return { open: true, query, activeIndex: clampIndex(state.activeIndex, items.length), items };
}

export function setSlashQuery(state: SlashMenuState, query: string): SlashMenuState {
  const items = filterSlashCommands(query);
  return { open: state.open, query, activeIndex: clampIndex(state.activeIndex, items.length), items };
}

/** delta = +1 下移 / -1 上移（循环）。 */
export function moveSlashActive(state: SlashMenuState, delta: number): SlashMenuState {
  const size = state.items.length;
  if (size === 0) {
    return { ...state, activeIndex: 0 };
  }
  const next = ((state.activeIndex + delta) % size + size) % size;
  return { ...state, activeIndex: next };
}

export function setSlashActive(state: SlashMenuState, index: number): SlashMenuState {
  return { ...state, activeIndex: clampIndex(index, state.items.length) };
}

export function closeSlashMenu(_state?: SlashMenuState): SlashMenuState {
  return { open: false, query: '', activeIndex: 0, items: filterSlashCommands('') };
}

export function activeSlashItem(state: SlashMenuState): SlashItem | null {
  if (!state.open) {
    return null;
  }
  return state.items[state.activeIndex] ?? null;
}
