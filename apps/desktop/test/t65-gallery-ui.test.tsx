// @vitest-environment jsdom
/**
 * t65-gallery-ui.test.tsx —— 主题画廊 UI + 命令面板 + 顶栏入口（TASK-T65-01 §测试）。
 *
 * 覆盖：六卡在（含「当前」角标唯一）/ 点卡切换生效 / oled 浅色置灰 / 明暗切换不丢
 * palette / 顶栏入口钮可达 / 命令面板 7 条可达。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeGallery } from '../src/renderer/src/theme/ThemeGallery';
import { ThemePaletteButton } from '../src/renderer/src/theme/ThemePaletteButton';
import {
  paletteActions,
  paletteStore,
  usePaletteThemeSync,
} from '../src/renderer/src/theme/paletteState';
import { configurePaletteCommands } from '../src/renderer/src/palette/commands';

const noop = (): void => {};

function fullDeps(overrides: Record<string, unknown> = {}) {
  return {
    createPage: noop,
    switchToNextWorkspace: noop,
    openTrash: noop,
    openSettings: noop,
    openImport: noop,
    openManual: noop,
    openLayoutEditor: noop,
    openWorkbench: noop,
    openThemeGallery: noop,
    setThemePalette: noop,
    notify: noop,
    setThemeMode: noop,
    ...overrides,
  } as never;
}

function currentCardTestId(): string | null {
  // T85-01：画廊新增质感行（data-look 卡）——当前卡查询限定配色卡（data-palette），
  // 避免与质感卡的 data-current 撞名。
  return document.querySelector('[data-current="true"][data-palette]')?.getAttribute('data-testid') ?? null;
}

describe('主题画廊 UI', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    paletteStore.setState(() => ({ palette: 'mono' }));
    paletteActions.init();
  });

  afterEach(() => {
    cleanup();
  });

  it('六张派系卡都在（T85-01 后：画廊 = 6 配色卡 + 3 质感卡，此处限定 data-palette）', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    const cards = document.querySelectorAll('[data-testid^="theme-gallery-card-"][data-palette]');
    expect(cards.length).toBe(6);
  });

  it('「当前」角标唯一（默认 mono）', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    const badges = screen.getAllByTestId('theme-gallery-current');
    expect(badges.length).toBe(1);
    expect(currentCardTestId()).toBe('theme-gallery-card-mono');
  });

  it('点卡切换生效（写入 documentElement.dataset.palette + store，角标迁移）', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    fireEvent.click(screen.getByTestId('theme-gallery-card-moss'));
    expect(document.documentElement.dataset.palette).toBe('moss');
    expect(paletteStore.getState().palette).toBe('moss');
    expect(currentCardTestId()).toBe('theme-gallery-card-moss');
  });

  it('浅色基底下 oled 卡置灰不可点（按 mono 渲染，角标仍在 mono）', () => {
    render(<ThemeGallery open resolvedTheme="light" onClose={noop} />);
    const oled = screen.getByTestId('theme-gallery-card-oled') as HTMLButtonElement;
    expect(oled.disabled).toBe(true);
    expect(currentCardTestId()).toBe('theme-gallery-card-mono');
    // 点置灰卡不切换
    fireEvent.click(oled);
    expect(document.documentElement.dataset.palette).toBe('mono');
  });

  it('明暗切换不丢 palette（usePaletteThemeSync 重新落根属性）', () => {
    paletteActions.setPalette('moss');
    function SyncProbe({ theme }: { theme: 'light' | 'dark' }): null {
      usePaletteThemeSync(theme);
      return null;
    }
    const { rerender } = render(<SyncProbe theme="light" />);
    expect(document.documentElement.dataset.palette).toBe('moss');
    rerender(<SyncProbe theme="dark" />);
    expect(document.documentElement.dataset.palette).toBe('moss');
  });
});

describe('命令面板可达（7 条）', () => {
  it('含 theme.palette + 六条 theme.switch.*', () => {
    const cmds = configurePaletteCommands(fullDeps(), true);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('theme.palette');
    for (const id of ['mono', 'oled', 'contrast', 'paper', 'slate', 'moss']) {
      expect(ids, `缺 theme.switch.${id}`).toContain(`theme.switch.${id}`);
    }
  });

  it('运行画廊命令 → openThemeGallery 被调', () => {
    const openThemeGallery = vi.fn();
    const cmds = configurePaletteCommands(fullDeps({ openThemeGallery }), true);
    cmds.find((c) => c.id === 'theme.palette')?.run();
    expect(openThemeGallery).toHaveBeenCalledTimes(1);
  });

  it('运行切派系命令 → setThemePalette(id) 被调', () => {
    const setThemePalette = vi.fn();
    const cmds = configurePaletteCommands(fullDeps({ setThemePalette }), true);
    cmds.find((c) => c.id === 'theme.switch.slate')?.run();
    expect(setThemePalette).toHaveBeenCalledWith('slate');
  });
});

describe('顶栏入口可达', () => {
  it('palette-open 钮存在且点击回调触发', () => {
    const onClick = vi.fn();
    render(<ThemePaletteButton ariaPressed={false} onClick={onClick} />);
    const btn = screen.getByTestId('palette-open');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
