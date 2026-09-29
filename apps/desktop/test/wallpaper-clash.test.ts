/**
 * wallpaper-clash.test.ts —— C 轮冲突判定纯函数 + 属性挂载（jsdom）。
 * 钉死：暗壁纸×浅主题='dark'、亮壁纸×深主题='light'、同调=null、采样失败=null、
 * 衬底未挂时绝不挂属性。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyClash,
  computeClash,
  hexLuminance,
  WALLPAPER_LUM_MID,
  WALLPAPER_CHROMA_HIGH,
} from '../src/renderer/src/theme/wallpaperClash';

describe('C 轮 computeClash（壁纸亮度 × 主题亮度冲突矩阵）', () => {
  it('浅主题 × 暗壁纸 → dark（深字需更亮纱）', () => {
    expect(computeClash('light', 61)).toBe('dark');
  });

  it('深主题 × 亮壁纸 → light（浅字需更暗纱）', () => {
    expect(computeClash('dark', 200)).toBe('light');
  });

  it('同调（浅×亮 / 深×暗）与采样失败（null）→ null 零变化', () => {
    expect(computeClash('light', 200)).toBeNull();
    expect(computeClash('dark', 61)).toBeNull();
    expect(computeClash('light', null)).toBeNull();
    expect(computeClash('dark', null)).toBeNull();
  });

  it('阈值边界：MID 以下算暗', () => {
    expect(computeClash('light', WALLPAPER_LUM_MID - 1)).toBe('dark');
    expect(computeClash('light', WALLPAPER_LUM_MID)).toBeNull();
  });
});

describe('UI 评估 P1②/④ computeClash（彩度维 · vibrancy）', () => {
  it('亮度同侧但彩度高 → chroma 纱（浅主题 × 亮彩壁纸 / 深主题 × 暗彩壁纸都命中）', () => {
    expect(computeClash('light', 200, WALLPAPER_CHROMA_HIGH)).toBe('chroma');
    expect(computeClash('light', 200, 255)).toBe('chroma');
    expect(computeClash('dark', 61, WALLPAPER_CHROMA_HIGH + 10)).toBe('chroma');
  });

  it('彩度不足 → 依旧 null（不猜、不加纱）', () => {
    expect(computeClash('light', 200, WALLPAPER_CHROMA_HIGH - 1)).toBeNull();
    expect(computeClash('dark', 61, 0)).toBeNull();
  });

  it('优先级：亮度冲突 > 彩度冲突（老板暗紫壁纸 lum≈40 仍走 dark，观感不回归）', () => {
    expect(computeClash('light', 40, 255)).toBe('dark');
    expect(computeClash('dark', 240, 255)).toBe('light');
  });

  it('缺省第三参不改变旧行为（旧两参调用兼容）', () => {
    expect(computeClash('light', 200)).toBeNull();
    expect(computeClash('light', 40)).toBe('dark');
  });
});

describe('C 轮 hexLuminance', () => {
  it('黑=0 / 白=255 / 非法=255（宁可不判暗）', () => {
    expect(hexLuminance('#000000')).toBe(0);
    expect(hexLuminance('#FFFFFF')).toBe(255);
    expect(hexLuminance('nope')).toBe(255);
  });
});

describe('C 轮 applyClash（属性挂载面）', () => {
  afterEach(() => {
    delete document.documentElement.dataset.wallpaperClash;
  });

  it('dark/light 挂属性；null 撤属性', () => {
    applyClash('dark');
    expect(document.documentElement.dataset.wallpaperClash).toBe('dark');
    applyClash('light');
    expect(document.documentElement.dataset.wallpaperClash).toBe('light');
    applyClash('chroma');
    expect(document.documentElement.dataset.wallpaperClash).toBe('chroma');
    applyClash(null);
    expect(document.documentElement.dataset.wallpaperClash).toBeUndefined();
  });
});
