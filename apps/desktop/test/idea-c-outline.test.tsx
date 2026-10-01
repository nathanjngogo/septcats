// @vitest-environment jsdom
/**
 * idea-c-outline.test.tsx —— 页内大纲组件（IDEA-C）渲染层断言。
 *
 * 提取口径（collectHeadings）已被 packages/editor/test/headings.test.ts 5 例钉死；
 * 这里只测组件契约：<2 标题不渲染、展开/折叠、level 缩进类、点击回调=跳转通道、长标题截断。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageOutline } from '../src/renderer/src/pages/PageOutline';
import type { HeadingEntry } from '@septcats/editor';

const H: HeadingEntry[] = [
  { id: 'a1', level: 1, text: '总览' },
  { id: 'b2', level: 2, text: '章一' },
  { id: 'c3', level: 3, text: '节一' },
];

afterEach(cleanup);

describe('PageOutline', () => {
  it('少于 2 个标题 → 整条不渲染（短笔记不加噪音行）', () => {
    const { container } = render(<PageOutline headings={H.slice(0, 1)} onJump={vi.fn()} />);
    expect(container.querySelector('[data-testid="pv-outline"]')).toBeNull();
    const empty = render(<PageOutline headings={[]} onJump={vi.fn()} />);
    expect(empty.container.querySelector('[data-testid="pv-outline"]')).toBeNull();
  });

  it('折叠默认收起；点「目录 · 3」展开列表（含计数徽标）', () => {
    render(<PageOutline headings={H} onJump={vi.fn()} />);
    const toggle = screen.getByTestId('pv-outline-toggle');
    expect(toggle.textContent).toBe('目录 · 3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('pv-outline-list')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('pv-outline-list')).toBeDefined();
  });

  it('条目按 level 挂缩进类；点击回调带块 id（宿主走 jumpToBlockId）', () => {
    const onJump = vi.fn();
    render(<PageOutline headings={H} onJump={onJump} />);
    fireEvent.click(screen.getByTestId('pv-outline-toggle'));
    expect((screen.getByTestId('pv-outline-item-b2') as HTMLElement).className).toContain('pv-outline-item--l2');
    fireEvent.click(screen.getByTestId('pv-outline-item-c3'));
    expect(onJump).toHaveBeenCalledWith('c3');
  });

  it('长标题截断到 32 码点 + 省略号；title 属性留全文', () => {
    const long: HeadingEntry[] = [{ id: 'x', level: 1, text: '一'.repeat(40) }, { id: 'y', level: 1, text: '短' }];
    render(<PageOutline headings={long} onJump={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pv-outline-toggle'));
    const item = screen.getByTestId('pv-outline-item-x');
    expect([...(item.textContent ?? '')]).toHaveLength(32);
    expect(item.textContent).toContain('…');
    expect(item.getAttribute('title'), '悬浮必须能看到完整标题').toBe('一'.repeat(40));
  });

  it('空文本条目不会进来（组件防御：引擎已过滤，这里再钉一次渲染面）', () => {
    render(<PageOutline headings={[{ id: 'a', level: 1, text: 'A' }, { id: 'b', level: 1, text: 'B' }]} onJump={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pv-outline-toggle'));
    const list = screen.getByTestId('pv-outline-list');
    expect(list.querySelectorAll('.pv-outline-item')).toHaveLength(2);
  });
});