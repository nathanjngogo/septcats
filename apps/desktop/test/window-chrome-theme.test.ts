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

describe('T89-01/C 轮 resolveChromeOverlay（OS overlay 已撤，只剩窗口预绘底色收窄）', () => {
  it('合法 #rrggbb 透传为预绘底色', () => {
    expect(resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620' }, 'light')).toEqual({
      windowBackground: '#F4EFE6',
    });
  });

  it('非法 canvas（空/rgb()/带 alpha）回落该明暗态画布 token', () => {
    expect(resolveChromeOverlay({ canvas: '', ink: '#2B2620' }, 'light').windowBackground).toBe('#F5F5F5');
    expect(resolveChromeOverlay({ canvas: 'rgb(1,2,3)', ink: '#2B2620' }, 'dark').windowBackground).toBe('#141414');
    expect(resolveChromeOverlay({ canvas: '#F4EFE600', ink: '#2B2620' }, 'light').windowBackground).toBe('#F5F5F5');
  });

  it('C 轮：任何 look（含 glass）结果只有 windowBackground（无 OS 按钮面可刷）', () => {
    const r = resolveChromeOverlay({ canvas: '#F4EFE6', ink: '#2B2620', look: 'glass' }, 'light');
    expect(Object.keys(r)).toEqual(['windowBackground']);
  });
});

// T90-01B：材质三条件门（resolveGlassMaterial/isWin11GlassCapable/parseTransparencyFlag）
// 随 DWM acrylic 路线整段移除——本机实测 Electron backdrop 恒死灰，通透改走
// 壁纸衬底（纯函数回归迁到 test/desktop-wallpaper.test.ts + test/wallpaper-underlay.test.ts）。
