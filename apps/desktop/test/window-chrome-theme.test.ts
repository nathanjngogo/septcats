/**
 * window-chrome-theme.test.ts —— T87-01 映射纯函数（老板 09-28：原生标题栏/菜单带随主题变）。
 *
 * 纯 Node 直测 resolveChromeTheme + CHROME_BACKGROUND（不 import electron；
 * main/index.ts 的接线由真机探针 cdp-e2e-t87-01.mjs 覆盖）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_BACKGROUND, resolveChromeOverlay, resolveChromeTheme } from '../src/main/windowChromeTheme';

// 读仓内文件锚 import.meta.dirname（CI/聚合跑 cwd 不固定，pitfalls 口径）
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('T87-01 resolveChromeTheme', () => {
  it('显式 light/dark 覆盖 system 态', () => {
    expect(resolveChromeTheme('light', true)).toBe('light');
    expect(resolveChromeTheme('dark', false)).toBe('dark');
  });

  it('system 跟随 OS：systemDark true→dark / false→light', () => {
    expect(resolveChromeTheme('system', true)).toBe('dark');
    expect(resolveChromeTheme('system', false)).toBe('light');
  });

  it('非法值回落 light（观感错不炸启动；schema 是第一道门）', () => {
    expect(resolveChromeTheme('neon', false)).toBe('light');
    expect(resolveChromeTheme('neon', true)).toBe('light');
  });
});

describe('T87-01 背景色与 tokens.css 同源', () => {
  it('light canvas=#F5F5F5 / dark canvas=#141414', () => {
    expect(CHROME_BACKGROUND.light).toBe('#F5F5F5');
    expect(CHROME_BACKGROUND.dark).toBe('#141414');
  });

  it('tokens.css 的 canvas 值未漂移（漂移=两源失联，本测试即红）', () => {
    const css = readFileSync(join(REPO, 'packages/ui/src/tokens.css'), 'utf8');
    expect(css).toContain('--sc-color-canvas: #F5F5F5;');
    expect(css).toContain('--sc-color-canvas: #141414;');
    // 大写十六进制逐字对齐（#f5f5f5 也算漂移——两边必须一致才能被本测试钉住）
    for (const hex of Object.values(CHROME_BACKGROUND)) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('T89-01 resolveChromeOverlay', () => {
  it('合法 #rrggbb 直接透传（canvas 当底、ink 当符号；非 glass 预绘=按钮区同色）', () => {
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620' }, 'light')).toEqual({
      color: '#F4EFE6',
      symbolColor: '#2B2620',
      windowBackground: '#F4EFE6',
    });
  });

  it('非法 canvas（空/rgb()/带 alpha）回落该明暗态画布 token', () => {
    expect(resolveChromeOverlay({ canvas: '', ink: '#2B2620' }, 'light').color).toBe('#F5F5F5');
    expect(resolveChromeOverlay({ canvas: 'rgb(1,2,3)', ink: '#2B2620' }, 'dark').color).toBe('#141414');
    expect(resolveChromeOverlay({ canvas: '#F4EFE600', ink: '#2B2620' }, 'light').color).toBe('#F5F5F5');
  });

  it('非法 ink 回落明暗态默认符号色（深底用亮字、浅底用暗字）', () => {
    expect(resolveChromeOverlay({ canvas: '#141414', ink: 'nope' }, 'dark').symbolColor).toBe('#EDE6D8');
    expect(resolveChromeOverlay({ canvas: '#F5F5F5', ink: 'nope' }, 'light').symbolColor).toBe('#2B2620');
  });

  // 审核 B-2（09-29 发版前）：glass 档带体=canvas 14% 叠壁纸衬底，OS 按钮区吃实心
  // canvas 会在右上角出补丁 → glass 时按钮区底色全透明（OS overlay 实证吃 alpha，
  // combo G）透出底下带体；预绘底色恒实心（窗体绝不留 alpha 底——黑窗教训）。
  it('B-2 glass：按钮区全透明 + 符号色用 ink + 预绘底色恒实心', () => {
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620', look: 'glass' }, 'light')).toEqual({
      color: '#00000000',
      symbolColor: '#2B2620',
      windowBackground: '#F4EFE6',
    });
  });

  it('B-2 非 glass 档不吃透明（pixel/linear 维持实心 canvas 按钮区）', () => {
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620', look: 'pixel' }, 'light').color).toBe('#F4EFE6');
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620', look: 'linear' }, 'light').color).toBe('#F4EFE6');
  });

  it('B-2 glass 但 canvas 非法：预绘回明暗 token、按钮区仍透明（带体总有底色）', () => {
    const r = resolveChromeOverlay({ canvas: '', ink: '#2B2620', look: 'glass' }, 'dark');
    expect(r.color).toBe('#00000000');
    expect(r.windowBackground).toBe('#141414');
  });
});

// T90-01B：材质三条件门（resolveGlassMaterial/isWin11GlassCapable/parseTransparencyFlag）
// 随 DWM acrylic 路线整段移除——本机实测 Electron backdrop 恒死灰，通透改走
// 壁纸衬底（纯函数回归迁到 test/desktop-wallpaper.test.ts + test/wallpaper-underlay.test.ts）。
