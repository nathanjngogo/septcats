// @vitest-environment jsdom
/**
 * t65-theme-settings.test.tsx —— 「设置→外观」主题两项（配色派系 + 质感风格）+ 命令面板。
 *
 * **老板 09-27 令（原话）**：「2. 根本没有毛玻璃等主题 … 4. 取消主题画廊」——画廊浮层与
 * 顶栏入口钮一并取消，配色/质感**内联成设置行**；原 `t65-gallery-ui.test.tsx` 随画廊废止，
 * 本文件承接其断言面，并加上「两行可见 = 用户能直接看到毛玻璃/Linear」这条关键断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeSection } from '../src/renderer/src/theme/ThemeSection';
import { isPaletteDisabled, PALETTE_IDS, paletteActions, paletteStore } from '../src/renderer/src/theme/paletteState';
import { LOOK_IDS, lookActions, lookStore } from '../src/renderer/src/theme/lookState';
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
    setThemePalette: noop,
    setThemeLook: noop,
    notify: noop,
    setThemeMode: noop,
    ...overrides,
  } as never;
}

/** 取某一行内某标签对应的原生 radio（置灰断言要用原生 disabled）。 */
function optionInput(rowTestId: string, label: string): HTMLInputElement {
  const row = screen.getByTestId(rowTestId);
  const input = within(row).getByText(label).closest('label')?.querySelector('input');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function clickOption(rowTestId: string, value: string): void {
  const input = screen.getByTestId(rowTestId).querySelector(`input[value="${value}"]`);
  expect(input, `缺选项 ${value}`).not.toBeNull();
  fireEvent.click(input as HTMLInputElement);
}

describe('设置→外观 · 主题两项（画廊取消后内联）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    document.documentElement.removeAttribute('data-look');
    delete document.documentElement.dataset.theme; // 默认浅色基底
    paletteStore.setState(() => ({ palette: 'mono' }));
    lookStore.setState(() => ({ look: 'pixel' }));
    // 种子化根属性（与 App 挂载口径一致），否则默认态在 jsdom 根上是空的
    paletteActions.init();
    lookActions.init();
  });

  afterEach(() => {
    cleanup();
  });

  it('两行都在：配色 7 项 + 质感 4 项（含老板点名的「毛玻璃」「Linear 极简」与方向 B「夜航仪表」）', () => {
    render(<ThemeSection />);
    const paletteRow = screen.getByTestId('theme-section');
    const lookRow = screen.getByTestId('theme-look-section');
    expect(within(paletteRow).getAllByRole('radio'), '配色数量 = PALETTE_IDS 长度').toHaveLength(PALETTE_IDS.length);
    expect(within(lookRow).getAllByRole('radio'), '质感数量 = LOOK_IDS 长度').toHaveLength(LOOK_IDS.length);
    expect(PALETTE_IDS.length).toBe(7);
    expect(LOOK_IDS.length).toBe(4);
    for (const name of ['像素', 'Linear 极简', '毛玻璃', '夜航仪表']) {
      expect(within(lookRow).getByText(name), `质感缺 ${name}`).toBeTruthy();
    }
    // 老板点名的两条永远不许被删（方向 B 落地后仍须在列）
    for (const keep of ['像素', 'Linear 极简']) {
      expect(within(lookRow).getByText(keep), `老板点名的 ${keep} 被删了`).toBeTruthy();
    }
  });

  it('点「毛玻璃」立即生效：根属性 data-look=glass + store + localStorage 持久化', () => {
    render(<ThemeSection />);
    clickOption('theme-look-section', 'glass');
    expect(document.documentElement.dataset.look).toBe('glass');
    expect(lookStore.getState().look).toBe('glass');
    expect(window.localStorage.getItem('septcats.look')).toBe('glass');
  });

  it('三档互斥单选：Linear → glass → pixel，根属性与 store 同步', () => {
    render(<ThemeSection />);
    clickOption('theme-look-section', 'linear');
    expect(document.documentElement.dataset.look).toBe('linear');
    clickOption('theme-look-section', 'glass');
    expect(document.documentElement.dataset.look).toBe('glass');
    clickOption('theme-look-section', 'pixel');
    expect(document.documentElement.dataset.look).toBe('pixel');
    expect(lookStore.getState().look).toBe('pixel');
  });

  it('配色同理生效（点「苔青」→ data-palette=moss + 持久化）', () => {
    render(<ThemeSection />);
    clickOption('theme-section', 'moss');
    expect(document.documentElement.dataset.palette).toBe('moss');
    expect(paletteStore.getState().palette).toBe('moss');
    expect(window.localStorage.getItem('septcats.palette')).toBe('moss');
  });

  it('浅色基底「纯黑」置灰（guard 同源）；深色基底可选并生效', () => {
    // 注：jsdom 的 fireEvent 会穿透原生 disabled（已知差异），故此处钉「guard 本身」——
    // 置灰 = 真实用户点不到；paletteState.isPaletteDisabled 是唯一真相源。
    expect(isPaletteDisabled('oled', 'light')).toBe(true);
    expect(isPaletteDisabled('oled', 'dark')).toBe(false);
    const first = render(<ThemeSection />);
    expect(optionInput('theme-section', '纯黑').disabled).toBe(true);
    first.unmount();
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeSection />);
    expect(optionInput('theme-section', '纯黑').disabled).toBe(false);
    clickOption('theme-section', 'oled');
    expect(document.documentElement.dataset.palette).toBe('oled');
    expect(paletteStore.getState().palette).toBe('oled');
  });

  it('画廊彻底取消：无入口钮、无画廊卡、无「打开画廊」文案（防回潮）', () => {
    render(<ThemeSection />);
    expect(document.querySelector('[data-testid="theme-gallery-entry"]')).toBeNull();
    expect(document.querySelector('[data-testid^="theme-gallery-card-"]')).toBeNull();
    expect(screen.queryByText('打开画廊')).toBeNull();
  });
});

describe('命令面板：画廊命令下线，切派系/切质感仍在', () => {
  it('无 theme.palette；七条 theme.switch.* 与四条 theme.look.* 齐备', () => {
    const ids = configurePaletteCommands(fullDeps(), true).map((c) => c.id);
    expect(ids).not.toContain('theme.palette');
    for (const id of ['mono', 'oled', 'contrast', 'paper', 'slate', 'moss']) {
      expect(ids, `缺 theme.switch.${id}`).toContain(`theme.switch.${id}`);
    }
    for (const id of ['pixel', 'linear', 'glass']) {
      expect(ids, `缺 theme.look.${id}`).toContain(`theme.look.${id}`);
    }
  });

  it('运行命令 → setThemePalette / setThemeLook 被调', () => {
    const setThemePalette = vi.fn();
    const setThemeLook = vi.fn();
    const cmds = configurePaletteCommands(fullDeps({ setThemePalette, setThemeLook }), true);
    cmds.find((c) => c.id === 'theme.switch.slate')?.run();
    cmds.find((c) => c.id === 'theme.look.glass')?.run();
    expect(setThemePalette).toHaveBeenCalledWith('slate');
    expect(setThemeLook).toHaveBeenCalledWith('glass');
  });
});
