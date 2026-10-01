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

  it('点击中途目标被摘出 DOM（宿主同步换实例）→ 不误伤 outside-close（移入…二级回归钉）', () => {
    const onDismiss = vi.fn();
    render(<Menu items={items} onDismiss={onDismiss} />);
    const btn = screen.getByRole('menuitem', { name: /重命名/ });
    // 复现真实场景：宿主在按钮 onClick 里同步换菜单实例（旧按钮随旧实例卸载出 DOM）；
    // click 继续沿 dispatch 开始时冻结的路径冒泡到 document，此时 target 是游离节点。
    // 「移入…」二级（T61）依赖此语义：换实例不得被 outside-close 判成点空白自灭。
    btn.addEventListener('click', () => btn.remove());
    fireEvent.click(btn);
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


/** 本 describe 内取第 n 个同名钮（noUncheckedIndexedAccess 下的收敛助手）。 */
function actionBtn(name: string, index = 0): HTMLElement {
  const found = screen.getAllByRole('button', { name })[index];
  if (found === undefined) {
    throw new Error(`action button not found: ${String(name)}#${String(index)}`);
  }
  return found;
}
  describe('行内动作钮（IDEA-E 视图排序）', () => {
    const withActions = [
      {
        id: 'v1',
        label: '表格',
        actions: [
          { id: 'up', label: '前移', disabled: true },
          { id: 'down', label: '后移' },
        ],
      },
      {
        id: 'v2',
        label: '看板',
        actions: [
          { id: 'up', label: '前移' },
          { id: 'down', label: '后移', disabled: true },
        ],
      },
    ] as const;

    it('动作钮是真 button：无障碍名可见，主项仍为 role=menuitem', () => {
      render(<Menu items={withActions} label="视图" />);
      expect(screen.getAllByRole('menuitem')).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: '前移' })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: '后移' })).toHaveLength(2);
    });

    it('点动作钮只发 onAction（带 entryId），不发 onSelect、不关菜单', () => {
      const onSelect = vi.fn();
      const onAction = vi.fn();
      render(<Menu items={withActions} label="视图" onSelect={onSelect} onAction={onAction} />);
      fireEvent.click(actionBtn('后移'));
      expect(onAction).toHaveBeenCalledWith('down', 'v1');
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).not.toBeNull();
    });

    it('disabled 的动作钮点击零回调', () => {
      const onAction = vi.fn();
      render(<Menu items={withActions} label="视图" onAction={onAction} />);
      const up = actionBtn('前移', 0);
      expect(up.hasAttribute('disabled')).toBe(true);
      fireEvent.click(up);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('键盘：动作钮 Enter 不被根的 menuitem 选择吞掉（stopPropagation），激活走 click', () => {
      const onSelect = vi.fn();
      const onAction = vi.fn();
      render(<Menu items={withActions} label="视图" onSelect={onSelect} onAction={onAction} />);
      const down = actionBtn('后移');
      down.focus();
      // 浏览器里 Enter 会「keydown + click」两步；jsdom 不合成 click，分两步各验一半：
      fireEvent.keyDown(down, { key: 'Enter' });
      expect(onSelect).not.toHaveBeenCalled(); // keydown 已阻断冒泡 → 根不选主项
      fireEvent.click(down); // 原生 Enter 紧随的激活 = 本钮 click
      expect(onAction).toHaveBeenCalledWith('down', 'v1');
    });

    it('无 actions 的项 = 旧 DOM（菜单项不被包进额外容器）', () => {
      const { container } = render(<Menu items={items} label="页面操作" />);
      const row = container.querySelector('.sc-menu__row');
      expect(row).toBeNull();
      expect(container.querySelectorAll('.sc-menu > .sc-menu__item')).toHaveLength(3);
    });
  });
});
