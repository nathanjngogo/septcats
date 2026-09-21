/**
 * t53-gray-colors.test.ts —— TASK-T53-01 §1 色板与像素立体 token 锚定（层测）。
 *
 * 沿革：本文件取代 T34-01 的 `t34-notion-colors.test.ts`。老板 09-21「整体黑白灰」
 * 让 Notion 暖灰采样值（#F9F8F7/#2C2C2B/…）整体退役，原「Notion 采样锚定」已无
 * 锚定对象；锚定对象换成 T53-01 的灰阶板（起板 = 任务书附录 A，ink-faint 按 §2
 * 提档预案落值），并把「像素立体语法」的 token 形状一并钉死，防后续任务悄悄漂移。
 *
 *  - 浅色：canvas #F5F5F5 / surface #EDEDED / surface-active #DFDFDF / content
 *    #FFFFFF / ink #1A1A1A / ink-secondary #595959 / ink-faint #6B6B6B（提档）/
 *    icon-faint #9A9A9A / hairline #DDDDDD；accent 灰阶 #333333；语义两粒 danger
 *    #8A2B1C、success #3F6B34。
 *  - 深色：canvas #141414 / surface #1E1E1E / surface-raised #262626 / content
 *    #0A0A0A / ink #EDEDED / ink-faint #909090（提档）/ icon-faint #6E6E6E。
 *  - 像素立体：bevel-hi/bevel-lo/shadow-pixel 三色 + bevel-out/bevel-in/pixel-out/
 *    pixel-flat 四几何；offset 投影 blur 必须为 0；控件圆角一律 ≤2px。
 * 消费端（CSS）一律 var(--sc-*)，由 no-magic / css-discipline 把关。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';
import { colors, colorsDark, elevation, rounded } from '../src/tokens';

const designMd = readFileSync(resolvePkgFile('../../DESIGN.md'), 'utf8');
const tokensCss = readFileSync(resolvePkgFile('src/tokens.css'), 'utf8');

describe('T53-01 灰阶色板锚定（DESIGN.md ↔ tokens 产物）', () => {
  it('浅色：五级平面 / 文字四档 / 发丝线 全部等于灰阶裁决值', () => {
    expect(colors.canvas).toBe('#F5F5F5');
    expect(colors.surface).toBe('#EDEDED');
    expect(colors['surface-raised']).toBe('#FFFFFF');
    expect(colors.content).toBe('#FFFFFF');
    expect(colors['surface-active']).toBe('#DFDFDF');
    expect(colors.ink).toBe('#1A1A1A');
    expect(colors['ink-secondary']).toBe('#595959');
    expect(colors['ink-faint']).toBe('#6B6B6B');
    expect(colors['icon-faint']).toBe('#9A9A9A');
    expect(colors.hairline).toBe('#DDDDDD');
    expect(colors['hairline-strong']).toBe('#C4C4C4');
  });

  it('浅色：accent 已灰阶化，语义只剩 danger/success 两粒（色相未灰化）', () => {
    expect(colors.accent).toBe('#333333');
    expect(colors['accent-soft']).toBe('#E6E6E6');
    expect(colors['on-accent']).toBe('#FFFFFF');
    expect(colors['focus-ring']).toBe('#1A1A1A');
    expect(colors.danger).toBe('#8A2B1C');
    expect(colors.success).toBe('#3F6B34');
  });

  it('深色：灰阶双值落表（Notion 深色同构值整体退役）', () => {
    expect(colorsDark.canvas).toBe('#141414');
    expect(colorsDark.surface).toBe('#1E1E1E');
    expect(colorsDark['surface-raised']).toBe('#262626');
    expect(colorsDark.content).toBe('#0A0A0A');
    expect(colorsDark['surface-active']).toBe('#2A2A2A');
    expect(colorsDark.ink).toBe('#EDEDED');
    expect(colorsDark['ink-secondary']).toBe('#A8A8A8');
    expect(colorsDark['ink-faint']).toBe('#909090');
    expect(colorsDark['icon-faint']).toBe('#6E6E6E');
    expect(colorsDark.accent).toBe('#D4D4D4');
    expect(colorsDark['on-accent']).toBe('#141414');
    expect(colorsDark.danger).toBe('#F2B8AD');
    expect(colorsDark.success).toBe('#9CCB8F');
  });

  it('Notion 暖灰采样值不得在 DESIGN.md 残留（防回退到 T34 色板）', () => {
    for (const stale of ['#F9F8F7', '#F1F0EF', '#EEECEB', '#2C2C2B', '#5F5E59', '#8E8B86', '#A16207', '#D9A441']) {
      expect(designMd.toLowerCase().includes(stale.toLowerCase()), `DESIGN.md 残留旧值 ${stale}`).toBe(false);
    }
  });
});

describe('T53-01 像素立体语法 token', () => {
  it('三色（bevel-hi / bevel-lo / shadow-pixel）双主题齐备且浅深不同', () => {
    for (const name of ['bevel-hi', 'bevel-lo', 'shadow-pixel']) {
      expect(colors[name as keyof typeof colors]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(colorsDark[name as keyof typeof colorsDark]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(colorsDark[name as keyof typeof colorsDark]).not.toBe(colors[name as keyof typeof colors]);
      expect(tokensCss).toContain(`--sc-color-${name}: ${colors[name as keyof typeof colors]};`);
      expect(tokensCss).toContain(`--sc-color-${name}: ${colorsDark[name as keyof typeof colorsDark]};`);
    }
  });

  it('四几何（bevel-out / bevel-in / pixel-out / pixel-flat）落到 CSS 变量，且只引用 token', () => {
    for (const key of ['bevel-out', 'bevel-in', 'pixel-out', 'pixel-flat'] as const) {
      expect(elevation[key]).toBeTruthy();
      expect(tokensCss).toContain(`--sc-${key}: ${elevation[key]};`);
      expect(elevation[key]).toContain('var(--sc-color-');
      expect(/#[0-9a-fA-F]{3,8}/.test(elevation[key]), `${key} 含字面 hex`).toBe(false);
    }
  });

  it('offset 投影 blur 恒为 0（像素风禁模糊）且位移恰好 2px（= 按压下沉量）', () => {
    // 形如 "2px 2px 0 0 …" —— 第三段（blur）必须是 0
    for (const key of ['pixel-out', 'pixel-flat'] as const) {
      const geom = /^(-?\d+)px\s+(-?\d+)px\s+(\d+)(?:px)?\s+(\d+)(?:px)?\s/.exec(elevation[key]);
      expect(geom, `${key} 几何不匹配`).not.toBeNull();
      expect(geom![3], `${key} blur 必须为 0`).toBe('0');
      expect(Number(geom![1])).toBe(2);
      expect(Number(geom![2])).toBe(2);
    }
  });

  it('bevel-out 与 bevel-in 是同一组亮暗面的对调（按压 = 亮暗对调）', () => {
    const out = elevation['bevel-out'];
    const ins = elevation['bevel-in'];
    expect(out).toContain('inset 2px 2px 0 0 var(--sc-color-bevel-hi)');
    expect(out).toContain('inset -2px -2px 0 0 var(--sc-color-bevel-lo)');
    expect(ins).toContain('inset 2px 2px 0 0 var(--sc-color-bevel-lo)');
    expect(ins).toContain('inset -2px -2px 0 0 var(--sc-color-bevel-hi)');
  });

  it('圆角像素化：控件档 ≤2px、浮层档 ≤8px，禁大圆角胶囊化控件', () => {
    expect(rounded.xs).toBe('2px');
    expect(rounded.sm).toBe('2px');
    expect(rounded.md).toBe('4px');
    expect(rounded.lg).toBe('6px');
    expect(rounded.xl).toBe('8px');
    expect(rounded.full).toBe('999px');
  });
});

describe('T53-01 既有结构契约不被观感改动破坏', () => {
  it('顶栏与侧栏同色由同一 token 保证：AppShell.css 三规则引用不变', () => {
    const css = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');
    const topbar = /(^|\n)\.sc-shell__topbar\s*\{([^}]*)\}/.exec(css);
    const sidebar = /(^|\n)\.sc-shell__sidebar\s*\{([^}]*)\}/.exec(css);
    const main = /(^|\n)\.sc-shell__main\s*\{([^}]*)\}/.exec(css);
    expect(topbar?.[2] ?? '').toContain('background: var(--sc-color-canvas)');
    expect(sidebar?.[2] ?? '').toContain('background: var(--sc-color-canvas)');
    expect(main?.[2] ?? '').toContain('background: var(--sc-color-content)');
  });
});
