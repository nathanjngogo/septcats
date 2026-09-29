/**
 * 审核 B-2 的解（09-29 真机证伪后定稿）：OS titleBarOverlay 实测**不吃全透明**
 * （给它 #00000000 → Win11 回退画实心 #F5F5F5，比 14% 半透带体亮 209——老板截图
 * 「白色部分」就是这个补丁）。唯一稳路=把按钮区涂成「带体等效实色」：
 * renderer 采样壁纸均色 W，按玻璃带公式 C = canvas×14% + W×86% 混出实色推给 main。
 * OS 拿到的是确定性 hex 色，不赌任何透明/材质能力。采样失败 → null → 实心 canvas
 * （= 审核前行为，绝不带脏值刷 OS）。
 */

/** glass 档带体 canvas 混色比例（looks.css: canvas 14% + 壁纸衬底 86%）。 */
export const GLASS_BAND_CANVAS_RATIO = 0.14;

function parseHex6(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null || m[1] === undefined) {
    return null;
  }
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** 混色：canvas×ratio + under×(1-ratio)，输出 #RRGGBB 大写。入参非法 → canvas 原样。 */
export function mixHexOver(canvasHex: string, underHex: string, canvasRatio: number): string {
  const ch = parseHex6(canvasHex);
  const uh = parseHex6(underHex);
  if (ch === null || uh === null) {
    return canvasHex.toUpperCase();
  }
  const t = Math.max(0, Math.min(1, canvasRatio));
  const mixed: number[] = [];
  for (let i = 0; i < 3; i++) {
    const top = ch[i] ?? 0;
    const bottom = uh[i] ?? 0;
    mixed.push(Math.round(top * t + bottom * (1 - t)));
  }
  return '#' + mixed.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** 实测画布 token（computed 可能给 rgb()，归一为 #rrggbb；拿不到 → ''）。 */
export function readCanvasTokenHex(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sc-color-canvas').trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (hex !== null && hex[1] !== undefined) {
    return `#${hex[1].toUpperCase()}`;
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
  if (rgb !== null && rgb[1] !== undefined && rgb[2] !== undefined && rgb[3] !== undefined) {
    const to2 = (v: string): string => Number(v).toString(16).padStart(2, '0').toUpperCase();
    return `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`;
  }
  return '';
}

/** 纯计算：canvas token 叠壁纸均色 → OS 按钮区等效实色；任一入参脏 → null。 */
export function computeBandTint(canvasHex: string, wallpaperTint: string | null): string | null {
  if (wallpaperTint === null) {
    return null;
  }
  if (parseHex6(canvasHex) === null || parseHex6(wallpaperTint) === null) {
    return null;
  }
  return mixHexOver(canvasHex, wallpaperTint, GLASS_BAND_CANVAS_RATIO);
}

/**
 * 采样壁纸 data URL 均色（4×4 缩略均值）。环境不支持解码（jsdom）/解码失败/
 * 回调不触发（3s 兜底超时——也防真机图像加载卡死把混色链挂起）→ null。
 */
export function sampleWallpaperTint(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null): void => {
      if (done) {
        return;
      }
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 3000);
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 4;
          canvas.height = 4;
          const g = canvas.getContext('2d');
          if (g === null) {
            clearTimeout(timer);
            finish(null);
            return;
          }
          g.drawImage(img, 0, 0, 4, 4);
          const d = g.getImageData(0, 0, 4, 4).data;
          let r = 0, gg = 0, b = 0;
          for (let i = 0; i < 16; i++) {
            r += d[i * 4] ?? 0;
            gg += d[i * 4 + 1] ?? 0;
            b += d[i * 4 + 2] ?? 0;
          }
          const to2 = (v: number): string => Math.round(v / 16).toString(16).padStart(2, '0').toUpperCase();
          clearTimeout(timer);
          finish('#' + to2(r) + to2(gg) + to2(b));
        } catch {
          clearTimeout(timer);
          finish(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = dataUrl;
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

let glassTint: string | null = null;

export function getGlassCanvasTint(): string | null {
  return glassTint;
}

type TintListener = () => void;
const listeners = new Set<TintListener>();

/** 订阅混色变化（TitleBarBand 收到即重推 OS）。 */
export function onGlassTintChange(cb: TintListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 重算混色并通知（自读 canvas token，调用方只给壁纸 dataUrl；采样异步→比对→
 * 变化才通知，防 OS 刷屏）。dataUrl=null（非 glass/无壁纸/采样失败）→ 清混色
 * （main 回落实心 canvas 行为）。
 */
export async function updateGlassTint(dataUrl: string | null): Promise<void> {
  const tint = dataUrl === null ? null : await sampleWallpaperTint(dataUrl);
  const next = computeBandTint(readCanvasTokenHex(), tint);
  if (next !== glassTint) {
    glassTint = next;
    for (const cb of listeners) cb();
  }
}
