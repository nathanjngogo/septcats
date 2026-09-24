// @vitest-environment jsdom
/**
 * t78-bulk-selection.test.tsx —— TASK-T78-01 装配层用例（跨块多选与批量操作）。
 *
 * 覆盖（PageView 选择模型接线 → 批量动作 → 组拖拽）：
 * - Shift+click ⋮⋮ → 区间选中条 N 根（按文档序）；二次 Shift+click = 重算（非并集）；
 * - 普通点击被选块手柄 → 菜单切批量变体（计数区 + 批量删/复制）；
 * - 批量删除 = N 个单块 delete op **一次提交**（op 类型零新增）；
 * - 整页删空 → 空页守卫（补一个空段落，PM doc 恒合法）；
 * - T76 新块（table/toggle）在批量删 / 批量转两路不炸；
 * - 组拖拽 = 整组移动（保相对序）+ reorder op 一次提交；
 * - Esc 清选；i18n 成对（en-US 计数文案）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（pageview-blocks-ui.test.tsx 同款）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@septcats/editor';
import { PageView } from '../src/renderer/src/pages/PageView';
import { setLocale } from '../src/renderer/src/i18n';
import type { SeptcatsApi } from '../src/types/window';

function paragraphContent(text: string): Block['content'] {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function makeBlock(id: string, sortKey: string, text: string): Block {
  return {
    id,
    page_id: 'pg-1',
    type: 'paragraph',
    props: {},
    content: text.length > 0 ? paragraphContent(text) : null,
    parent_id: null,
    sort_key: sortKey,
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

/** R25（T76-01）新块：表格块（atom，结构化 content）。 */
function makeTable(id: string, sortKey: string): Block {
  return {
    ...makeBlock(id, sortKey, ''),
    type: 'table',
    content: { rows: [['a', 'b'], ['c', 'd']], header: true },
  };
}

/** R25（T76-01）新块：折叠列表（atom，结构化 content）。 */
function makeToggle(id: string, sortKey: string): Block {
  return {
    ...makeBlock(id, sortKey, ''),
    type: 'toggle',
    content: { title: '标题', body: ['正文'] },
  };
}

function makeBridge(blocks: Block[]) {
  return {
    blocks: {
      commit: vi.fn().mockResolvedValue(0),
      list: vi.fn().mockResolvedValue({ locked: false, blocks }),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    recent: {
      touch: vi.fn().mockResolvedValue({ pageIds: [] }),
      list: vi.fn().mockResolvedValue({ pageIds: [] }),
    },
    workspaces: {
      list: vi.fn().mockResolvedValue({ items: [{ id: 'ws-1', name: '个人工作区' }], activeId: 'ws-1' }),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    collab: {
      attach: vi.fn().mockResolvedValue({ entries: [], ledgerHasCrdt: false }),
      apply: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockReturnValue(() => {}),
    },
    // BacklinksPanel 的防抖重拉（编辑后触发）；不给会在测试收尾抛未处理异常
    links: {
      backlinks: vi.fn().mockResolvedValue({ items: [] }),
    },
  };
}

type Bridge = ReturnType<typeof makeBridge>;

let bridge: Bridge;

beforeEach(() => {
  setLocale('zh-CN');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('zh-CN');
});

async function mountPageView(blocks: Block[]): Promise<HTMLElement> {
  bridge = makeBridge(blocks);
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  render(<PageView page={{ id: 'pg-1', title: '测试页' }} />);
  const host = await screen.findByTestId('septcats-editor');
  await waitFor(() => {
    expect(host.querySelectorAll('[data-id]').length).toBe(blocks.length);
  });
  return host;
}

function barCount(): number {
  return document.querySelectorAll('[data-testid^="block-select-bar-"]').length;
}

async function handleFor(host: HTMLElement, blockId: string): Promise<HTMLButtonElement> {
  fireEvent.mouseOver(host.querySelector(`[data-id="${blockId}"]`)!);
  const handle = await screen.findByRole('button', { name: '块操作' });
  await waitFor(() => {
    expect(handle.closest('.sc-blockcontrol')?.getAttribute('data-block-id')).toBe(blockId);
  });
  return handle as HTMLButtonElement;
}

/** Shift+click 某块手柄 → 以当前焦点块为锚扩选到该块（不开关菜单）。 */
async function shiftClickHandle(host: HTMLElement, blockId: string): Promise<void> {
  const handle = await handleFor(host, blockId);
  fireEvent.click(handle, { shiftKey: true });
}

/** 普通点击某块手柄 → 在选区内保留选区并开批量菜单；否则回单块态开单块菜单。 */
async function plainClickHandle(host: HTMLElement, blockId: string): Promise<void> {
  const handle = await handleFor(host, blockId);
  fireEvent.click(handle);
}

describe('T78 PageView 选择模型（Shift+click 区间 / 清选）', () => {
  it('Shift+click 手柄 → 文档序连续区间选中条 N 根；普通点击本块 → 批量菜单计数区', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    // 光标初始在第一块（锚）→ Shift+click 第三块 = 区间 b1..b3
    await shiftClickHandle(host, 'b3');
    await waitFor(() => {
      expect(barCount()).toBe(3);
    });
    expect(
      [...document.querySelectorAll('[data-testid^="block-select-bar-"]')].map((el) =>
        el.getAttribute('data-testid'),
      ),
    ).toEqual(['block-select-bar-b1', 'block-select-bar-b2', 'block-select-bar-b3']);
    // Shift=纯扩选：菜单不开
    expect(screen.queryByTestId('block-menu-bulk-count')).toBeNull();

    // 普通点击（本块在选区内）→ 保留选区，菜单切批量变体
    await plainClickHandle(host, 'b3');
    expect(screen.getByTestId('block-menu-bulk-count').textContent).toBe('已选 3 块');
    expect(screen.getByTestId('block-menu-bulk-delete')).not.toBeNull();
    expect(screen.getByTestId('block-menu-bulk-duplicate')).not.toBeNull();
  });

  it('二次 Shift+click 另一块 = 区间重算（非集合并：收缩到锚..新焦点）', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
      makeBlock('b4', 'A00000003', '四段'),
    ]);

    await shiftClickHandle(host, 'b4');
    await waitFor(() => {
      expect(barCount()).toBe(4);
    });

    // 再 Shift+click b2 → 锚块仍是 b1 → 区间 b1..b2（并集口径会残留 4 根）
    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    expect(
      [...document.querySelectorAll('[data-testid^="block-select-bar-"]')].map((el) =>
        el.getAttribute('data-testid'),
      ),
    ).toEqual(['block-select-bar-b1', 'block-select-bar-b2']);
  });

  it('Esc 清选（选中条归零）；普通点击非选区块手柄 → 回单块态', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    await shiftClickHandle(host, 'b3');
    await waitFor(() => {
      expect(barCount()).toBe(3);
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(barCount()).toBe(0);
    });

    // 重新扩选后用「非选区块」的普通点击验证回单块态
    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    await plainClickHandle(host, 'b3'); // b3 不在 b1..b2 区间
    await waitFor(() => {
      expect(barCount()).toBe(0);
    });
    expect(screen.queryByTestId('block-menu-bulk-count')).toBeNull();
  });
});

describe('T78 PageView 批量动作（N 单块 op 一次提交）', () => {
  it('批量删除：区间 2 块 → 2 条 delete op 同一次 commit；DOM 只剩未选块', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    await plainClickHandle(host, 'b2');
    fireEvent.click(screen.getByTestId('block-menu-bulk-delete'));

    await waitFor(() => {
      const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
      expect(ids).toEqual(['b3']);
    });
    expect(barCount()).toBe(0);

    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as { ops: Array<{ kind: string; target: { id: string } }> };
    const deletes = payload.ops.filter((op) => op.kind === 'delete');
    expect(deletes.map((op) => op.target.id).sort()).toEqual(['b1', 'b2']);
    // op 类型零新增：整批只有 delete（无新 kind）
    expect(new Set(payload.ops.map((op) => op.kind))).toEqual(new Set(['delete']));
  });

  it('批量删除整页 → 文档恒合法：PM 自动补一个空段落（3 delete + 1 upsert 同批）', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    await shiftClickHandle(host, 'b3');
    await waitFor(() => {
      expect(barCount()).toBe(3);
    });
    await plainClickHandle(host, 'b3');
    fireEvent.click(screen.getByTestId('block-menu-bulk-delete'));

    await waitFor(() => {
      expect(host.querySelectorAll('[data-id]').length).toBe(1);
    });
    // 框架补的空段落：无文本、且经反投影拿到 ulid 后回写 data-id（可被下一次手柄定位）
    const survivor = host.querySelector('.ProseMirror > *');
    expect(survivor?.tagName).toBe('P');
    expect((survivor?.textContent ?? '').trim()).toBe('');
    expect(survivor?.getAttribute('data-id')).toBeTruthy();

    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as { ops: Array<{ kind: string }> };
    expect(payload.ops.filter((op) => op.kind === 'delete')).toHaveLength(3);
    expect(payload.ops.filter((op) => op.kind === 'upsert')).toHaveLength(1); // 框架补的空段落
  });

  it('批量复制：整组副本插在原组之后（保相对序），一次 commit', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    await plainClickHandle(host, 'b2');
    fireEvent.click(screen.getByTestId('block-menu-bulk-duplicate'));

    await waitFor(() => {
      expect(host.querySelectorAll('[data-id]').length).toBe(5);
    });
    const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
    // 原序 b1,b2,b3 + 组副本紧跟 b2 之后（b1,b2,副本,副本,b3）
    expect(ids.slice(0, 2)).toEqual(['b1', 'b2']);
    expect(ids[4]).toBe('b3');
    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as { ops: Array<{ kind: string }> };
    expect(payload.ops.every((op) => op.kind === 'upsert')).toBe(true);
  });

  it('批量转为（T76 新块同路）：table+toggle → 段落，两 upsert 一次 commit 不炸', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeTable('tb', 'A00000001'),
      makeToggle('tg', 'A00000002'),
    ]);
    expect(host.querySelector('[data-id="tb"]')).not.toBeNull();
    expect(host.querySelector('[data-id="tg"]')).not.toBeNull();

    await shiftClickHandle(host, 'tg'); // 锚 b1 → 区间 b1..tg（3 块，含新块两型）
    await waitFor(() => {
      expect(barCount()).toBe(3);
    });
    await plainClickHandle(host, 'tg');
    // 标题 1/2/3 的 testid 共用 `...-heading`（契约名=块型），首个即「标题 1」
    fireEvent.click(screen.getAllByTestId('block-menu-bulk-convert-heading')[0]!);

    await waitFor(() => {
      expect(host.querySelector('h1[data-id="tb"]')).not.toBeNull();
    });
    expect(host.querySelector('h1[data-id="tg"]')).not.toBeNull();
    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as {
      ops: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    // 换型走既有 upsert（type 变），op 类型零新增
    expect(new Set(payload.ops.map((op) => op.kind))).toEqual(new Set(['upsert']));
    expect(payload.ops).toHaveLength(3);
  });

  it('批量删除（T76 新块同路）：table 在场被删不炸，未选 toggle 保留', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeTable('tb', 'A00000001'),
      makeToggle('tg', 'A00000002'),
    ]);

    await shiftClickHandle(host, 'tb'); // 锚 b1 → 区间 b1..tb（2 块）
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    await plainClickHandle(host, 'tb');
    fireEvent.click(screen.getByTestId('block-menu-bulk-delete'));

    await waitFor(() => {
      const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
      expect(ids).toEqual(['tg']);
    });
    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as { ops: Array<{ kind: string; target: { id: string } }> };
    expect(payload.ops.filter((op) => op.kind === 'delete').map((op) => op.target.id).sort()).toEqual([
      'b1',
      'tb',
    ]);
  });

  it('批量颜色：单 tr 多步加 color mark，一次 commit（patch op）', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });
    await plainClickHandle(host, 'b2');
    fireEvent.click(screen.getByTestId('block-menu-bulk-color-accent'));

    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as {
      ops: Array<{ kind: string; target: { id: string } }>;
    };
    expect(payload.ops.filter((op) => op.kind === 'patch').map((op) => op.target.id).sort()).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('i18n 成对：en-US 下计数区文案走英文（无 CJK）', async () => {
    setLocale('en-US');
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);
    await shiftClickHandle(host, 'b3');
    await waitFor(() => {
      expect(barCount()).toBe(3);
    });
    await plainClickHandle(host, 'b3');
    expect(screen.getByTestId('block-menu-bulk-count').textContent).toBe('3 blocks selected');
  });
});

describe('T78 PageView 组拖拽（整组移动，保相对序）', () => {
  it('多选态拖任一被选块 = 整组移动；DOM 序变（保相对序）+ reorder op 一次 commit', async () => {
    const host = await mountPageView([
      makeBlock('b1', 'A00000000', '一段'),
      makeBlock('b2', 'A00000001', '二段'),
      makeBlock('b3', 'A00000002', '三段'),
    ]);

    // 锚 b1 → Shift+click b2 = 选区 [b1,b2]
    await shiftClickHandle(host, 'b2');
    await waitFor(() => {
      expect(barCount()).toBe(2);
    });

    // 从被选块 b2 的 ⋮⋮ 发起拖拽 → 整组
    const handle = await handleFor(host, 'b2');
    fireEvent.dragStart(handle);
    const b3 = host.querySelector('[data-id="b3"]')!;
    fireEvent.dragOver(b3);
    // 落点在 b3 下半 → 整组搬到末尾。jsdom 的合成 DragEvent 不带 clientY，
    // 用 MouseEvent('drop') 显式给坐标（React 合成 onDrop 照常收到 clientY）。
    fireEvent(b3, new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 10 }));

    // 组内相对序不变：b1 仍在 b2 之前；两组位置整体后移
    await waitFor(() => {
      const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
      expect(ids).toEqual(['b3', 'b1', 'b2']);
    });

    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as {
      ops: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    // 顺序变化走既有 reorder（diff 自行取最小重排集合），op 类型零新增
    expect(new Set(payload.ops.map((op) => op.kind))).toEqual(new Set(['reorder']));
    expect(payload.ops.length).toBeGreaterThanOrEqual(1);
    expect(payload.ops.every((op) => typeof op.payload['sort_key'] === 'string')).toBe(true);
  });
});
