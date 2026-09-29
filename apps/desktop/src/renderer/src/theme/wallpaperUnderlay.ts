/**
 * wallpaperUnderlay —— T90-01B：玻璃档「桌面壁纸衬底」renderer 侧驱动。
 *
 * 背景（老板 09-28 深夜连打回：「毛玻璃的通透性也没有，没有跟着背景变色」）：
 * 他要的通透 = 玻璃面板透出**桌面壁纸**。DWM acrylic 在本机实测不可达（Electron
 * 窗 backdrop 恒死灰，见 main/desktopWallpaper.ts 头注）→ 换纯渲染器路线：
 * main 只读壁纸文件，这里拉过来铺在 html 背景上（背景随视口铺满 = 背景传播），
 * glass 档的透明链（looks.css [data-look='glass'][data-wallpaper='1']）把各层
 * 实心 canvas 底撤掉，面板的半透明 + backdrop-filter 模糊的就是真壁纸像素。
 *
 * 门控（绝不裸开透明）：
 *   - 只在 look === 'glass' 且壁纸 data URL 拉到时挂 data-wallpaper=1；
 *   - 拉不到/非 glass → 属性与 CSS 变量撤除，全站保持实心（0.6.9 现行为）。
 * 隐私：壁纸只驻内存，不写盘、不日志、不出网。
 */

import { useEffect } from 'react';
import type { WallpaperGeometryPayload } from '../../../shared/ipc';
import { updateWallpaperClash } from './wallpaperClash';

/** 质感真相在 documentElement[data-look]（lookState 唯一挂点）。 */
function currentLook(): string {
  return document.documentElement.dataset.look ?? 'pixel';
}

/**
 * 拉一次壁纸并缓存（同会话壁纸不变；null 也缓存，避免反复重试 reg/IO）。
 * 失效钩子=窗口 focus：换壁纸必然去了资源管理器/设置（应用失焦），回到应用
 * 即重拉（老板验收动作「换张壁纸看看」不会被打回；本地 IPC 代价可忽）。
 */
let wallpaperCache: Promise<string | null> | null = null;

export function getWallpaperDataUrl(): Promise<string | null> {
  if (wallpaperCache === null) {
    wallpaperCache = window.septcats.theme
      .wallpaper()
      .catch(() => null);
  }
  return wallpaperCache;
}

/** 测试与 focus 共用：清缓存（下次读重拉）。 */
export function invalidateWallpaperCache(): void {
  wallpaperCache = null;
}

/**
 * 核心同步：glass ∧ 有壁纸 → 挂属性 + CSS 变量；否则双撤。
 * 导出供测试直驱（不依赖 React 生命周期）。
 */
export function syncWallpaperUnderlay(
  look: string,
  dataUrl: string | null,
  root: HTMLElement = document.documentElement,
): void {
  if (look === 'glass' && dataUrl !== null && dataUrl !== '') {
    root.style.setProperty('--sc-wallpaper', `url("${dataUrl}")`);
    root.dataset.wallpaper = '1';
  } else {
    delete root.dataset.wallpaper;
    root.style.removeProperty('--sc-wallpaper');
    clearWallpaperGeometryVars(root);
  }
}

/**
 * C 轮「实时透明」：把 main 广播的屏幕映射写成 CSS 变量——looks.css 衬底规则
 * 用「size + 偏移定位」取代 `fixed` 视口锚定（fixed=假透明元凶：窗口在桌面上
 * 移动，玻璃里的壁纸却一动不动）。geo=null（非 win32/平铺/算不了）→ 清变量，
 * CSS 回退原 fixed 行为（保底不崩）。
 */
export function applyWallpaperGeometry(
  geo: WallpaperGeometryPayload | null,
  root: HTMLElement = document.documentElement,
): void {
  if (geo === null) {
    clearWallpaperGeometryVars(root);
    return;
  }
  root.style.setProperty('--sc-wallpaper-size', geo.size);
  root.style.setProperty('--sc-wallpaper-x', `${geo.offsetX}px`);
  root.style.setProperty('--sc-wallpaper-y', `${geo.offsetY}px`);
  root.dataset.wallpaperGeom = '1';
}

function clearWallpaperGeometryVars(root: HTMLElement): void {
  delete root.dataset.wallpaperGeom;
  root.style.removeProperty('--sc-wallpaper-size');
  root.style.removeProperty('--sc-wallpaper-x');
  root.style.removeProperty('--sc-wallpaper-y');
}

export function useWallpaperUnderlay(): void {
  useEffect(() => {
    const apply = (force = false): void => {
      const look = currentLook();
      if (look !== 'glass') {
        syncWallpaperUnderlay(look, null);
        void updateWallpaperClash(null);
        return;
      }
      if (force) {
        invalidateWallpaperCache();
      }
      void getWallpaperDataUrl().then((dataUrl) => {
        // 竞态护栏：异步回来时档位可能已切走
        if (currentLook() === 'glass') {
          syncWallpaperUnderlay('glass', dataUrl);
          // C 轮：衬底挂上→按壁纸亮度×主题冲突自适应加纱（治「字体没适配」）
          void updateWallpaperClash(dataUrl);
        }
      });
    };
    apply();
    const observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, {
      attributes: true,
      // theme/palette 也在列：主题亮度与 canvas token 随两轴变 → C 轮冲突判定要跟重算
      attributeFilter: ['data-look', 'data-palette', 'data-theme'],
    });
    // focus 重拉：换壁纸的必经路径 = 离开应用（失焦）→ 回应用即 focus，此时清缓存
    // 重读 reg/文件，衬底跟着刷新（不监听系统壁纸事件——跨平台碎+高成本）。
    const onFocus = (): void => apply(true);
    window.addEventListener('focus', onFocus);
    // C 轮「实时透明」：main 在窗口 move/resize/首帧广播屏幕映射 → 写成 CSS 变量。
    // 非 glass 档收到也无害：衬底规则本身被 [data-look=glass][data-wallpaper=1] 门控。
    // 桥防御：无 preload 环境（jsdom 假桥/测试页）优雅降级为 fixed 视口衬底。
    const offGeo = window.septcats.theme?.onGeometry?.((geo) => {
      applyWallpaperGeometry(geo);
    });
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', onFocus);
      offGeo?.();
    };
  }, []);
}
