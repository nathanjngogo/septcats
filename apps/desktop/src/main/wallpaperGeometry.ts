/**
 * wallpaperGeometry —— C 轮「实时透明」main 侧纯计算（老板 09-29：
 * 「目前看似透明，实际假透明，要实时透明」）。
 *
 * 原理：壁纸层不再用视口 fixed（= 假透明，移动窗口壁纸不动），而是按
 * 「窗口在桌面的实时位置」反向偏移：屏幕壁纸映射 = Windows 实际填充模式
 * （注册表 WallpaperStyle：10=fill/6=fit/0=center/7=stretch…），窗口几何来自
 * BrowserWindow.getBounds()。本机（Win11 100% 缩放）实证 workArea/截图/DOM/
 * getBounds 同一物理坐标系 → 三组数直发 renderer 即可零换算。缩放≠100% 的机器
 * Electron 全链（含截图合成）同倍 DIP，映射比例仍成立。
 *
 * 纯函数零 electron 依赖：probeWallpaperImageSize(字节头) 与 computeWallpaperGeometry
 * 供单测直测；接线在 main/index.ts（move/resize 节流广播），验收走探针 P 组。
 */

export type WallpaperFillMode = 'fill' | 'fit' | 'stretch' | 'center' | 'tile';

/** 注册表 WallpaperStyle DWORD → 归一化填充模式（未知值回 fill=现代默认）。 */
export function normalizeWallpaperStyle(style: string | null): WallpaperFillMode {
  const n = style === null ? NaN : Number(style);
  switch (n) {
    case 0:
      return 'center';
    case 1:
    case 7:
      return 'stretch';
    case 2:
      return 'tile';
    case 6:
      return 'fit';
    case 10:
      return 'fill';
    default:
      // 4/5=span/fit（厂商扩展）、野值、缺失：现代 Win11 面板默认 fill
      return 'fill';
  }
}

export interface WallpaperGeometryInput {
  /** 窗口 getBounds()（物理/DIP，与 workArea 同系）。 */
  win: { x: number; y: number; width: number; height: number };
  /** 所在显示器 workArea 之外 bounds 之外——壁纸铺满整个显示器 bounds（不含任务栏区也画）。 */
  display: { x: number; y: number; width: number; height: number };
  /** 壁纸图像像素尺寸（探测失败=null）。 */
  image: { width: number; height: number } | null;
  fill: WallpaperFillMode;
}

/** renderer 消费形态：bg-size 字符串 + bg-position 偏移（相对窗口自身）。 */
export interface WallpaperGeometry {
  size: string;
  /** 壁纸层左上角相对窗口内容区的物理偏移（负值=壁纸铺出窗外，正确视差）。 */
  offsetX: number;
  offsetY: number;
}

/** cover/contain 单轴缩放：fill→cover(max)、fit→contain(min)。 */
function scaleFor(mode: 'cover' | 'contain', dw: number, dh: number, iw: number, ih: number): number {
  const sx = dw / iw;
  const sy = dh / ih;
  return mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
}

export function computeWallpaperGeometry(input: WallpaperGeometryInput): WallpaperGeometry | null {
  const { win, display, fill } = input;
  const dw = display.width;
  const dh = display.height;
  if (dw <= 0 || dh <= 0) {
    return null;
  }
  if (fill === 'stretch') {
    // 拉伸=壁纸恰铺满显示器，无缩放余量
    return { size: `${Math.round(dw)}px ${Math.round(dh)}px`, offsetX: display.x - win.x, offsetY: display.y - win.y };
  }
  if (fill === 'center') {
    const cx = display.x + (dw - (input.image?.width ?? 0)) / 2;
    const cy = display.y + (dh - (input.image?.height ?? 0)) / 2;
    const size = input.image === null ? `${dw}px ${dh}px` : `${input.image.width}px ${input.image.height}px`;
    return { size, offsetX: cx - win.x, offsetY: cy - win.y };
  }
  if (fill === 'tile' || input.image === null) {
    return null; // 平铺/尺寸未知：实时映射不可算 → renderer 保持视口 fixed 回退
  }
  const iw = input.image.width;
  const ih = input.image.height;
  const s = scaleFor(fill === 'fit' ? 'contain' : 'cover', dw, dh, iw, ih);
  const rw = iw * s;
  const rh = ih * s;
  // cover/contain 居中：绘制原点 = display 中心 − 缩放图半幅
  const ox = display.x + (dw - rw) / 2;
  const oy = display.y + (dh - rh) / 2;
  return { size: `${Math.round(rw)}px ${Math.round(rh)}px`, offsetX: Math.round(ox - win.x), offsetY: Math.round(oy - win.y) };
}


