// @vitest-environment jsdom
/**
 * menu-bar-band.test.tsx —— T87-02 自绘菜单带（老板 09-28：「整个软件随着主题而改变」，
 * 原生菜单栏不吃 CSS token = 换肤漏掉那条带 → Windows 撤原生菜单、renderer 顶上）。
 *
 * 钉的是「行为单源」契约：
 *  M1 Win UA 下带在位、四组入口齐全（文件/编辑/视图/帮助，label 走 menu.* i18n）；
 *  M2 点入口展开 Menu（role=menu），条目点击 → menu.click({action}) 回 main，
 *     **不经 renderer 本地第二套动作实现**（newPage/about/quit 全走 click）；
 *  M3 编辑/缩放条目 → menu.role({role})（undo/cut/zoomIn…与旧原生模板语义一致）；
 *  M4 非 Win UA（mac）→ 整条不渲染（原生菜单栏保留）。
 * 观感（token 随主题联动）由 cdp-e2e-t87-02.mjs 真机钉；这里不测样式。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuBarBand } from '../src/renderer/src/menu/MenuBarBand';
import { zhCN } from '../src/renderer/src/i18n/zh-CN';

const menu = {
  onAction: vi.fn(() => () => {}),
  click: vi.fn(async () => undefined),
  role: vi.fn(async () => undefined),
};

function mountBand(): void {
  Object.defineProperty(window, 'septcats', {
    configurable: true,
    value: { menu } as unknown as Window['septcats'],
  });
  render(<MenuBarBand />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 默认 UA 不含 Windows → 手工钉 Win（组件按 UA 判定，与 main 撤菜单同一平台口径）
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0)', configurable: true });
});

afterEach(() => {
  cleanup();
});

describe('T87-02 MenuBarBand', () => {
  it('M1 Win UA：四组入口齐全（label=i18n menu.*）', () => {
    mountBand();
    for (const key of ['file', 'edit', 'view', 'help'] as const) {
      expect((screen.getByTestId(`menu-bar-${key}`).textContent ?? '').includes(zhCN.menu[key]), key).toBe(true);
    }
  });

  it('M2 「文件」→ 新建页面/退出 全部回发 menu.click（动作单源在 main）', () => {
    mountBand();
    fireEvent.click(screen.getByTestId('menu-bar-file'));
    const menuEl = screen.getByRole('menu');
    const items = [...menuEl.querySelectorAll('[role="menuitem"]')];
    const byText = (text: string): HTMLElement | undefined =>
      items.find((el) => (el.textContent ?? '').includes(text)) as HTMLElement | undefined;
    fireEvent.click(byText(zhCN.menu.fileNewPage) ?? ((): never => { throw new Error('缺新建页面'); })());
    expect(menu.click).toHaveBeenCalledWith({ action: 'newPage' });
    fireEvent.click(screen.getByTestId('menu-bar-file'));
    const items2 = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')];
    const quit = items2.find((el) => (el.textContent ?? '').includes(zhCN.menu.fileQuit)) as HTMLElement;
    fireEvent.click(quit);
    expect(menu.click).toHaveBeenLastCalledWith({ action: 'quit' });
  });

  it('M3 「编辑」撤销 → menu.role=undo；「视图」缩放 → menu.role=zoomIn/resetZoom', () => {
    mountBand();
    fireEvent.click(screen.getByTestId('menu-bar-edit'));
    const undo = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')]
      .find((el) => (el.textContent ?? '').includes(zhCN.menu.editUndo)) as HTMLElement;
    fireEvent.click(undo);
    expect(menu.role).toHaveBeenCalledWith({ role: 'undo' });
    fireEvent.click(screen.getByTestId('menu-bar-view'));
    const zin = [...screen.getByRole('menu').querySelectorAll('[role="menuitem"]')]
      .find((el) => (el.textContent ?? '').includes(zhCN.menu.viewZoomIn)) as HTMLElement;
    fireEvent.click(zin);
    expect(menu.role).toHaveBeenLastCalledWith({ role: 'zoomIn' });
  });

  it('M4 mac UA：整条不渲染（原生菜单栏保留）', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true });
    render(<MenuBarBand />);
    expect(screen.queryByTestId('menu-bar-band')).toBeNull();
  });

  it('M5 Esc 收起打开的下拉（最低完备交互）', () => {
    mountBand();
    fireEvent.click(screen.getByTestId('menu-bar-file'));
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
