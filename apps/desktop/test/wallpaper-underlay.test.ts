// @vitest-environment jsdom
/**
 * wallpaper-underlay.test.ts —— T90-01B 壁纸衬底 renderer 侧同步纯函数。
 * jsdom 直测 syncWallpaperUnderlay 的门控矩阵（glass ∧ 有壁纸才挂属性+变量；
 * 其余一律双撤——绝不裸开透明链，实心保命态）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { syncWallpaperUnderlay } from '../src/renderer/src/theme/wallpaperUnderlay';

const DATA_URL = 'data:image/jpeg;base64,AAAA';

afterEach(() => {
  const root = document.documentElement;
  delete root.dataset.wallpaper;
  root.style.removeProperty('--sc-wallpaper');
});

describe('T90-01B syncWallpaperUnderlay', () => {
  it('glass + 有壁纸 → data-wallpaper=1 且 --sc-wallpaper 挂上', () => {
    syncWallpaperUnderlay('glass', DATA_URL);
    const root = document.documentElement;
    expect(root.dataset.wallpaper).toBe('1');
    expect(root.style.getPropertyValue('--sc-wallpaper')).toContain('data:image/jpeg');
  });

  it('非 glass 档（pixel/linear）：即便有壁纸也不挂（质感是用户显式选择）', () => {
    syncWallpaperUnderlay('pixel', DATA_URL);
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
    syncWallpaperUnderlay('linear', DATA_URL);
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
  });

  it('glass 但壁纸拉不到（null/空串）→ 属性与变量双撤（实心保命态）', () => {
    syncWallpaperUnderlay('glass', DATA_URL);
    expect(document.documentElement.dataset.wallpaper).toBe('1');
    syncWallpaperUnderlay('glass', null);
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--sc-wallpaper')).toBe('');
    syncWallpaperUnderlay('glass', '');
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
  });

  it('切档回 pixel 即撤（观察者触发路径的同款同步语义）', () => {
    syncWallpaperUnderlay('glass', DATA_URL);
    syncWallpaperUnderlay('pixel', DATA_URL);
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--sc-wallpaper')).toBe('');
  });
});
