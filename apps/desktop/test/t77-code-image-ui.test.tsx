// @vitest-environment jsdom
/**
 * t77-code-image-ui.test.tsx —— R26（TASK-T77-01）代码块语言栏 / 图片宽度拖拽的
 * **应用侧（PageView）**验收：i18n 注入通道、testid 契约、attr 写入落 op。
 *
 * 纪律：window.septcats 走 vi.stubGlobal 假桥（t76-blocks-ui.test.tsx 同款）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@septcats/editor';
import { setLocale } from '../src/renderer/src/i18n';
import { PageView } from '../src/renderer/src/pages/PageView';
import type { SeptcatsApi } from '../src/types/window';

const PAGE = 'pg-t77';
const CODE_ID = 'blk-t77-code';
const IMAGE_ID = 'blk-t77-image';
const SHA = 'b'.repeat(64);

function baseBlock(partial: Partial<Block> & Pick<Block, 'id' | 'type'>): Block {
  return {
    page_id: PAGE,
    props: {},
    content: null,
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 0,
    ...partial,
  };
}

function codeBlock(): Block {
  return baseBlock({
    id: CODE_ID,
    type: 'code',
    props: { lang: 'python' },
    content: 'print(1)',
  });
}

function imageBlock(): Block {
  return baseBlock({
    id: IMAGE_ID,
    type: 'image',
    props: { file_id: SHA, caption: '图', width: 480 },
    sort_key: 'A00000001',
  });
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
  bridge = makeBridge([codeBlock(), imageBlock()]);
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('zh-CN');
});

/** 最近一次 commit 的 ops 数组。 */
function lastOps(): Array<{ kind: string; target?: { id?: string }; payload: Record<string, unknown> }> {
  const calls = bridge.blocks.commit.mock.calls;
  const arg = calls[calls.length - 1]?.[0] as { ops: Array<{ kind: string; target?: { id?: string }; payload: Record<string, unknown> }> };
  return arg.ops;
}

function patchOf(blockId: string): Record<string, unknown> | undefined {
  const op = lastOps().find((entry) => entry.kind === 'patch' && entry.target?.id === blockId);
  return op?.payload['props'] as Record<string, unknown> | undefined;
}

async function mountPageView(): Promise<HTMLElement> {
  render(<PageView page={{ id: PAGE, title: '测试页' }} />);
  const host = await screen.findByTestId('septcats-editor');
  await waitFor(() => {
    expect(host.querySelector('.sc-block--code')).not.toBeNull();
  });
  return host;
}

describe('R26 PageView：代码块语言栏（zh 注入 + attr 落 op）', () => {
  it('装载：语言栏/换行钮/淡标签 testid 就位，可访问名走 zh 注入', async () => {
    const host = await mountPageView();
    const langBtn = host.querySelector(`[data-testid="codebar-lang-${CODE_ID}"]`);
    expect(langBtn?.getAttribute('aria-label')).toBe('代码语言');
    expect(langBtn?.textContent).toBe('python');
    const wrapBtn = host.querySelector(`[data-testid="codebar-wrap-${CODE_ID}"]`);
    expect(wrapBtn?.getAttribute('aria-label')).toBe('自动换行');
    const tag = host.querySelector(`[data-testid="code-lang-tag-${CODE_ID}"]`) as HTMLElement;
    expect(tag.textContent).toBe('python');
    expect(tag.hidden).toBe(false);
  });

  it('选语言 rust → patch op 的 props.lang=rust 落库', async () => {
    const host = await mountPageView();
    await act(async () => {
      fireEvent.click(host.querySelector(`[data-testid="codebar-lang-${CODE_ID}"]`) as HTMLElement);
    });
    const option = host.querySelector('[data-testid="codebar-lang-opt-rust"]') as HTMLElement;
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option);
    });
    await waitFor(() => {
      expect(patchOf(CODE_ID)?.['lang']).toBe('rust');
    });
    expect(host.querySelector('pre.sc-block--code')?.getAttribute('data-lang')).toBe('rust');
  });

  it('换行钮 → patch op 的 props.wrap=true 落库', async () => {
    const host = await mountPageView();
    await act(async () => {
      fireEvent.click(host.querySelector(`[data-testid="codebar-wrap-${CODE_ID}"]`) as HTMLElement);
    });
    await waitFor(() => {
      expect(patchOf(CODE_ID)?.['wrap']).toBe(true);
    });
  });
});

describe('R26 PageView：图片宽度拖拽（zh 注入 + attr 落 op）', () => {
  it('装载：拖拽柄 testid 就位、可访问名走 zh 注入；badge 初始隐藏', async () => {
    const host = await mountPageView();
    const handle = host.querySelector(`[data-testid="image-resize-handle-${IMAGE_ID}"]`);
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('aria-label')).toBe('调整图片宽度');
    const badge = host.querySelector('[data-testid="image-width-badge"]') as HTMLElement;
    expect(badge.hidden).toBe(true);
  });

  it('拖拽右缘 +40px → patch op 的 props.width 落库（8px 网格吸附）', async () => {
    const host = await mountPageView();
    const handle = host.querySelector(`[data-testid="image-resize-handle-${IMAGE_ID}"]`) as HTMLElement;
    const badge = host.querySelector('[data-testid="image-width-badge"]') as HTMLElement;
    await act(async () => {
      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 141 });
    });
    expect(badge.hidden).toBe(false);
    await act(async () => {
      fireEvent.mouseUp(document, { clientX: 141 });
    });
    await waitFor(() => {
      expect(patchOf(IMAGE_ID)?.['width']).toBe(520);
    });
    expect(badge.hidden).toBe(true);
  });
});

describe('R26 i18n：en-US 注入成对', () => {
  it('切 en-US → 代码块/图片控件可访问名走英文', async () => {
    setLocale('en-US');
    const host = await mountPageView();
    expect(
      host.querySelector(`[data-testid="codebar-lang-${CODE_ID}"]`)?.getAttribute('aria-label'),
    ).toBe('Code language');
    expect(
      host.querySelector(`[data-testid="codebar-wrap-${CODE_ID}"]`)?.getAttribute('aria-label'),
    ).toBe('Wrap lines');
    expect(
      host.querySelector(`[data-testid="image-resize-handle-${IMAGE_ID}"]`)?.getAttribute('aria-label'),
    ).toBe('Resize image');
  });
});
