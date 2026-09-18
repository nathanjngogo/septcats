import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { BlockDoc } from '../src/model';
import { Editor } from '../src/react/Editor';
import { BlockControls } from '../src/react/BlockControls';
import { SlashMenu } from '../src/react/SlashMenu';
import { SelectionToolbar, selectionRect } from '../src/react/SelectionToolbar';
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
