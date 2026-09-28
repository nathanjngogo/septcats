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
import { CHROME_BACKGROUND, isWin11GlassCapable, parseTransparencyFlag, resolveChromeOverlay, resolveChromeTheme, resolveGlassMaterial } from '../src/main/windowChromeTheme';

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
  it('合法 #rrggbb 直接透传（canvas 当底、ink 当符号）', () => {
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620' }, 'light')).toEqual({
      color: '#F4EFE6',
      symbolColor: '#2B2620',
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
});

describe('T90-01 resolveGlassMaterial（真通透三条件门）', () => {
  it('三条件齐备（glass × Win11 22H2+ × 系统透明效果开）才 acrylic', () => {
    expect(resolveGlassMaterial('glass', true, true)).toBe('acrylic');
  });

  it('任一条件缺 → none（pixel/linear 档、老 Windows、系统关透明都不启用）', () => {
    expect(resolveGlassMaterial('pixel', true, true)).toBe('none');
    expect(resolveGlassMaterial('linear', true, true)).toBe('none');
    expect(resolveGlassMaterial('glass', false, true)).toBe('none');
    expect(resolveGlassMaterial('glass', true, false)).toBe('none');
    expect(resolveGlassMaterial('glass', false, false)).toBe('none');
  });

  it('Win11 门槛=build 22621（22H2）；win32 外一律 false', () => {
    expect(isWin11GlassCapable('win32', '10.0.26100')).toBe(true);
    expect(isWin11GlassCapable('win32', '10.0.22621')).toBe(true);
    expect(isWin11GlassCapable('win32', '10.0.22620')).toBe(false);
    expect(isWin11GlassCapable('win32', '10.0.19045')).toBe(false);
    expect(isWin11GlassCapable('darwin', '24.0.0')).toBe(false);
    expect(isWin11GlassCapable('win32', 'garbage')).toBe(false);
  });

  it('EnableTransparency 解析：键缺失=默认开；显式 0/1 如实；解析不了=关（宁缺毋滥）', () => {
    expect(parseTransparencyFlag(null)).toBe(true);
    expect(parseTransparencyFlag('EnableTransparency    REG_DWORD    0x1')).toBe(true);
    expect(parseTransparencyFlag('EnableTransparency    REG_DWORD    0x0')).toBe(false);
    expect(parseTransparencyFlag('EnableTransparency    REG_DWORD    1')).toBe(true);
    expect(parseTransparencyFlag('nonsense')).toBe(false);
  });
});
