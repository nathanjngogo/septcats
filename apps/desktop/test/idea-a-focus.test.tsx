// @vitest-environment jsdom
/**
 * idea-a-focus.test.tsx —— 专注模式（创意项 IDEA-A，老板 10-01「在现有产品基础上发挥」授权）。
 *
 * 关键点：快捷键走 **useFocusHotkeys**（与 App 同一份实现，不是测试里复制逻辑——
 * 复制=假绿）。命令走 configurePaletteCommands 真实装配。
 * 口径：旁路瞬时态（localStorage + documentElement[data-focus]，不进 Op 账本、不同步）。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ReactNode } from 'react';
import { FocusBadge, FocusToggleButton, useFocusHotkeys } from '../src/renderer/src/layout/FocusMode';
import { FOCUS_STORAGE_KEY, getFocus, onFocusChange, setFocus } from '../src/renderer/src/theme/focusState';
import { configurePaletteCommands, type CommandDeps } from '../src/renderer/src/palette/commands';
import { toggleFocus } from '../src/renderer/src/theme/focusState';

beforeEach(() => {
  window.localStorage.clear();
  setFocus(false);
});

afterEach(() => {
  cleanup();
  setFocus(false);
});

describe('focusState（真相源）', () => {
  it('setFocus 三效：dataset 挂/摘 + 存储写/删 + 订阅者收到', () => {
    const seen: boolean[] = [];
    const off = onFocusChange((on) => { seen.push(on); });
    setFocus(true);
    expect(document.documentElement.dataset.focus).toBe('on');
    expect(window.localStorage.getItem(FOCUS_STORAGE_KEY)).toBe('1');
    setFocus(false);
    expect(document.documentElement.dataset.focus, '关态必须摘 dataset（CSS 以存在性判定）').toBeUndefined();
    expect(window.localStorage.getItem(FOCUS_STORAGE_KEY)).toBeNull();
    off();
    expect(seen).toEqual([true, false]);
  });
});

describe('顶栏钮与角标', () => {
  it('钮点击 toggle：aria-pressed + dataset 同步翻转', () => {
    render(<FocusToggleButton />);
    const btn = screen.getByTestId('focus-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(getFocus()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.focus).toBe('on');
  });

  it('角标只在专注中渲染（订阅同一状态源）', () => {
    render(<FocusBadge />);
    expect(screen.queryByTestId('focus-badge')).toBeNull();
    // React 事件外的同步订阅要包 act（否则不重渲染——假红而非假绿，测试必须诚实）
    act(() => {
      setFocus(true);
    });
    expect(screen.getByTestId('focus-badge').textContent).toContain('专注中');
  });
});

function HotkeyHost(): ReactNode {
  useFocusHotkeys(false);
  return null;
}

describe('快捷键（与 App 同源 hook）', () => {
  it('F9 开 → F9 关；Esc 只在专注中退出', () => {
    render(<HotkeyHost />);
    fireEvent.keyDown(window, { key: 'F9' });
    expect(getFocus()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getFocus()).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getFocus(), '非专注时 Esc 无事发生').toBe(false);
  });

  it('dialog 开着时 Esc 让位弹层（一次按键只干一件事）', () => {
    render(<HotkeyHost />);
    setFocus(true);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getFocus(), 'Esc 该归 dialog').toBe(true);
    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getFocus(), 'dialog 关了 Esc 就该退专注').toBe(false);
  });

  it('带修饰键的 F9/Esc 不抢（留给系统/其它快捷键）', () => {
    render(<HotkeyHost />);
    fireEvent.keyDown(window, { key: 'F9', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'F9', altKey: true });
    expect(getFocus()).toBe(false);
  });
});

describe('命令面板', () => {
  it('「切换专注模式」命令存在且与钮同通道（都走 focusState 唯一入口）', () => {
    const deps = {
      createPage: () => { /* noop */ },
      switchToNextWorkspace: () => { /* noop */ },
      openTrash: () => { /* noop */ },
      openSettings: () => { /* noop */ },
      toggleFocus,
    } as unknown as CommandDeps;
    const commands = configurePaletteCommands(deps, false);
    const hit = commands.find((c) => c.id === 'app.focus');
    expect(hit, '命令没注册').toBeDefined();
    hit?.run();
    expect(getFocus()).toBe(true);
    expect(document.documentElement.dataset.focus).toBe('on');
  });
});
