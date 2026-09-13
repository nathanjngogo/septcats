import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';


const items = [
  { id: 'rename', label: '重命名', hint: 'F2' },
  { id: 'copy', label: '复制链接', hint: 'Ctrl+L' },
  { id: 'delete', label: '删除', hint: 'Del', danger: true },
] as const;

describe('Menu', () => {
  it('aria-menu：role=menu / menuitem，hint 用 Kbd', () => {
    render(<Menu items={items} label="页面操作" />);
    expect(screen.getByRole('menu', { name: '页面操作' })).not.toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByText('F2').tagName).toBe('KBD');
    expectTokenOnlyCssFile('src/Menu.css');
  });

  it('方向键移动焦点（跳过 disabled），Enter 选中', () => {
    const onSelect = vi.fn();
    render(
      <Menu
        items={[items[0], { id: 'locked', label: '不可用', disabled: true }, items[2]]}
        onSelect={onSelect}
      />,
    );
    const menu = screen.getByRole('menu');
    // 初始焦点在第一项
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /重命名/ }));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // 跳过 disabled，落到「删除」
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /删除/ }));

    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('delete');
  });

  it('Esc 关闭（onDismiss）', () => {
    const onDismiss = vi.fn();
    render(<Menu items={items} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('点击项触发 onSelect；disabled 项不触发', () => {
    const onSelect = vi.fn();
    render(<Menu items={[items[0], { id: 'locked', label: '不可用', disabled: true }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /重命名/ }));
    expect(onSelect).toHaveBeenCalledWith('rename');
    fireEvent.click(screen.getByRole('menuitem', { name: /不可用/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
