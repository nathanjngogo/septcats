import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { BlockDoc } from '../src/model';
import { Editor } from '../src/react/Editor';
import { BlockControls } from '../src/react/BlockControls';
import { SlashMenu } from '../src/react/SlashMenu';
import { SelectionToolbar, selectionRect } from '../src/react/SelectionToolbar';
import { clampOffsetInViewport, overflowsBottom } from '../src/react/viewport';
import { SLASH_ITEMS } from '../src/rules/slashMenu';
import { demoBlockDoc, BLOCK_FIXTURES } from './fixtures/blocks';

describe('Editor（React 视图）', () => {
  it('渲染冒烟：挂载 ProseMirror、初始 9 块型内容都在', () => {
    const { container } = render(<Editor doc={demoBlockDoc()} onChange={() => {}} />);
    expect(container.querySelector('.sc-editor')).not.toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(container.textContent).toContain('本页汇总 LZ 类稀有事件探测的实验现状与文献线索。');
    expect(container.textContent).toContain('一、探测器矩阵');
    expect(container.querySelectorAll('.sc-block').length).toBeGreaterThanOrEqual(9);
  });

  it('class 卫生：demo doc 全元素 class 无重复 token（joinClass 纪律）', () => {
    const { container } = render(<Editor doc={demoBlockDoc()} onChange={() => {}} />);
    const offenders: string[] = [];
    for (const element of container.querySelectorAll('[class]')) {
      const cls = element.getAttribute('class') ?? '';
      const tokens = cls.split(/\s+/).filter((token) => token.length > 0);
      if (new Set(tokens).size !== tokens.length) {
        offenders.push(`${element.tagName.toLowerCase()}.${cls.replace(/\s+/g, '.')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('code wrap:true：pre 带 sc-block--code--wrap 且 class 无重复（model.ts 透传 props.wrap）', () => {
    const codeFixture = BLOCK_FIXTURES.find((fixture) => fixture.name === 'code');
    expect(codeFixture).toBeDefined();
    const doc = {
      pageId: codeFixture!.block.page_id,
      blocks: [
        {
          ...codeFixture!.block,
          props: { ...codeFixture!.block.props, wrap: true },
        },
      ],
    };
    const { container } = render(<Editor doc={doc} onChange={() => {}} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const cls = pre!.getAttribute('class') ?? '';
    expect(cls).toContain('sc-block--code--wrap');
    const tokens = cls.split(/\s+/).filter((token) => token.length > 0);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('onChange 桥：PM 事务 → 反投影 BlockDoc 回调', () => {
    const onChange = vi.fn();
    const holder: { editor: TiptapEditor | null } = { editor: null };
    render(
      <Editor
        doc={demoBlockDoc()}
        onChange={onChange}
        onReady={(instance) => {
          holder.editor = instance;
        }}
      />,
    );
    expect(holder.editor).not.toBeNull();

    act(() => {
      holder.editor?.commands.insertContent('新增文本');
    });

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as BlockDoc;
    expect(JSON.stringify(next.blocks)).toContain('新增文本');
  });

  it('卸载时销毁编辑器（不泄漏 PM 实例）', () => {
    const holder: { editor: TiptapEditor | null } = { editor: null };
    const { unmount } = render(
      <Editor
        doc={demoBlockDoc()}
        onChange={() => {}}
        onReady={(instance) => {
          holder.editor = instance;
        }}
      />,
    );
    const instance = holder.editor as TiptapEditor;
    unmount();
    expect(holder.editor).toBeNull();
    expect(instance.isDestroyed).toBe(true);
  });
});

describe('SlashMenu（键盘导航）', () => {
  it('ArrowDown ×2 + Enter → 选中第 3 项并回调 insertBlock 意图', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<SlashMenu open query="" onSelect={onSelect} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: SLASH_ITEMS[2]?.id });
  });

  it('Esc 关闭、open=false 不渲染', () => {
    const onClose = vi.fn();
    const { rerender, container } = render(
      <SlashMenu open query="" onSelect={() => {}} onClose={onClose} />,
    );
    expect(screen.getByTestId('septcats-slashmenu')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SlashMenu open={false} query="" onSelect={() => {}} onClose={onClose} />);
    expect(container.querySelector('[data-testid="septcats-slashmenu"]')).toBeNull();
  });
});

describe('BlockControls（手柄 + 菜单）', () => {
  it('点手柄出菜单，选「代码块」→ onAction(convert code)', () => {
    const onAction = vi.fn();
    render(<BlockControls blockId="blk-1" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '块操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /代码块/ }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'convert', blockType: 'code' });
  });

  it('无选区（blockId=null）时手柄禁用', () => {
    render(<BlockControls blockId={null} onAction={() => {}} />);
    expect((screen.getByRole('button', { name: '块操作' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SelectionToolbar（定位纯函数 + 空态）', () => {
  it('selectionRect：选区上方居中，越界钳到 0', () => {
    expect(selectionRect({ top: 200, left: 100, width: 40, height: 20 }, { width: 200, height: 36 })).toEqual({
      left: 20,
      top: 156,
    });
    expect(selectionRect({ top: 4, left: 0, width: 10, height: 10 }, { width: 200, height: 36 })).toEqual({
      left: 0,
      top: 0,
    });
  });

  it('editor/anchor 为空时不渲染', () => {
    const { container } = render(<SelectionToolbar editor={null} anchor={null} />);
    expect(container.querySelector('.sc-selectiontoolbar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T32-01 块编辑器可见性：视口定位纯函数 + 手柄/斜杠浮层渲染条件
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1024, height: 768 };
const MARGIN = 8;

function rect(top: number, left: number, height: number, width: number) {
  return { top, left, bottom: top + height, right: left + width, height, width };
}

describe('viewport（T32-01 浮层定位纯函数）', () => {
  it('overflowsBottom：底边越出视口（留 margin）为 true，视口内为 false', () => {
    expect(overflowsBottom(rect(600, 0, 380, 320), VIEWPORT, MARGIN)).toBe(true);
    expect(overflowsBottom(rect(300, 0, 380, 320), VIEWPORT, MARGIN)).toBe(false);
    // 底边恰在 760（= 768 - margin）不算越出
    expect(overflowsBottom(rect(380, 0, 380, 320), VIEWPORT, MARGIN)).toBe(false);
  });

  it('clampOffsetInViewport：视口内零偏移；越底/越右压回；压回导致顶越界再保底', () => {
    expect(clampOffsetInViewport(rect(300, 100, 380, 320), VIEWPORT, MARGIN)).toEqual({ dx: 0, dy: 0 });
    // 底边 980 > 760 → dy = 760 - 980 = -220
    expect(clampOffsetInViewport(rect(600, 100, 380, 320), VIEWPORT, MARGIN)).toEqual({ dx: 0, dy: -220 });
    // 右边 1100 > 1016 → dx = 1016 - 1100 = -84
    expect(clampOffsetInViewport(rect(100, 780, 200, 320), VIEWPORT, MARGIN)).toEqual({ dx: -84, dy: 0 });
    // 底边 1300 > 760 → dy = 760 - 1300 = -540；top+dy=160 ≥ margin 无保底
    expect(clampOffsetInViewport(rect(700, 100, 600, 320), VIEWPORT, MARGIN)).toEqual({ dx: 0, dy: -540 });
    // 高出视口：压回后 top 越界 → 保底到 margin（dy = 8 - top）
    expect(clampOffsetInViewport(rect(-50, 100, 900, 320), VIEWPORT, MARGIN)).toEqual({ dx: 0, dy: 58 });
    // 全零矩形（jsdom 缺省）不误推
    expect(clampOffsetInViewport(rect(0, 0, 0, 0), VIEWPORT, MARGIN)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('BlockControls（T32-01 手柄渲染条件）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('＋ 按钮：传 onInsert 才渲染，点击回调 onInsert', () => {
    const onInsert = vi.fn();
    const { rerender } = render(<BlockControls blockId="blk-1" onAction={() => {}} />);
    expect(screen.queryByRole('button', { name: '新增块' })).toBeNull();
    rerender(<BlockControls blockId="blk-1" onAction={() => {}} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: '新增块' }));
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('onOpenChange：点手柄 true、Esc 关闭 false（外点 mousedown 同样通知）', () => {
    const onOpenChange = vi.fn();
    render(<BlockControls blockId="blk-1" onAction={() => {}} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: '块操作' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('菜单底边放不下视口 → 翻转到手柄上方（--above）', () => {
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element): DOMRect {
        const cls = typeof this.className === 'string' ? this.className : '';
        if (cls.includes('sc-blockcontrol__menu')) {
          return rect(540, 0, 400, 264) as DOMRect;
        }
        if (cls.includes('sc-blockcontrol')) {
          return rect(500, 0, 40, 28) as DOMRect;
        }
        return rect(0, 0, 0, 0) as DOMRect;
      });
    render(<BlockControls blockId="blk-1" onAction={() => {}} visible />);
    fireEvent.click(screen.getByRole('button', { name: '块操作' }));
    const menu = document.querySelector('.sc-blockcontrol__menu');
    expect(menu).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    expect(menu!.className).toContain('sc-blockcontrol__menu--above');
  });
});

describe('SlashMenu（T32-01 视口夹紧 + 外点关闭）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('贴光标 + 底边越界夹紧：style 位移后落回视口内', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
      const cls = typeof this.className === 'string' ? this.className : '';
      return cls.includes('sc-slashmenu') ? (rect(600, 100, 380, 320) as DOMRect) : (rect(0, 0, 0, 0) as DOMRect);
    });
    const { container } = render(<SlashMenu open query="" position={{ top: 600, left: 100 }} onSelect={() => {}} onClose={() => {}} />);
    const menu = container.querySelector<HTMLElement>('[data-testid="septcats-slashmenu"]');
    expect(menu).not.toBeNull();
    // dy = 760 - 980 = -220 → top 600 - 220 = 380
    expect(menu!.style.top).toBe('380px');
    expect(menu!.style.left).toBe('100px');
  });

  it('视口内不位移；未传 position 不写 style', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
      const cls = typeof this.className === 'string' ? this.className : '';
      return cls.includes('sc-slashmenu') ? (rect(300, 100, 380, 320) as DOMRect) : (rect(0, 0, 0, 0) as DOMRect);
    });
    const { container } = render(<SlashMenu open query="" position={{ top: 300, left: 100 }} onSelect={() => {}} onClose={() => {}} />);
    const menu = container.querySelector<HTMLElement>('[data-testid="septcats-slashmenu"]');
    expect(menu!.style.top).toBe('300px');
    expect(menu!.style.left).toBe('100px');

    const { container: container2 } = render(<SlashMenu open query="" onSelect={() => {}} onClose={() => {}} />);
    const menu2 = container2.querySelector<HTMLElement>('[data-testid="septcats-slashmenu"]');
    expect(menu2!.style.top).toBe('');
  });

  it('菜单外 mousedown 关闭（菜单内点击不关）', () => {
    const onClose = vi.fn();
    const { container } = render(<SlashMenu open query="" onSelect={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTestId('septcats-slashmenu'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
