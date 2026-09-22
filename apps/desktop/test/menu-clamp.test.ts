/**
 * menu-clamp.test.ts —— 行菜单视口 clamp 纯函数（T64-01 Phase A）。
 *
 * 给盒宽/视口宽出坐标：四边留 8px 余量；右/下缘溢出压回、左/上缘不够拉到 margin。
 */
import { describe, expect, it } from 'vitest';
import { clampMenuRect } from '../src/renderer/src/pages/menuClamp';

describe('clampMenuRect（T64-01 Phase A）', () => {
  it('锚点在视口内且盒不溢出 → 原样返回', () => {
    const r = clampMenuRect({ width: 200, height: 100, anchorX: 100, anchorY: 100, viewportWidth: 1200, viewportHeight: 800 });
    expect(r).toEqual({ x: 100, y: 100 });
  });

  it('右缘溢出 → x 压回到 viewportWidth - width - margin', () => {
    const r = clampMenuRect({ width: 210, height: 100, anchorX: 1100, anchorY: 100, viewportWidth: 1200, viewportHeight: 800 });
    // maxX = 1200 - 210 - 8 = 982
    expect(r.x).toBe(982);
    expect(r.y).toBe(100);
  });

  it('下缘溢出 → y 压回到 viewportHeight - height - margin', () => {
    const r = clampMenuRect({ width: 200, height: 300, anchorX: 100, anchorY: 760, viewportWidth: 1200, viewportHeight: 800 });
    // maxY = 800 - 300 - 8 = 492
    expect(r.y).toBe(492);
    expect(r.x).toBe(100);
  });

  it('左缘为负 → 拉到 margin', () => {
    const r = clampMenuRect({ width: 200, height: 100, anchorX: -50, anchorY: 100, viewportWidth: 1200, viewportHeight: 800 });
    expect(r.x).toBe(8);
  });

  it('上缘为负 → 拉到 margin', () => {
    const r = clampMenuRect({ width: 200, height: 100, anchorY: -5, anchorX: 100, viewportWidth: 1200, viewportHeight: 800, margin: 8 });
    expect(r.y).toBe(8);
  });

  it('视口比盒还小 → 收敛到 margin（不出现负值/不溢出）', () => {
    const r = clampMenuRect({ width: 400, height: 300, anchorX: 0, anchorY: 0, viewportWidth: 100, viewportHeight: 100 });
    // maxX = max(8, 100-400-8) = max(8, -308) = 8；anchorX=0 → clamp 到 8
    expect(r.x).toBe(8);
    expect(r.y).toBe(8);
  });

  it('自定义 margin 生效', () => {
    const r = clampMenuRect({ width: 200, height: 100, anchorX: 1100, anchorY: 100, viewportWidth: 1200, viewportHeight: 800, margin: 16 });
    // maxX = 1200 - 200 - 16 = 984
    expect(r.x).toBe(984);
  });
});
