/**
 * wallpaperClash —— C 轮（老板 09-29：「颜色全部不统一，字体颜色没有进行适配」）。
 *
 * 根因（其截图实证）：glass 档各面薄纱按「浅壁纸」设计——chrome 面 canvas 14%、
 * 正文 content 68%。用户壁纸是**深色**（实测暗紫 #2C2252，lum≈40）时，玻璃里透
 * 出来的平面整体变暗，而 light 主题的墨色 token 是深字 → 深字压深底，对比度
 * 掉到 ~1.5（红线 4.5）＝文字不可读、整窗「颜色不统一」。反向（dark 主题 × 浅
 * 壁纸）同病：浅字压浅底。壁纸是外部输入，主题三轴管不到它 ⇒ 必须按**壁纸与
 * 主题的亮度冲突**自适应加纱（真 Windows 亚克力同样是 tint+luminosity 混合，
 * 从不把壁纸原样全透给正文）。
 *
 * 冲突判定（单一属性 data-wallpaper-clash）：
 *   'dark'  = 浅色主题 × 暗壁纸   → 纱向 canvas 亮侧收（chrome 14→72%、正文 68→90%、浮层 60→85%）
 *   'light' = 深色主题 × 亮壁纸   → 纱向 canvas 暗侧收更多（浅字需更暗底：chrome 88%、正文 94%、浮层 90%）
 *   无冲突/采样失败/非 glass = 属性缺席 → 完全维持现状（绝不猜、绝不裸改）。
 * looks.css 消费该属性；本模块只管算与挂。
 */

/** 壁纸均色亮度阈值（BT.601 加权 0-255）：<128 判暗壁纸。实测暗紫壁纸 lum≈40、 Win 默认浅图 lum≈200，裕量充足。 */
export const WALLPAPER_LUM_MID = 128;

export function hexLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null || m[1] === undefined) {
    return 255;
  }
  const n = Number.parseInt(m[1], 16);
  return (((n >> 16) & 0xff) * 299 + ((n >> 8) & 0xff) * 587 + (n & 0xff) * 114) / 1000;
}

/** 冲突判定纯函数（导出供单测）：theme=documentElement data-theme 实测值。 */
export function computeClash(theme: string, lum: number | null): string | null {
  if (lum === null) {
    return null;
  }
  const darkWallpaper = lum < WALLPAPER_LUM_MID;
  const darkTheme = theme === 'dark';
  if (darkTheme && !darkWallpaper) {
    return 'light'; // 深主题压亮壁纸：浅字需更暗纱
  }
  if (!darkTheme && darkWallpaper) {
    return 'dark'; // 浅主题压暗壁纸：深字需更亮纱
  }
  return null;
}

/**
 * 采样壁纸均色（4×4 缩略均值 → lum）。jsdom/解码失败/3s 无回调 → null。
 * 同一 dataUrl 结果缓存（focus 重拉换了 URL 自然重算）。
 */
let lumCache: { url: string; lum: number | null } | null = null;

export function sampleWallpaperLuminance(dataUrl: string): Promise<number | null> {
  if (lumCache !== null && lumCache.url === dataUrl) {
    return Promise.resolve(lumCache.lum);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: number | null): void => {
      if (done) {
        return;
      }
      done = true;
      lumCache = { url: dataUrl, lum: v };
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
          const to2 = (v: number): string => Math.round(v / 16).toString(16).padStart(2, '0');
          finish(hexLuminance('#' + to2(r) + to2(gg) + to2(b)));
        } catch {
          finish(null);
        } finally {
          clearTimeout(timer);
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

/** 挂/撤冲突属性（导出供单测直驱）。 */
export function applyClash(clash: string | null, root: HTMLElement = document.documentElement): void {
  if (clash === null) {
    delete root.dataset.wallpaperClash;
  } else {
    root.dataset.wallpaperClash = clash;
  }
}

/**
 * 衬底/主题任一变化都重算（调用方：wallpaperUnderlay 同步链尾部 + observer 扩
 * data-theme/data-palette——canvas token 亮度随配色微变，冲突判定须跟）。
 * dataUrl=null（非 glass/无壁纸）→ 属性必撤。
 */
export async function updateWallpaperClash(dataUrl: string | null): Promise<void> {
  if (dataUrl === null) {
    applyClash(null);
    return;
  }
  const lum = await sampleWallpaperLuminance(dataUrl);
  const clash = computeClash(document.documentElement.dataset.theme ?? 'light', lum);
  // 竞态护栏：异步回来时已切离 glass（无衬底）则不挂
  if (document.documentElement.dataset.wallpaper === '1') {
    applyClash(clash);
  } else {
    applyClash(null);
  }
}
