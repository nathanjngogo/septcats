import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

// ---------------------------------------------------------------------------
// T60-01 ③：点空白即关（PRD-R13 ③「所有下拉框点空白应关闭」）
// ---------------------------------------------------------------------------
describe('Menu outside-close（T60-01 ③）', () => {
  it('点菜单外（document.body）→ onDismiss 一次', () => {
    const onDismiss = vi.fn();
    render(<Menu items={items} onDismiss={onDismiss} />);
    fireEvent.click(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('点菜单内（含 padding 空白区）→ 不关（不误伤菜单自身）', () => {
    const onDismiss = vi.fn();
    render(<Menu items={items} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('menu'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /复制链接/ }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('卸载即摘监听：再点空白不再回调（无泄漏）', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Menu items={items} onDismiss={onDismiss} />);
    unmount();
    fireEvent.click(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(0);
  });

  /**
   * 竞态（任务书 §0-3 点名）：触发器是 toggle（`setOpen(v => !v)`）且住在菜单根之外。
   * 若用 pointerdown 做 outside-close，按键关菜单会「先关后开」——本用例把这个序列
   * 钉住：两次点同一个触发器钮 = 开 → 关。
   */
  it('toggle 触发器同钮二次点击 = 开 → 关（outside-close 不与 toggle 抢同一事件）', () => {
    function Host(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            页面操作
          </button>
          {open ? (
            <Menu
              items={items}
              onDismiss={() => {
                setOpen(false);
              }}
            />
          ) : null}
        </div>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: '页面操作' });

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeNull();

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
