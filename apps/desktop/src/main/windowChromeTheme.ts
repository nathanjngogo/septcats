/**
 * main/windowChromeTheme.ts —— 应用主题 → 窗口原生区域（OS 标题栏/原生菜单底色/窗口预绘背景）
 * 的映射纯函数（TASK-T87-01，老板 09-28 截图圈定：「我需要连图片中的部分一并改变主题」）。
 *
 * 背景：设置→外观的「主题（明暗）」此前只管 renderer（data-theme + CSS token），
 * Windows 原生标题栏、原生菜单栏（文件/编辑/视图/帮助）和窗口预绘底色纹丝不动 →
 * 深色配色下顶着一带浅灰原生条，观感割裂。
 *
 * 口径：`nativeTheme.themeSource` 驱动 OS 标题栏与 Electron 原生菜单深浅色；
 * BrowserWindow.backgroundColor 取该档**画布 token** 实值（与 tokens.css 逐字对齐）——
 * 只碰明暗两态，不碰 palette/look（配色派系与质感是 renderer 层的 CSS 概念，
 * 原生条无玻璃/网格可言，强行联动只会做出假效果）。
 *
 * 色值与 packages/ui/src/tokens.css 同源：light canvas=#F5F5F5 / dark canvas=#141414。
 * 纯 Node 零 electron 依赖 → 供 test/window-chrome-theme.test.ts 直测（接线在 main/index.ts）。
 */

import type { ThemeMode } from '../shared/settings';

export type ChromeTheme = 'light' | 'dark';

/** 明暗两态的窗口预绘底色（= canvas token；避免深色启动时白闪一帧）。 */
export const CHROME_BACKGROUND: Record<ChromeTheme, string> = {
  light: '#F5F5F5',
  dark: '#141414',
};

/**
 * 解析设置里的 theme 为窗口 chrome 该用的明暗态。
 * `system` 跟随 OS（Electron 会把 nativeTheme.themeSource='system' 自动同步 shouldUseDarkColors）；
 * 非法值（如 'neon'，理论上 schema 已拦）回落 light——窗口 chrome 观感错比抛错炸启动好。
 */
export function resolveChromeTheme(mode: ThemeMode | string, systemDark: boolean): ChromeTheme {
  if (mode === 'dark') {
    return 'dark';
  }
  if (mode === 'light') {
    return 'light';
  }
  // 只有字面量 'system' 才跟随 OS；其余未知值回落 light（保守白底，观感错不炸启动）
  if (mode === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * T89-01：renderer 实测 token → main 刷「窗口预绘底色」（OS titleBarOverlay 已在
 * C 轮整撤——OS 平面色块永远追不上渐变玻璃带，右上角补丁的根因；min/max/close
 * 改 renderer 自绘）。这里做**合法性收窄**：canvas 非法值（空/rgb()/带 alpha）
 * 回落该明暗态画布 token，绝不让窗口吃到脏底色或抛错。
 * ink 字段保留在入参里（renderer 一并实测，供探针断言与未来 OS 面复用），
 * 本函数不消费。
 */
export interface ChromeOverlayInput {
  canvas: string;
  ink: string;
  /** 质感档（documentElement[data-look]，缺席=pixel）。overlay 撤除后暂只作日志维度。 */
  look?: string;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface ChromeOverlayResult {
  /** 窗口预绘底色永远实心（壁纸衬底在 DOM 层，窗体不能透明——alpha 底黑窗教训）。 */
  windowBackground: string;
}

export function resolveChromeOverlay(
  input: ChromeOverlayInput,
  theme: ChromeTheme,
): ChromeOverlayResult {
  const fallback = CHROME_BACKGROUND[theme];
  return { windowBackground: HEX6.test(input.canvas) ? input.canvas : fallback };
}

/**
 * T90-01B：原 DWM acrylic 材质三条件判定（isWin11GlassCapable/resolveGlassMaterial/
 * parseTransparencyFlag）已整段删除——本机实测 Electron backdrop 恒死灰（任务栏材质
 * 正常而窗区灰；acrylic/mica × 37/38 × transparent 真假全验过；详见 main/desktopWallpaper.ts
 * 头注），通透改走「壁纸衬底层」：main 只读壁纸文件（desktopWallpaper.ts），
 * renderer 自铺底，CSS 玻璃面板模糊的就是真壁纸像素。
 */
