/**
 * wallpaper-tint.test.ts —— 审核 B-2 混色纯函数（jsdom：readCanvasTokenHex 走
 * getComputedStyle，测里直接 setProperty 注入）。钉死：混色公式、入参收窄、
 * 采样失败回退、变化通知去重。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  computeBandTint,
  getGlassCanvasTint,
  mixHexOver,
  onGlassTintChange,
  updateGlassTint,
  GLASS_BAND_CANVAS_RATIO,
} from '../src/renderer/src/theme/wallpaperTint';

describe('B-2 mixHexOver', () => {
  it('canvas 14% 叠纯黑壁纸均色 → ≈canvas×0.14（向下取整容差）', () => {
    const c = mixHexOver('#FFFFFF', '#000000', GLASS_BAND_CANVAS_RATIO);
    expect(c).toBe('#242424'); // 255×0.14≈36=0x24
  });

  it('canvas 100% 全保留；0% 全壁纸色', () => {
    expect(mixHexOver('#F4EFE6', '#0000FF', 1)).toBe('#F4EFE6');
    expect(mixHexOver('#F4EFE6', '#0000FF', 0)).toBe('#0000FF');
  });

  it('非法入参 → canvas 原样（大写），绝不抛', () => {
    expect(mixHexOver('#f4efe6', 'nope', 0.14)).toBe('#F4EFE6');
    expect(mixHexOver('rgb(1,2,3)', '#000000', 0.14)).toBe('RGB(1,2,3)'.slice(0, 0) + 'rgb(1,2,3)'.toUpperCase());
  });
});

describe('B-2 computeBandTint', () => {
  it('壁纸均色 null（采样失败/非 glass）→ null（main 回落实心）', () => {
    expect(computeBandTint('#F4EFE6', null)).toBeNull();
  });

  it('脏 canvas / 脏 tint → null', () => {
    expect(computeBandTint('', '#000000')).toBeNull();
    expect(computeBandTint('#F4EFE6', '#GGHHII')).toBeNull();
  });

  it('合法入参 → 大写 hex6 混色', () => {
    expect(computeBandTint('#ffffff', '#000000')).toBe('#242424');
  });
});

describe('B-2 updateGlassTint（jsdom 无 Image 解码=采样恒 null）', () => {
  it('dataUrl=null → 混色清空 + 通知监听', async () => {
    const cb = vi.fn();
    const off = onGlassTintChange(cb);
    await updateGlassTint(null);
    expect(getGlassCanvasTint()).toBeNull();
    // 值没变（本来就 null）→ 不通知（去重）
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it('glass 采样失败（jsdom Image onerror）→ 混色仍 null，不崩', async () => {
    await updateGlassTint('data:image/png;base64,AAAA'); // 非法图 → onerror → null
    expect(getGlassCanvasTint()).toBeNull();
  });
});
