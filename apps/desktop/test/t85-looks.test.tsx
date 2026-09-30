// @vitest-environment jsdom
/**
 * t85-looks.test.ts —— 质感派系状态（lookState.ts）单测（TASK-T85-01 §测试）。
 *
 * 覆盖：持久化 roundtrip / 野值回退 instrument / 应用器写根属性 / setLook 即时应用 /
 * 设置页质感行在位 + 点选生效（data-look 落 documentElement）。老板 09-27 取消画廊后改口径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeSection } from '../src/renderer/src/theme/ThemeSection';
import { configurePaletteCommands } from '../src/renderer/src/palette/commands';
import {
  applyLookToRoot,
  DEFAULT_LOOK,
  isLookId,
  LOOK_IDS,
  APPEARANCE_STAMP_KEY,
  lookActions,
  lookStore,
  readLook,
} from '../src/renderer/src/theme/lookState';

describe('lookState · 持久化与回退', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-look');
    lookStore.setState(() => ({ look: DEFAULT_LOOK }));
  });

  it('readLook 缺失 → 新默认 instrument（老板 10-01 选定方向 B）', () => {
    expect(readLook()).toBe(DEFAULT_LOOK);
    expect(DEFAULT_LOOK).toBe('instrument');
  });

  it('readLook 野值 → 新默认 instrument', () => {
    window.localStorage.setItem('septcats.look', 'banana');
    expect(readLook()).toBe(DEFAULT_LOOK);
  });

  it('首次运行本版本：落新默认一次（并盖章）；旧存储的 pixel（已下线）被升级为新默认', () => {
    window.localStorage.setItem('septcats.look', 'pixel');
    expect(readLook()).toBe('instrument');
    expect(window.localStorage.getItem('septcats.look')).toBe('instrument');
    expect(window.localStorage.getItem(APPEARANCE_STAMP_KEY)).toBe('1');
  });

  it('盖章之后：一律尊重用户显式选择（linear 不会被再次改写）', () => {
    window.localStorage.setItem(APPEARANCE_STAMP_KEY, '1');
    window.localStorage.setItem('septcats.look', 'linear');
    expect(readLook()).toBe('linear');
  });

  it('readLook 合法值 roundtrip', () => {
    window.localStorage.setItem('septcats.look', 'glass');
    expect(readLook()).toBe('glass');
  });

  it('isLookId 兜底 + LOOK_IDS 清单钉（老板 10-01：只留 极简/夜航仪表/毛玻璃 三档，像素档已下线）', () => {
    expect([...LOOK_IDS]).toEqual(['instrument', 'linear', 'glass']);
    expect([...LOOK_IDS], '像素档必须不再可选').not.toContain('pixel');
    expect(isLookId('pixel'), '像素档不再是合法 id（旧存储值走迁移）').toBe(false);
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
    expect(lookStore.getState().look).toBe(DEFAULT_LOOK);
    expect(window.localStorage.getItem('septcats.look')).toBeNull();
  });

  it('init 读存储并挂根属性（野值回退 instrument）', () => {
    window.localStorage.setItem('septcats.look', 'linear');
    lookActions.init();
    expect(lookStore.getState().look).toBe('linear');
    expect(document.documentElement.dataset.look).toBe('linear');
  });
});

const noop = (): void => {};

describe('设置→外观 · 质感行（老板 09-27：取消画廊、内联进设置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-look');
    document.documentElement.removeAttribute('data-palette');
    delete document.documentElement.dataset.theme;
    lookStore.setState(() => ({ look: DEFAULT_LOOK }));
    lookActions.init();
  });

  it('三档选项在位（LOOK_IDS 每条都有对应 radio，且无像素档）', () => {
    render(<ThemeSection />);
    const row = document.querySelector('[data-testid="theme-look-section"]');
    expect(row).not.toBeNull();
    const values = [...(row as HTMLElement).querySelectorAll('input[type="radio"]')].map(
      (el) => (el as HTMLInputElement).value,
    );
    expect(values).toEqual([...LOOK_IDS]);
    cleanup();
  });

  it('默认 instrument 为选中态（受控 radio；老板 10-01 选定方向 B）', () => {
    render(<ThemeSection />);
    const row = document.querySelector('[data-testid="theme-look-section"]') as HTMLElement;
    expect((row.querySelector('input[value="instrument"]') as HTMLInputElement).checked).toBe(true);
    expect((row.querySelector('input[value="glass"]') as HTMLInputElement).checked).toBe(false);
    expect(row.querySelector('input[value="pixel"]'), '像素档 radio 必须不存在').toBeNull();
    cleanup();
  });

  it('点 glass → 即时应用（store + localStorage + documentElement 三处）+ 选中态迁移', () => {
    render(<ThemeSection />);
    fireEvent.click(document.querySelector('input[value="glass"]') as HTMLElement);
    expect(lookStore.getState().look).toBe('glass');
    expect(window.localStorage.getItem('septcats.look')).toBe('glass');
    expect(document.documentElement.dataset.look).toBe('glass');
    expect((document.querySelector('input[value="glass"]') as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('input[value="pixel"]'), '已下线档不应有 radio').toBeNull();
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
    const without = configurePaletteCommands({ ...baseDeps, setThemePalette: noop }, true).map((c) => c.id);
    expect(without.filter((id) => id.startsWith('theme.look.'))).toEqual([]);
    const withLook = configurePaletteCommands(
      { ...baseDeps, setThemePalette: noop, setThemeLook: noop },
      true,
    ).map((c) => c.id);
    for (const id of ['theme.look.instrument', 'theme.look.linear', 'theme.look.glass']) {
      expect(withLook, `缺 ${id}`).toContain(id);
    }
  });

  // TASK-T95-02（Apple §12「材质要形成，不是啪一下出现」）：换档才播，首屏不播，同值不重播。
  it('T95-02 材质成形：换档挂 data-look-settling，450ms 后摘除（首屏/同值不播）', () => {
    vi.useFakeTimers();
    try {
      delete document.documentElement.dataset.look;
      delete document.documentElement.dataset.lookSettling; // 前一用例的计时器可能未到点
      applyLookToRoot('glass'); // 首屏 init：不播
      expect(document.documentElement.dataset.lookSettling).toBeUndefined();
      lookActions.setLook('linear'); // 换档（glass → linear）：播
      expect(document.documentElement.dataset.lookSettling).toBe('1');
      vi.advanceTimersByTime(449);
      expect(document.documentElement.dataset.lookSettling).toBe('1');
      vi.advanceTimersByTime(1);
      expect(document.documentElement.dataset.lookSettling).toBeUndefined();
      applyLookToRoot('linear'); // 同值：不重播
      expect(document.documentElement.dataset.lookSettling).toBeUndefined();
    } finally {
      vi.useRealTimers();
      delete document.documentElement.dataset.look;
      delete document.documentElement.dataset.lookSettling;
    }
  });
});
