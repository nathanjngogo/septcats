// @vitest-environment jsdom
/**
 * wikilink-resolve.test.tsx —— T44-01-1 双链「解析语义 ↔ 页面存活」对账回归。
 *
 * 背景（PM 真机 B3/B3b 实证）：目标页删除后，指向它的 `[[ ]]` 链接仍渲染为
 * 已解析（resolved ⇔ attrs.target 非空，且无人按存活态重估）。
 *
 * 覆盖：
 * - 纯函数：aliveIdSet / aliveTitleIndex（重名歧义）/ nextWikilinkTarget 双向规则；
 * - 组件（PageView 真编辑器，jsdom）：目标已删 → 渲染 unresolved（每次挂载都对账，
 *   即 reload 后仍 unresolved 的 B3b 语义）；目标存活 → 正常解析；回收站恢复
 *   （存活态翻转）→ 链接重新解析（不引入单向 bug）；点击未解析链接 → 走新建
 *   该标题页路径（claim#3）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（pageview-blocks-ui.test.tsx 同款）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@septcats/editor';
import { PageView } from '../src/renderer/src/pages/PageView';
import { pagesStore } from '../src/renderer/src/state/pages';
import {
  aliveIdSet,
  aliveTitleIndex,
  nextWikilinkTarget,
} from '../src/renderer/src/pages/wikilinkResolve';
import type { PageNodeView, SeptcatsApi } from '../src/types/window';

const WS = 'ws-1';
const SOURCE = 'pg-source';
const TARGET = 'pg-target';
const TARGET_TITLE = '链接目标页';
const OTHER = 'pg-other';

// ---- jsdom 布局桩：PM 的 posAtCoords/handleClickOn 依赖 elementFromPoint 与 Range 矩形 ----
type FakeRect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const fakeRect = (): FakeRect => ({ left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 });
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
if (typeof rangeProto['getClientRects'] !== 'function') {
  rangeProto['getClientRects'] = (): FakeRect[] => [fakeRect()];
  rangeProto['getBoundingClientRect'] = fakeRect;
}

function makeNode(id: string, title: string, alive: 0 | 1): PageNodeView {
  return {
    id,
    title,
    icon: null,
    cover: null,
    workspaceId: WS,
    parentId: null,
    sortKey: 'A00000000',
    version: 1,
    alive,
    deletedAt: alive === 1 ? null : 1_700_000_000_000,
    childIds: [],
    depth: 0,
  };
}

function linkBlock(id: string, target: string | null, title: string): Block {
  return {
    id,
    page_id: SOURCE,
    type: 'paragraph',
    props: {},
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '见 ' },
            { type: 'wikilink', attrs: { target, title, alias: null } },
          ],
        },
      ],
    },
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function makeBridge(block: Block) {
  return {
    blocks: {
      commit: vi.fn().mockResolvedValue(0),
      list: vi.fn().mockResolvedValue([block]),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    recent: {
      touch: vi.fn().mockResolvedValue({ pageIds: [] }),
      list: vi.fn().mockResolvedValue({ pageIds: [] }),
    },
    favorites: {
      list: vi.fn().mockResolvedValue({ pageIds: [] }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    workspaces: {
      list: vi
        .fn()
        .mockResolvedValue({ items: [{ id: WS, name: '个人工作区' }], activeId: WS }),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    collab: {
      attach: vi.fn().mockResolvedValue({ entries: [], ledgerHasCrdt: false }),
      apply: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockReturnValue(() => {}),
    },
    links: {
      backlinks: vi.fn().mockResolvedValue({ entries: [] }),
      rebuild: vi.fn().mockResolvedValue({ links: 0 }),
    },
    pages: {
      create: vi.fn().mockResolvedValue({ id: 'pg-new' }),
      rename: vi.fn().mockResolvedValue(undefined),
      tree: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue({ deleted: 1 }),
      restore: vi.fn().mockResolvedValue({ restored: 1 }),
    },
  };
}

type Bridge = ReturnType<typeof makeBridge>;

let bridge: Bridge;

function seedStore(nodes: PageNodeView[]): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    workspaceId: WS,
    nodes,
    tabs: [SOURCE],
    selectedId: SOURCE,
  }));
}

beforeEach(() => {
  bridge = makeBridge(linkBlock('blk-link', TARGET, TARGET_TITLE));
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  seedStore([
    makeNode(SOURCE, '链接源页', 1),
    makeNode(TARGET, TARGET_TITLE, 0),
    makeNode(OTHER, '另一页', 1),
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mountPageView(): Promise<HTMLElement> {
  render(<PageView page={{ id: SOURCE, title: '链接源页' }} />);
  const host = await screen.findByTestId('septcats-editor');
  await waitFor(() => {
    expect(host.querySelectorAll('[data-id]').length).toBe(1);
  });
  return host;
}

describe('wikilink 对账纯函数（T44-01-1）', () => {
  it('aliveIdSet 只收存活页；aliveTitleIndex 重名置歧义标记', () => {
    const nodes = [
      makeNode('a', '甲', 1),
      makeNode('b', '乙', 0),
      makeNode('c', '丙', 1),
      makeNode('d', '丙', 1),
    ];
    const ids = aliveIdSet(nodes);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(false);
    expect(ids.has('c')).toBe(true);
    const titles = aliveTitleIndex(nodes);
    expect(titles.get('甲')).toBe('a');
    expect(titles.get('乙')).toBeUndefined(); // 已删页不入索引
    expect(titles.get('丙')).toBe(''); // 重名歧义：不回填
  });

  it('nextWikilinkTarget：死 target → null；活 target 保持；null + 唯一存活标题命中 → 回填；歧义/未命中保持 null', () => {
    const aliveIds = aliveIdSet([makeNode('a', '甲', 1), makeNode('b', '乙', 0)]);
    const aliveTitles = aliveTitleIndex([makeNode('a', '甲', 1), makeNode('b', '乙', 0)]);
    const run = (target: string | null, title: string): string | null =>
      nextWikilinkTarget({ target, title, aliveIds, aliveTitles });
    expect(run('a', '甲')).toBe('a'); // 存活 → 保持
    expect(run('b', '乙')).toBeNull(); // 已删 → 转未解析
    expect(run('gone', '乙')).toBeNull(); // 从不存在的 id → 未解析
    expect(run(null, '甲')).toBe('a'); // 标题唯一命中 → 回填（恢复分支）
    expect(run(null, '乙')).toBeNull(); // 已删页标题不回填
    expect(run(null, '不存在')).toBeNull();
    expect(run(null, '')).toBeNull();
  });
});

describe('PageView 双链存活对账（T44-01-1）', () => {
  it('目标页已删 → 链接渲染为 unresolved（挂载即对账 = reload 后仍 unresolved 的 B3b 语义）', async () => {
    const host = await mountPageView();
    await waitFor(() => {
      expect(host.querySelector('.sc-wikilink--unresolved')).not.toBeNull();
    });
    expect(host.querySelectorAll('.sc-wikilink').length).toBe(1);
  });

  it('目标页存活 → 链接正常解析（不误杀）', async () => {
    seedStore([
      makeNode(SOURCE, '链接源页', 1),
      makeNode(TARGET, TARGET_TITLE, 1),
      makeNode(OTHER, '另一页', 1),
    ]);
    const host = await mountPageView();
    await waitFor(() => {
      expect(host.querySelector('.sc-wikilink')).not.toBeNull();
    });
    expect(host.querySelector('.sc-wikilink--unresolved')).toBeNull();
  });

  it('回收站恢复（存活态翻转）→ 链接重新变为已解析（双向收敛，无单向 bug）', async () => {
    const host = await mountPageView();
    await waitFor(() => {
      expect(host.querySelector('.sc-wikilink--unresolved')).not.toBeNull();
    });
    // 模拟 refresh 对账回树：目标页 alive 0 → 1（restorePage 乐观更新同形）
    seedStore([
      makeNode(SOURCE, '链接源页', 1),
      makeNode(TARGET, TARGET_TITLE, 1),
      makeNode(OTHER, '另一页', 1),
    ]);
    await waitFor(() => {
      expect(host.querySelector('.sc-wikilink--unresolved')).toBeNull();
    });
    expect(host.querySelector('.sc-wikilink')).not.toBeNull();
  });

  it('点击未解析链接 → 走新建该标题页路径（claim#3：pages.create + rename）', async () => {
    const host = await mountPageView();
    await waitFor(() => {
      expect(host.querySelector('.sc-wikilink--unresolved')).not.toBeNull();
    });
    const link = host.querySelector('.sc-wikilink--unresolved')!;
    // jsdom 无 elementFromPoint（PM posAtCoords 依赖）：钉到链接节点本身
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => link;
    // PM 的 handleClickOn 走 mousedown → mouseup → click 完整序列
    fireEvent.mouseDown(link);
    fireEvent.mouseUp(link);
    fireEvent.click(link);
    await waitFor(() => {
      expect(bridge.pages.create).toHaveBeenCalledTimes(1);
    });
    expect(bridge.pages.rename).toHaveBeenCalledWith({ id: 'pg-new', title: TARGET_TITLE });
  });
});
