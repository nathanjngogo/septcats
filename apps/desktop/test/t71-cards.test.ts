// @vitest-environment jsdom
/**
 * t71-cards.test.ts —— TASK-T71-01：卡片注册表 + v2 迁移 + 新卡纯函数（无 DOM 核心）。
 *
 * 覆盖：
 * - 注册表：REGISTERED_CARD_IDS 含 5 内置 + 6 新（共 11）；CARD_DEFS 全定义。
 * - settings 守卫：wbcardRead/write（septcats.wbcard.<key>，野 JSON→def）。
 * - v1→v2 迁移：预埋 v1 串 → 旧序保持 + 新卡追加默认位 + 版本升 2 + 未知 id 丢弃。
 * - 拖拽重排纯函数 moveCardTo；v2 写读往返。
 * - 新卡纯逻辑：daysUntil（倒计时天数/非法）、normalizeHeatmap（7 格 4 档）、
 *   computeLibStats（库统计聚合）、firstTextOfBlock（摘抄取首文本）、各 settings 净化器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_CARD_IDS,
  DEFAULT_CARD_ORDER,
  WORKBENCH_CARDS_STORAGE_KEY,
  moveCardTo,
  readCardsPersist,
  sanitizeCardsPersist,
  workbenchActions,
  workbenchStore,
} from '../src/renderer/src/workbench/state';
import {
  CARD_DEFS,
  REGISTERED_CARD_IDS,
  wbcardRead,
  wbcardWrite,
  computeLibStats,
  daysUntil,
  firstTextOfBlock,
} from '../src/renderer/src/workbench/cards';
import { normalizeHeatmap, readActivityDays, bumpActivityToday } from '../src/renderer/src/workbench/activity';
import { blockContentTextLines, textOfBlockContent } from '@septcats/editor';

beforeEach(() => {
  window.localStorage.clear();
  workbenchStore.setState((state) => ({
    ...state,
    view: 'pages',
    cardOrder: [...DEFAULT_CARD_ORDER],
    hiddenCards: [],
  }));
});

afterEach(() => {
  window.localStorage.clear();
});

describe('T71-01 注册表', () => {
  it('REGISTERED_CARD_IDS = 5 内置 + 6 新 = 11；CARD_DEFS 全定义且 render 为函数', () => {
    expect(REGISTERED_CARD_IDS).toHaveLength(11);
    for (const id of ALL_CARD_IDS) {
      expect(CARD_DEFS[id], id).toBeDefined();
      expect(typeof CARD_DEFS[id].render).toBe('function');
    }
    expect(CARD_DEFS.quick.labelKey).toBe('workbench.cardQuick');
    expect(CARD_DEFS.libstats.labelKey).toBe('workbench.cardLibstats');
  });

  it('内置 5 卡 labelKey 不变（T66 探针口径）', () => {
    expect([CARD_DEFS.quick, CARD_DEFS.todo, CARD_DEFS.database, CARD_DEFS.recent, CARD_DEFS.favorites].map((d) => d.labelKey)).toEqual([
      'workbench.cardQuick',
      'workbench.cardTodo',
      'workbench.cardDatabase',
      'workbench.cardRecent',
      'workbench.cardFavorites',
    ]);
  });
});

describe('T71-01 settings 守卫', () => {
  it('wbcardRead/write 往返；野 JSON→def；缺键→def', () => {
    expect(wbcardRead('shortcut.links', [{ pageId: 'x' }])).toEqual([{ pageId: 'x' }]);
    wbcardWrite('countdown.items', [{ label: '发布', date: '2026-10-01' }]);
    expect(wbcardRead('countdown.items', [])).toEqual([{ label: '发布', date: '2026-10-01' }]);
    window.localStorage.setItem('septcats.wbcard.bookmarks.list', 'not json');
    expect(wbcardRead('bookmarks.list', [] as unknown[])).toEqual([]);
    expect(wbcardRead('never.set', 42)).toBe(42);
  });
});

describe('T71-01 v1→v2 迁移（单测钉）', () => {
  it('预埋 v1 串 → 旧序保持 + 6 新卡追加默认位 + 版本升 2 + 未知 id 丢弃', () => {
    window.localStorage.setItem(
      WORKBENCH_CARDS_STORAGE_KEY,
      JSON.stringify({ v: 1, order: ['todo', 'quick'], hidden: ['recent', 'ghost'] }),
    );
    const persist = readCardsPersist();
    expect(persist).not.toBeNull();
    expect(persist?.v).toBe(2);
    // todo,quick 保序；缺失默认（database/favorites + 6 新）补尾
    expect(persist?.order).toEqual([
      'todo',
      'quick',
      'database',
      'recent',
      'favorites',
      'shortcut',
      'countdown',
      'heatmap',
      'quote',
      'bookmarks',
      'libstats',
    ]);
    // recent 保留；ghost 丢弃
    expect(persist?.hidden).toEqual(['recent']);
  });

  it('v2 写读往返：order/hidden 原样；未知 id 丢弃', () => {
    workbenchActions.setCardHidden('libstats', true);
    workbenchActions.reorderCard('shortcut', 'database');
    const persist = readCardsPersist();
    expect(persist?.v).toBe(2);
    expect(persist?.hidden).toEqual(['libstats']);
    expect(persist?.order[0]).toBe('quick');
    // 手动塞入未知 id → sanitize 丢弃
    const dirty = sanitizeCardsPersist({ v: 2, order: ['quick', 'zxx', 'todo'], hidden: ['libstats'] });
    expect(dirty?.order).toEqual(['quick', 'todo', 'database', 'recent', 'favorites', 'shortcut', 'countdown', 'heatmap', 'quote', 'bookmarks', 'libstats']);
    expect(dirty?.hidden).toEqual(['libstats']);
  });

  it('sanitizeCardsPersist 拒野 JSON（非对象/数组/版本不符/缺字段）', () => {
    for (const raw of [null, [], 'x', { v: 9, order: [], hidden: [] }, { v: 2, order: 'bad', hidden: [] }, { order: [] }]) {
      expect(sanitizeCardsPersist(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe('T71-01 拖拽重排纯函数', () => {
  it('moveCardTo：把 from 插到 to 之前；同 id/越界返回 null', () => {
    const order = ['quick', 'todo', 'database', 'recent', 'favorites'] as const;
    expect(moveCardTo([...order], 'quick', 'database')).toEqual(['todo', 'quick', 'database', 'recent', 'favorites']);
    expect(moveCardTo([...order], 'recent', 'quick')).toEqual(['recent', 'quick', 'todo', 'database', 'favorites']);
    expect(moveCardTo([...order], 'quick', 'quick')).toBeNull();
    expect(moveCardTo([...order], 'ghost' as never, 'todo')).toBeNull();
  });

  it('reorderCard action 即时写 v2 落盘', () => {
    workbenchActions.reorderCard('favorites', 'quick');
    expect(workbenchStore.getState().cardOrder[0]).toBe('favorites');
    expect(readCardsPersist()?.order[0]).toBe('favorites');
  });
});

describe('T71-01 倒计时天数 daysUntil', () => {
  it('合法日期算天数；非法→null', () => {
    expect(daysUntil('2026-10-01', new Date(2026, 8, 23))).toBe(8);
    expect(daysUntil('2026-09-23', new Date(2026, 8, 23))).toBe(0);
    expect(daysUntil('2026-09-20', new Date(2026, 8, 23))).toBe(-3);
    expect(daysUntil('not-a-date', new Date(2026, 8, 23))).toBeNull();
  });
});

describe('T71-01 热力归一化 normalizeHeatmap', () => {
  it('近 7 天 4 档；max 归一；缺失=0 档', () => {
    const now = new Date(2026, 8, 23);
    const cells = normalizeHeatmap({ '2026-09-23': 3, '2026-09-22': 1 }, now);
    expect(cells).toHaveLength(7);
    const today = cells[cells.length - 1] as { date: string; count: number; level: number };
    expect(today.date).toBe('2026-09-23');
    expect(today.count).toBe(3);
    expect(today.level).toBe(3);
    const yest = cells[cells.length - 2] as { count: number; level: number };
    expect(yest.count).toBe(1);
    expect(yest.level).toBe(1);
    // 其余全 0 档
    expect(cells.filter((c) => c.level === 0).length).toBe(5);
  });

  it('bumpActivityToday 写点唯一：今日 +1；读回守恒', () => {
    expect(readActivityDays()).toEqual({});
    bumpActivityToday(new Date(2026, 8, 23));
    bumpActivityToday(new Date(2026, 8, 23));
    expect(readActivityDays()['2026-09-23']).toBe(2);
  });
});

describe('T71-01 库统计 computeLibStats', () => {
  it('聚合页面数 / 最深层级 / database 数 / 收藏数', () => {
    const nodes = [
      { id: 'a', alive: 1, parentId: null, pageType: 'page' },
      { id: 'b', alive: 1, parentId: 'a', pageType: 'page' },
      { id: 'c', alive: 1, parentId: 'b', pageType: 'database' },
      { id: 'd', alive: 0, parentId: null, pageType: 'page' },
      { id: 'e', alive: 1, parentId: null, pageType: 'page' },
    ] as never;
    const stats = computeLibStats(nodes, ['a', 'e']);
    expect(stats.pageCount).toBe(4); // 存活 4
    expect(stats.dbCount).toBe(1); // c
    expect(stats.maxDepth).toBe(3); // a→b→c
    expect(stats.favCount).toBe(2); // a,e
  });
});

describe('T71-01 摘抄取首文本 firstTextOfBlock', () => {
  it('PM doc 取首个 text；code 字符串原样；空→null', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好世界' }] }] };
    expect(firstTextOfBlock(doc)).toBe('你好世界');
    expect(firstTextOfBlock('纯文本块')).toBe('纯文本块');
    expect(firstTextOfBlock({ type: 'doc', content: [{ type: 'image' }] })).toBeNull();
    expect(firstTextOfBlock(null)).toBeNull();
  });

  // T82-02（H-07）：table/toggle 结构化 content 三形各钉。
  // 修复前两形恒 null（卡片显示空摘要）。
  it('T82-02：table 结构化 → 首个非空单元格（不是 null）', () => {
    expect(firstTextOfBlock({ rows: [['格A', '格B'], ['格C', '格D']], header: true })).toBe('格A');
    // 首格为空 → 取下一个非空格（阅读序）
    expect(firstTextOfBlock({ rows: [['', '格B']], header: true })).toBe('格B');
    // 全空表 → null（与旧口径的空摘要一致，不产假文本）
    expect(firstTextOfBlock({ rows: [['', '']], header: true })).toBeNull();
  });

  it('T82-02：toggle 结构化 → title（title 为空则落到 body 首行）', () => {
    expect(firstTextOfBlock({ title: '折叠标题Q', body: ['正文行R'] })).toBe('折叠标题Q');
    expect(firstTextOfBlock({ title: '', body: ['正文行R'] })).toBe('正文行R');
    expect(firstTextOfBlock({ title: '', body: [''] })).toBeNull();
  });

  // 防实现再次分叉（T79 缺陷 A 教训）：renderer 侧与 main 侧**同读一行**，
  // 断言两侧文本一致——两侧都经 @septcats/editor 的 blockContentTextLines 单一实现。
  it('T82-02：与 main 侧 textOfBlockContent 同源（同一实现，文本一致）', () => {
    const shapes: unknown[] = [
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '段落文' }] }] },
      '纯文本块',
      { rows: [['格A', '格B'], ['格C', '']], header: true },
      { title: '折叠标题Q', body: ['正文行R'] },
      null,
      { type: 'divider' },
    ];
    for (const shape of shapes) {
      const rendererText = firstTextOfBlock(shape) ?? '';
      const mainText = textOfBlockContent(shape);
      expect(rendererText, `形态 ${JSON.stringify(shape)} 两侧不一致`).toBe(
        blockContentTextLines(shape)[0] ?? '',
      );
      // main 侧 join('') 与 renderer 首行：三形都来自同一分流，首行必是 main 文本的前缀
      expect(mainText.startsWith(rendererText), `形态 ${JSON.stringify(shape)} 不同源`).toBe(true);
    }
  });
});
