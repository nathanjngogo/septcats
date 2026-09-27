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
