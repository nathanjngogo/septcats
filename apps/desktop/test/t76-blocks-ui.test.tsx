// @vitest-environment jsdom
/**
 * t76-blocks-ui.test.tsx —— R25（TASK-T76-01）内容块扩展的**视图/交互面**用例（jsdom）。
 *
 * 覆盖任务书 §10 的 testid 契约与 §1 的 DoD 交互项：
 * - 表格块：3×3 默认表、单元格 testid、加/删行、加/删列、表头开关、列宽拖拽、
 *   Tab/Shift+Tab 移焦（含末尾 Tab 补行）、单元格写入落 content；
 * - 折叠列表：默认收起 / 展开 / 再收起（**纯视图态，零事务**）、标题与正文行编辑、
 *   正文行 Enter 增行 / 空行 Backspace 删行；
 * - 斜杠入口：`slash-item-table` / `slash-item-toggle` 两个 testid；
 * - 端到端（PageView）：`/` → 选「表格」→ 块真的变成表格块且**保留原块 id**；
 * - markdown 粘贴窄口：整段 md 表格 → 表格块；
 * - 协同：带 table/toggle 的文档 attach 到 YjsEditor 不炸（结构化 attrs 过 Y 的钉子）。
 *
 * 纪律：window.septcats 走 vi.stubGlobal 假桥（pageview-blocks-ui.test.tsx 同款）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import {
  TABLE_DEFAULT_COL_WIDTH,
  TABLE_MIN_COL_WIDTH,
  YjsEditor,
  type Block,
  type BlockDoc,
  type TableContent,
} from '@septcats/editor';
import { Editor, SlashMenu } from '@septcats/editor/react';
import { PageView } from '../src/renderer/src/pages/PageView';
import type { SeptcatsApi } from '../src/types/window';

/** 编辑器实例句柄：从 Editor 的 onReady 契约推导（apps 不直依 @tiptap/core）。 */
type EditorHandle = Exclude<
  Parameters<NonNullable<ComponentProps<typeof Editor>['onReady']>>[0],
  null
>;

/** 挂载 Editor 并取出实例（粘贴/Yjs 用例要直接碰 PM 视图）。 */
function mountWithInstance(doc: BlockDoc): {
  editor: { current: EditorHandle | null };
  container: HTMLElement;
} {
  const editor: { current: EditorHandle | null } = { current: null };
  const { container } = render(
    <Editor
      doc={doc}
      onChange={() => {}}
      onReady={(instance) => {
        editor.current = instance;
      }}
    />,
  );
  expect(editor.current).not.toBeNull();
  return { editor, container };
}

const PAGE = 'pg-t76';
const TABLE_ID = 'blk-t76-table';
const TOGGLE_ID = 'blk-t76-toggle';

function tableBlock(rows: string[][], header = true, colWidths?: number[]): Block {
  const content: TableContent =
    colWidths === undefined ? { rows, header } : { rows, header, colWidths };
  return {
    id: TABLE_ID,
    page_id: PAGE,
    type: 'table',
    props: {},
    content,
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function toggleBlock(title: string, body: string[]): Block {
  return {
    id: TOGGLE_ID,
    page_id: PAGE,
    type: 'toggle',
    props: {},
    content: { title, body },
    parent_id: null,
    sort_key: 'A00000001',
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function docOf(...blocks: Block[]): BlockDoc {
  return { pageId: PAGE, blocks };
}

/** 最近一次 onChange 的 BlockDoc。 */
function lastDoc(spy: ReturnType<typeof vi.fn>): BlockDoc {
  const call = spy.mock.calls[spy.mock.calls.length - 1];
  return call?.[0] as BlockDoc;
}

function blockOf(doc: BlockDoc, id: string): Block | undefined {
  return doc.blocks.find((block) => block.id === id);
}

/** 挂载编辑器并取容器；返回的 query 助手都从容器出发（避免跨用例残留）。 */
function mountEditor(doc: BlockDoc): {
  container: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const { container } = render(<Editor doc={doc} onChange={onChange} />);
  expect(container.querySelector('.ProseMirror')).not.toBeNull();
  return { container, onChange };
}

function cellInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('.sc-table__input')];
}

function tableEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="septcats-block-table"]');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('R25 表格块：装载 / testid 契约 / 默认表', () => {
  it('装载 path：表体、行列表头柄、工具条 testid 全部就位且块带 data-id', () => {
    const { container } = mountEditor(
      docOf(tableBlock([['事件', '曝光量'], ['LZ', '4.2']])),
    );
    const table = tableEl(container);
    expect(table.getAttribute('data-id')).toBe(TABLE_ID);
    expect(table.className).toContain('sc-block--table');
    // 2×2 单元格
    expect(cellInputs(container).map((input) => input.value)).toEqual([
      '事件',
      '曝光量',
      'LZ',
      '4.2',
    ]);
    for (const testId of [
      'block-table-add-row',
      'block-table-add-col',
      'block-table-header-toggle',
      'block-table-del-row-0',
      'block-table-del-row-1',
      'block-table-del-col-0',
      'block-table-del-col-1',
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }
    // 首行=表头（header:true）有修饰类
    expect(container.querySelector('.sc-table__row--header')).not.toBeNull();
  });

  it('退化 rows（空表数据）→ 规范 3×3 空表（斜杠插入后的形态）', () => {
    const { container } = mountEditor(docOf(tableBlock([], true)));
    expect(cellInputs(container)).toHaveLength(9);
    expect(cellInputs(container).every((input) => input.value === '')).toBe(true);
  });
});

describe('R25 表格块：加删行列 / 表头开关（content 落库口径）', () => {
  it('加行：content.rows +1 且每行列数与现有列一致', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    fireEvent.click(container.querySelector('[data-testid="block-table-add-row"]') as HTMLElement);
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows).toHaveLength(3);
      expect(content.rows[2]).toEqual(['', '']);
    });
    expect(cellInputs(container)).toHaveLength(6);
  });

  it('加列：content 每行 +1 空单元格', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    fireEvent.click(container.querySelector('[data-testid="block-table-add-col"]') as HTMLElement);
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows).toEqual([
        ['a', 'b', ''],
        ['c', 'd', ''],
      ]);
    });
  });

  it('删行 / 删列：按索引精确删除，且到 1 行 / 1 列时夹紧不再删', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    fireEvent.click(container.querySelector('[data-testid="block-table-del-row-0"]') as HTMLElement);
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows).toEqual([['c', 'd']]);
    });
    // 只剩 1 行：再点 del-row-0 → 夹紧（content 不变，仍 1 行）
    fireEvent.click(container.querySelector('[data-testid="block-table-del-row-0"]') as HTMLElement);
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows).toHaveLength(1);
    });

    const table = tableBlock([['a', 'b'], ['c', 'd']]);
    const second = mountEditor(docOf({ ...table, id: 'blk-t76-table-2' }));
    fireEvent.click(
      second.container.querySelector('[data-testid="block-table-del-col-1"]') as HTMLElement,
    );
    await waitFor(() => {
      const content = blockOf(lastDoc(second.onChange), 'blk-t76-table-2')?.content as {
        rows: string[][];
      };
      expect(content.rows).toEqual([['a'], ['c']]);
    });
  });

  it('表头开关：翻转 content.header，行修饰类随之下线', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['h1', 'h2'], ['a', 'b']])));
    expect(container.querySelector('.sc-table__row--header')).not.toBeNull();
    fireEvent.click(
      container.querySelector('[data-testid="block-table-header-toggle"]') as HTMLElement,
    );
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { header: boolean };
      expect(content.header).toBe(false);
    });
    expect(container.querySelector('.sc-table__row--header')).toBeNull();
    // aria-pressed 随态翻
    expect(
      container
        .querySelector('[data-testid="block-table-header-toggle"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('R25 表格块：单元格编辑与键盘移焦', () => {
  it('单元格 input → content 命中格写入（且一轮编辑恰一次 onChange）', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="block-table-cell-1-1"]',
    ) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'D2' } });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows[1]?.[1]).toBe('D2');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    // 未变的格保持原值
    expect(input.value).toBe('D2');
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="block-table-cell-0-0"]')?.value,
    ).toBe('a');
  });

  it('Tab 前进 / Shift+Tab 后退；末格 Tab 补一行并落到新行首格', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    const [c00, c01] = cellInputs(container) as [HTMLInputElement, HTMLInputElement];
    c00.focus();
    fireEvent.keyDown(c00, { key: 'Tab' });
    expect(document.activeElement).toBe(c01);
    fireEvent.keyDown(c01, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(c00);

    // 末格（1-1）Tab → 补第 3 行
    const last = container.querySelector<HTMLInputElement>(
      '[data-testid="block-table-cell-1-1"]',
    ) as HTMLInputElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { rows: string[][] };
      expect(content.rows).toHaveLength(3);
    });
    expect(document.activeElement).toBe(
      container.querySelector('[data-testid="block-table-cell-2-0"]'),
    );
  });

  it('表内按键**不外泄**：单元格里敲 `/` 不冒泡到宿主（斜杠菜单不弹）', () => {
    const seen: string[] = [];
    const { container } = mountEditor(docOf(tableBlock([['a']])));
    const parent = container.parentElement as HTMLElement;
    const spy = (event: KeyboardEvent): void => {
      seen.push(event.key);
    };
    parent.addEventListener('keydown', spy);
    const input = cellInputs(container)[0] as HTMLInputElement;
    fireEvent.keyDown(input, { key: '/' });
    parent.removeEventListener('keydown', spy);
    expect(seen).toEqual([]);
  });
});

describe('R25 表格块：列宽拖拽（列柄）', () => {
  it('拖拽列柄 → content.colWidths 落库（夹下限），并即时改 grid 模板', async () => {
    const { container, onChange } = mountEditor(docOf(tableBlock([['a', 'b'], ['c', 'd']])));
    const grip = container.querySelector<HTMLElement>('.sc-table__colresize[data-col="0"]');
    expect(grip).not.toBeNull();
    fireEvent.mouseDown(grip as HTMLElement, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document, { clientX: 140 });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { colWidths?: number[] };
      expect(content.colWidths).toEqual([
        TABLE_DEFAULT_COL_WIDTH + 40,
        TABLE_DEFAULT_COL_WIDTH,
      ]);
    });
    const row = container.querySelector<HTMLElement>('.sc-table__row[data-row="0"]');
    expect(row?.style.gridTemplateColumns).toContain('px');
  });

  it('微小位移（< 阈值）不产生事务：点击列柄不误改宽度', async () => {
    const { container, onChange } = mountEditor(
      docOf(tableBlock([['a', 'b'], ['c', 'd']], true, [200, 120])),
    );
    const grip = container.querySelector<HTMLElement>('.sc-table__colresize[data-col="1"]');
    fireEvent.mouseDown(grip as HTMLElement, { clientX: 100 });
    fireEvent.mouseUp(document, { clientX: 101 });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      container
        .querySelector<HTMLElement>('.sc-table__row[data-row="0"]')
        ?.style.gridTemplateColumns,
    ).toContain('200px');
  });

  it('拖到负位移也夹在列宽下限（不出现 0 宽列）', async () => {
    const { container, onChange } = mountEditor(tableDocWithWidths());
    const grip = container.querySelector<HTMLElement>('.sc-table__colresize[data-col="0"]');
    fireEvent.mouseDown(grip as HTMLElement, { clientX: 100 });
    fireEvent.mouseUp(document, { clientX: -900 });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TABLE_ID)?.content as { colWidths?: number[] };
      expect(content.colWidths?.[0]).toBe(TABLE_MIN_COL_WIDTH);
    });
  });

  function tableDocWithWidths(): BlockDoc {
    return docOf(tableBlock([['a', 'b']], true, [200, 120]));
  }
});

describe('R25 折叠列表：两态渲染（展开态 = 纯视图态）', () => {
  it('默认收起：body hidden、aria-expanded=false、▶ 未旋转；testid 带块 id', () => {
    const { container } = mountEditor(docOf(toggleBlock('口径问答', ['为什么？'])));
    const root = container.querySelector<HTMLElement>('[data-testid="septcats-block-toggle"]');
    expect(root?.getAttribute('data-id')).toBe(TOGGLE_ID);
    const arrow = container.querySelector<HTMLElement>(`[data-testid="block-toggle-${TOGGLE_ID}"]`);
    expect(arrow).not.toBeNull();
    expect(arrow?.getAttribute('aria-expanded')).toBe('false');
    expect(root?.className).not.toContain('sc-toggle--open');
    const body = container.querySelector<HTMLElement>('.sc-toggle__body');
    expect(body?.hidden).toBe(true);
    // 标题与正文行都在 DOM（收起只是视图态，内容没丢）
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="block-toggle-title"]')?.value,
    ).toBe('口径问答');
    expect(container.querySelector<HTMLInputElement>('[data-testid="block-toggle-line-0"]')?.value).toBe(
      '为什么？',
    );
  });

  it('点箭头展开 → 再点收起：**零事务**（onChange 不被调用，content 不变）', () => {
    const { container, onChange } = mountEditor(docOf(toggleBlock('题', ['行'])));
    const arrow = container.querySelector<HTMLElement>(`[data-testid="block-toggle-${TOGGLE_ID}"]`);
    fireEvent.click(arrow as HTMLElement);
    const root = container.querySelector<HTMLElement>('[data-testid="septcats-block-toggle"]');
    expect(root?.className).toContain('sc-toggle--open');
    expect(arrow?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector<HTMLElement>('.sc-toggle__body')?.hidden).toBe(false);

    fireEvent.click(arrow as HTMLElement);
    expect(root?.className).not.toContain('sc-toggle--open');
    expect(container.querySelector<HTMLElement>('.sc-toggle__body')?.hidden).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('标题 / 正文行编辑落 content；Enter 增行、空行 Backspace 删行', async () => {
    const { container, onChange } = mountEditor(docOf(toggleBlock('题', ['a'])));
    const title = container.querySelector<HTMLInputElement>(
      '[data-testid="block-toggle-title"]',
    ) as HTMLInputElement;
    fireEvent.input(title, { target: { value: '新题' } });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TOGGLE_ID)?.content as { title: string };
      expect(content.title).toBe('新题');
    });

    // 标题 Enter → 正文补一行（并展开以承接焦点）
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TOGGLE_ID)?.content as { body: string[] };
      expect(content.body).toEqual(['a', '']);
    });
    const line1 = container.querySelector<HTMLInputElement>('[data-testid="block-toggle-line-1"]');
    expect(line1?.value).toBe('');
    // 空行 Backspace → 删掉该行
    fireEvent.keyDown(line1 as HTMLInputElement, { key: 'Backspace' });
    await waitFor(() => {
      const content = blockOf(lastDoc(onChange), TOGGLE_ID)?.content as { body: string[] };
      expect(content.body).toEqual(['a']);
    });
  });
});

describe('R25 斜杠入口：slash-item testid 契约', () => {
  it('菜单渲染两个新块项（table / toggle）', () => {
    render(<SlashMenu open query="" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('slash-item-table')).toBeDefined();
    expect(screen.getByTestId('slash-item-toggle')).toBeDefined();
  });

  it('中文查询命中：`表格` / `折叠` 过滤到对应项', () => {
    expect(screen.queryByTestId('slash-item-table')).toBeNull();
    const { unmount } = render(<SlashMenu open query="表格" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('slash-item-table')).toBeDefined();
    expect(screen.queryByTestId('slash-item-toggle')).toBeNull();
    unmount();
    render(<SlashMenu open query="zdlb" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('slash-item-toggle')).toBeDefined();
  });
});

describe('R25 markdown 粘贴窄口', () => {
  function pasteText(editor: EditorHandle, text: string): void {
    const data = { getData: (type: string): string => (type === 'text/plain' ? text : '') };
    fireEvent.paste(editor.view.dom, { clipboardData: data });
  }

  it('粘贴整段 md 表格 → 文档里出现表格块', () => {
    const { editor } = mountWithInstance(docOf());
    const instance = editor.current as EditorHandle;
    pasteText(instance, '| a | b |\n| --- | --- |\n| 1 | 2 |');
    const json = instance.getJSON() as {
      content?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    };
    const table = (json.content ?? []).find((node) => node.type === 'table');
    expect(table).toBeDefined();
    expect(table?.attrs?.['rows']).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(table?.attrs?.['header']).toBe(true);
  });

  it('非表格文本不吃窄口：不产生表格块（默认粘贴行为不变）', () => {
    const { editor } = mountWithInstance(docOf());
    const instance = editor.current as EditorHandle;
    pasteText(instance, '正文 含 | 竖线 但不构成表格');
    const json = instance.getJSON() as { content?: Array<{ type: string }> };
    expect((json.content ?? []).some((node) => node.type === 'table')).toBe(false);
  });
});

describe('R25 协同：结构化 attrs 过 Yjs 不炸（table/toggle）', () => {
  // 注：本用例 stderr 会出现一行 PM 自带告警
  // 「TextSelection endpoint not pointing into a node with inline content (doc)」——
  // 首块是**原子块**时 Y→PM 整文档替换把旧选区映射进原子块所致，**与块型无关**：
  // 用既有 divider（v1 就有）做首块可复现同一条（本单实测，见报告 §3 DEVIATION-5）。
  it('attach 后 Y→PM 投影保留表格块与折叠块（attrs 数组/对象不丢）', () => {
    const { editor } = mountWithInstance(
      docOf(tableBlock([['x', 'y']], true, [140, 90]), toggleBlock('t', ['l1', 'l2'])),
    );
    const instance = editor.current as EditorHandle;
    const yjs = new YjsEditor(PAGE, { debounceMs: 5 });
    try {
      yjs.attach(instance);
      const json = instance.getJSON() as {
        content?: Array<{ type: string; attrs?: Record<string, unknown> }>;
      };
      const table = (json.content ?? []).find((node) => node.type === 'table');
      const toggle = (json.content ?? []).find((node) => node.type === 'toggle');
      expect(table?.attrs?.['rows']).toEqual([['x', 'y']]);
      expect(table?.attrs?.['colWidths']).toEqual([140, 90]);
      expect(toggle?.attrs?.['body']).toEqual(['l1', 'l2']);
    } finally {
      yjs.destroy();
    }
  });
});

describe('R25 端到端（PageView）：斜杠选「表格」→ 块真的变表格并保留原 id', () => {
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
        list: vi.fn().mockResolvedValue({
          items: [{ id: 'ws-1', name: '个人工作区' }],
          activeId: 'ws-1',
        }),
        onChanged: vi.fn().mockReturnValue(() => {}),
      },
      collab: {
        attach: vi.fn().mockResolvedValue({ entries: [], ledgerHasCrdt: false }),
        apply: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
        onUpdate: vi.fn().mockReturnValue(() => {}),
      },
    };
  }

  let bridge: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    bridge = makeBridge([
      {
        id: 'blk-1',
        page_id: PAGE,
        type: 'paragraph',
        props: {},
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '待转表格' }] }] },
        parent_id: null,
        sort_key: 'A00000000',
        alive: 1,
        version: 1,
        last_edited: 0,
      },
    ]);
    vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  });

  it('点 slash-item-table → DOM 出表格块（data-id 保留）+ commit 落 type=table', async () => {
    render(<PageView page={{ id: PAGE, title: '测试页' }} />);
    const host = await screen.findByTestId('septcats-editor');
    await waitFor(() => {
      expect(host.querySelectorAll('[data-id]').length).toBe(1);
    });

    fireEvent.keyDown(document.querySelector('.pv-body') as HTMLElement, { key: '/' });
    const item = await screen.findByTestId('slash-item-table');
    await act(async () => {
      fireEvent.click(item);
    });

    await waitFor(() => {
      const table = host.querySelector<HTMLElement>('[data-testid="septcats-block-table"]');
      expect(table).not.toBeNull();
      expect(table?.getAttribute('data-id')).toBe('blk-1');
    });
    // 3×3 默认表（插入即规范形状）
    expect(host.querySelectorAll('.sc-table__input')).toHaveLength(9);

    // 落库：debounce 后的 commit 里出现该块的 upsert，type=table 且 content 是结构化对象
    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    const ops = (
      bridge.blocks.commit.mock.calls[
        bridge.blocks.commit.mock.calls.length - 1
      ]?.[0] as { ops: Array<{ kind: string; payload: Record<string, unknown> }> }
    ).ops;
    const upsert = ops.find((op) => op.payload['type'] === 'table');
    expect(upsert).toBeDefined();
    expect(upsert?.payload['content']).toMatchObject({ header: true });
  });
});
