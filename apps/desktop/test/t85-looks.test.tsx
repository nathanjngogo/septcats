// @vitest-environment jsdom
/**
 * t85-looks.test.ts —— 质感派系状态（lookState.ts）单测（TASK-T85-01 §测试）。
 *
 * 覆盖：持久化 roundtrip / 野值回退 pixel / 应用器写根属性 / setLook 即时应用 /
 * 画廊三质感卡在位 + 点卡生效（data-look 落 documentElement）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeGallery } from '../src/renderer/src/theme/ThemeGallery';
import { configurePaletteCommands } from '../src/renderer/src/palette/commands';
import {
  applyLookToRoot,
  isLookId,
  LOOK_IDS,
  lookActions,
  lookStore,
  readLook,
} from '../src/renderer/src/theme/lookState';

describe('lookState · 持久化与回退', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-look');
    lookStore.setState(() => ({ look: 'pixel' }));
  });

  it('readLook 缺失 → pixel', () => {
    expect(readLook()).toBe('pixel');
  });

  it('readLook 野值 → pixel', () => {
    window.localStorage.setItem('septcats.look', 'banana');
    expect(readLook()).toBe('pixel');
  });

  it('readLook 合法值 roundtrip', () => {
    window.localStorage.setItem('septcats.look', 'glass');
    expect(readLook()).toBe('glass');
  });

  it('isLookId 兜底 + LOOK_IDS 清单钉（pixel/linear/glass，老板点名的两条必须在列）', () => {
    expect([...LOOK_IDS]).toEqual(['pixel', 'linear', 'glass']);
    expect(isLookId('linear')).toBe(true);
    expect(isLookId('nope')).toBe(false);
    expect(isLookId(1)).toBe(false);
  });

  it('applyLookToRoot 写 documentElement.dataset.look', () => {
    applyLookToRoot('linear');
    expect(document.documentElement.dataset.look).toBe('linear');
  });

  it('setLook 一步到位：store + localStorage + 根属性', () => {
    lookActions.setLook('glass');
    expect(lookStore.getState().look).toBe('glass');
    expect(window.localStorage.getItem('septcats.look')).toBe('glass');
    expect(document.documentElement.dataset.look).toBe('glass');
  });

  it('setLook 野值静默拒（不写存储不挂属性）', () => {
    lookActions.setLook('banana' as never);
    expect(lookStore.getState().look).toBe('pixel');
    expect(window.localStorage.getItem('septcats.look')).toBeNull();
  });

  it('init 读存储并挂根属性（野值回退 pixel）', () => {
    window.localStorage.setItem('septcats.look', 'linear');
    lookActions.init();
    expect(lookStore.getState().look).toBe('linear');
    expect(document.documentElement.dataset.look).toBe('linear');
  });
});

const noop = (): void => {};

describe('主题画廊 · 质感行（T85-01 入主题市场）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-look');
    lookStore.setState(() => ({ look: 'pixel' }));
    lookActions.init();
  });

  it('三张质感卡在位（data-look 卡；与配色卡 data-palette 互斥标记）', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    const lookCards = document.querySelectorAll('[data-testid^="theme-gallery-card-"][data-look]');
    expect(lookCards.length).toBe(3);
    for (const id of LOOK_IDS) {
      expect(document.querySelector(`[data-testid="theme-gallery-card-${id}"][data-look="${id}"]`)).not.toBeNull();
    }
    cleanup();
  });

  it('默认 pixel 卡带「当前」角标', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    const pixel = document.querySelector('[data-testid="theme-gallery-card-pixel"]');
    expect(pixel?.getAttribute('data-current')).toBe('true');
    expect(pixel?.querySelector('[data-testid="theme-gallery-look-current"]')).not.toBeNull();
    cleanup();
  });

  it('点 glass 卡 → 即时应用（store + localStorage + documentElement 三处）', () => {
    render(<ThemeGallery open resolvedTheme="dark" onClose={noop} />);
    const glass = document.querySelector<HTMLElement>('[data-testid="theme-gallery-card-glass"]');
    expect(glass).not.toBeNull();
    fireEvent.click(glass as HTMLElement);
    expect(lookStore.getState().look).toBe('glass');
    expect(window.localStorage.getItem('septcats.look')).toBe('glass');
    expect(document.documentElement.dataset.look).toBe('glass');
    // 角标迁移
    expect(
      document.querySelector('[data-testid="theme-gallery-card-glass"]')?.getAttribute('data-current'),
    ).toBe('true');
    expect(
      document.querySelector('[data-testid="theme-gallery-card-pixel"]')?.getAttribute('data-current'),
    ).toBe('false');
    cleanup();
  });
});

describe('命令面板 · 质感切换（T85-01）', () => {
  it('注入 setThemeLook → 三条 theme.look.* 在列；不注入 → 不出现', () => {
    const base = {
      createPage: noop,
      switchToNextWorkspace: noop,
      openTrash: noop,
      openSettings: noop,
      openImport: noop,
      openManual: noop,
      openLayoutEditor: noop,
      openWorkbench: noop,
      notify: noop,
      setThemeMode: noop,
    };
    type Deps = Parameters<typeof configurePaletteCommands>[0];
    const baseDeps = base as Deps;
    const without = configurePaletteCommands({ ...baseDeps, openThemeGallery: noop, setThemePalette: noop }, true).map((c) => c.id);
    expect(without.filter((id) => id.startsWith('theme.look.'))).toEqual([]);
    const withLook = configurePaletteCommands(
      { ...baseDeps, openThemeGallery: noop, setThemePalette: noop, setThemeLook: noop },
      true,
    ).map((c) => c.id);
    for (const id of ['theme.look.pixel', 'theme.look.linear', 'theme.look.glass']) {
      expect(withLook, `缺 ${id}`).toContain(id);
    }
  });
});
