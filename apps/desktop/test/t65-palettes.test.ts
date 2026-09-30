// @vitest-environment jsdom
/**
 * t65-palettes.test.ts —— 配色派系状态（paletteState.ts）单测（TASK-T65-01 §测试）。
 *
 * 覆盖：持久化 roundtrip / 野值回退 mono / oled×light 回退 / 应用器写根属性 /
 * setPalette 即时应用（store+持久化+根属性，明暗切换不丢）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPaletteToRoot,
  effectivePalette,
  isPaletteDisabled,
  isPaletteId,
  paletteActions,
  paletteStore,
  DEFAULT_PALETTE,
  readPalette,
} from '../src/renderer/src/theme/paletteState';

describe('paletteState · 持久化与回退', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    paletteStore.setState(() => ({ palette: 'mono' }));
  });

  it('readPalette 缺失 → 新默认 instrument（老板 10-01 选定方向 B）', () => {
    expect(readPalette()).toBe(DEFAULT_PALETTE);
    expect(DEFAULT_PALETTE).toBe('instrument');
  });

  it('readPalette 野值 → 新默认 instrument', () => {
    window.localStorage.setItem('septcats.palette', 'banana');
    expect(readPalette()).toBe(DEFAULT_PALETTE);
  });

  it('readPalette 合法值 roundtrip', () => {
    window.localStorage.setItem('septcats.palette', 'moss');
    expect(readPalette()).toBe('moss');
  });

  it('isPaletteId 兜底', () => {
    expect(isPaletteId('paper')).toBe(true);
    expect(isPaletteId('nope')).toBe(false);
    expect(isPaletteId(1)).toBe(false);
    expect(isPaletteId(null)).toBe(false);
  });

  it('applyPaletteToRoot 写 documentElement.dataset.palette', () => {
    applyPaletteToRoot('slate');
    expect(document.documentElement.dataset.palette).toBe('slate');
  });
});

describe('paletteState · oled 明暗回退', () => {
  it('effectivePalette：oled + light → mono（按 mono 渲染）', () => {
    expect(effectivePalette('oled', 'light')).toBe('mono');
  });

  it('effectivePalette：oled + dark → oled', () => {
    expect(effectivePalette('oled', 'dark')).toBe('oled');
  });

  it('effectivePalette：其他派系不受明暗影响', () => {
    expect(effectivePalette('paper', 'light')).toBe('paper');
    expect(effectivePalette('moss', 'dark')).toBe('moss');
  });

  it('isPaletteDisabled：oled 仅深色可用', () => {
    expect(isPaletteDisabled('oled', 'light')).toBe(true);
    expect(isPaletteDisabled('oled', 'dark')).toBe(false);
    expect(isPaletteDisabled('paper', 'light')).toBe(false);
    expect(isPaletteDisabled('moss', 'dark')).toBe(false);
  });
});

describe('paletteState · 应用器 setPalette', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    paletteStore.setState(() => ({ palette: DEFAULT_PALETTE }));
  });

  it('setPalette 即时应用：store + 持久化 + 根属性', () => {
    paletteActions.setPalette('moss');
    expect(paletteStore.getState().palette).toBe('moss');
    expect(window.localStorage.getItem('septcats.palette')).toBe('moss');
    expect(document.documentElement.dataset.palette).toBe('moss');
  });

  it('setPalette 野值静默拒（store/属性不变）', () => {
    // @ts-expect-error 运行时野值（测试用）
    paletteActions.setPalette('bogus');
    expect(paletteStore.getState().palette).toBe(DEFAULT_PALETTE);
    expect(document.documentElement.dataset.palette).toBeUndefined();
  });
});

describe('paletteState · init 挂载对账', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
    paletteStore.setState(() => ({ palette: 'mono' }));
  });

  it('首次运行本版本：落新默认一次（并盖章）；旧存储的 mono 被升级为新默认', () => {
    window.localStorage.setItem('septcats.palette', 'mono');
    expect(readPalette()).toBe('instrument');
    expect(window.localStorage.getItem('septcats.palette')).toBe('instrument');
    expect(window.localStorage.getItem('septcats.appearance.v2')).toBe('1');
  });

  it('盖章之后：一律尊重用户显式选择（mono 不会被再次改写）', () => {
    window.localStorage.setItem('septcats.appearance.v2', '1');
    window.localStorage.setItem('septcats.palette', 'mono');
    expect(readPalette()).toBe('mono');
  });

  it('init 读存储挂根属性（合法值）', () => {
    window.localStorage.setItem('septcats.palette', 'contrast');
    paletteActions.init();
    expect(paletteStore.getState().palette).toBe('contrast');
    expect(document.documentElement.dataset.palette).toBe('contrast');
  });

  it('init 读存储挂根属性（野值回退新默认 instrument）', () => {
    window.localStorage.setItem('septcats.palette', '???');
    paletteActions.init();
    expect(paletteStore.getState().palette).toBe(DEFAULT_PALETTE);
    expect(document.documentElement.dataset.palette).toBe(DEFAULT_PALETTE);
  });
});
