/**
 * wallpaper-geometry.test.ts —— C 轮「实时透明」main 侧纯函数（填充模式归一 +
 * 屏幕映射数学）。坐标语义：win/display 同物理/DIP 系；offset=壁纸左上−窗口左上
 * （负值=壁纸向窗外延展，正确视差）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeWallpaperGeometry,
  normalizeWallpaperStyle,
} from '../src/main/wallpaperGeometry';

describe('C 轮 normalizeWallpaperStyle', () => {
  it('微软定义值全映射', () => {
    expect(normalizeWallpaperStyle('0')).toBe('center');
    expect(normalizeWallpaperStyle('2')).toBe('tile');
    expect(normalizeWallpaperStyle('6')).toBe('fit');
    expect(normalizeWallpaperStyle('7')).toBe('stretch');
    expect(normalizeWallpaperStyle('10')).toBe('fill');
  });

  it('缺失/野值 → fill（现代默认），绝不抛', () => {
    expect(normalizeWallpaperStyle(null)).toBe('fill');
    expect(normalizeWallpaperStyle('garbage')).toBe('fill');
    expect(normalizeWallpaperStyle('99')).toBe('fill');
  });
});

describe('C 轮 computeWallpaperGeometry', () => {
  const display = { x: 0, y: 0, width: 2560, height: 1440 };
  const image = { width: 3840, height: 2160 };

  it('fill(cover)：窗口在 (680,296) → offset=居中绘制原点−窗口原点（负偏移视差）', () => {
    // 3840×2160 cover 进 2560×1440：同比例 s=2/3 → 2560×1440 恰好铺满，offset 回 −窗口原点
    const g = computeWallpaperGeometry({ win: { x: 680, y: 296, width: 1200, height: 800 }, display, image, fill: 'fill' });
    expect(g).not.toBeNull();
    expect(g?.size).toBe('2560px 1440px');
    expect(g?.offsetX).toBe(-680);
    expect(g?.offsetY).toBe(-296);
  });

  it('move 视差：窗口右移 200 → offsetX 同步变小（壁纸相对窗左移）', () => {
    const g1 = computeWallpaperGeometry({ win: { x: 680, y: 296, width: 1200, height: 800 }, display, image, fill: 'fill' });
    const g2 = computeWallpaperGeometry({ win: { x: 880, y: 296, width: 1200, height: 800 }, display, image, fill: 'fill' });
    expect((g2?.offsetX ?? 0) - (g1?.offsetX ?? 0)).toBe(-200);
  });

  it('cover 有裁剪余量：横长图进方窗 → 居中裁剪偏移', () => {
    const g = computeWallpaperGeometry({
      win: { x: 0, y: 0, width: 1000, height: 1000 },
      display: { x: 0, y: 0, width: 2000, height: 1000 },
      image: { width: 1000, height: 1000 },
      fill: 'fill',
    });
    // cover: s=max(2000/1000, 1000/1000)=2 → 2000×2000；oy=(1000−2000)/2=−500
    expect(g?.size).toBe('2000px 2000px');
    expect(g?.offsetY).toBe(-500);
  });

  it('fit(contain)：小图居中留边', () => {
    const g = computeWallpaperGeometry({
      win: { x: 100, y: 100, width: 800, height: 600 },
      display,
      image: { width: 1280, height: 720 },
      fill: 'fit',
    });
    // contain: s=min(2,2)=2 → 2560×1440；ox=0，offset=0−100=−100
    expect(g?.size).toBe('2560px 1440px');
    expect(g?.offsetX).toBe(-100);
  });

  it('stretch：恰铺满 display；center：原尺寸居中；tile/无尺寸 → null（回退 fixed）', () => {
    const st = computeWallpaperGeometry({ win: { x: 10, y: 20, width: 500, height: 500 }, display, image, fill: 'stretch' });
    expect(st?.size).toBe('2560px 1440px');
    expect(st?.offsetX).toBe(-10);
    const ce = computeWallpaperGeometry({ win: { x: 0, y: 0, width: 500, height: 500 }, display, image, fill: 'center' });
    expect(ce?.size).toBe('3840px 2160px');
    expect(ce?.offsetX).toBe((2560 - 3840) / 2);
    expect(computeWallpaperGeometry({ win: { x: 0, y: 0, width: 500, height: 500 }, display, image, fill: 'tile' })).toBeNull();
    expect(computeWallpaperGeometry({ win: { x: 0, y: 0, width: 500, height: 500 }, display, image: null, fill: 'fill' })).toBeNull();
  });

  it('多屏负坐标 display：offset 相对 display 原点正确', () => {
    const g = computeWallpaperGeometry({
      win: { x: -1920, y: 0, width: 1000, height: 800 },
      display: { x: -1920, y: 0, width: 1920, height: 1080 },
      image: { width: 1920, height: 1080 },
      fill: 'fill',
    });
    expect(g?.offsetX).toBe(0);
    expect(g?.offsetY).toBe(0);
  });
});
