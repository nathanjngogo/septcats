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
 * T89-01：titleBarOverlay（OS 绘制的最小化/最大化/关闭按钮区）配色入参。
 * renderer 实测 `--sc-color-canvas`（底）与 `--sc-color-ink`（符号）后推给 main；
 * 这里做**合法性收窄**——overlay 只吃 `#rrggbb`，非法值（空/rgb()/带 alpha）一律
 * 回落该明暗态的画布 token 实值，绝不让 OS 按钮区吃到脏值或抛错。
 */
export interface ChromeOverlayInput {
  canvas: string;
  ink: string;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function resolveChromeOverlay(
  input: ChromeOverlayInput,
  theme: ChromeTheme,
): { color: string; symbolColor: string } {
  const fallback = CHROME_BACKGROUND[theme];
  return {
    color: HEX6.test(input.canvas) ? input.canvas : fallback,
    symbolColor: HEX6.test(input.ink) ? input.ink : (theme === 'dark' ? '#EDE6D8' : '#2B2620'),
  };
}

/**
 * T90-01（老板 09-28 深夜：「毛玻璃的通透性也没有，没有跟着背景变色」）：
 * 真通透 = DWM 亚克力材质透出**桌面壁纸**。CSS 玻璃（0.6.7）只是半透明于自家
 * canvas 底，物理上够不到桌面。材质只在三条件同时成立时启用：
 *   ① Windows 11 22H2+（Electron setBackgroundMaterial 的硬门槛，build ≥ 22621）；
 *   ② 系统「透明效果」开（HKCU Personalize EnableTransparency=1——实测 =0 时
 *      材质被 DWM 停用、窗面退化成一片死灰 #D4D4D4，老板机器当时正是 0）；
 *   ③ 应用质感档 = glass（用户显式选择）。
 * 任一不满足 → 'none'，CSS 层保持 0.6.9 的实心 canvas 风格（不透明、不变灰）。
 * 与材质配套的 CSS：glass 档在 data-osglass=1 时把 html/body/#root/.app-frame
 * 底全部透明化，否则材质被实心画布挡死 = 白挂。
 */
export type GlassMaterial = 'acrylic' | 'none';

/** Win11 22H2+ 判定（os.release() 形如 10.0.26100；门槛 = 22621）。 */
export function isWin11GlassCapable(platform: string, osRelease: string): boolean {
  if (platform !== 'win32') {
    return false;
  }
  const m = /^10\.0\.(\d+)/.exec(osRelease);
  return m !== null && Number(m[1]) >= 22621;
}

export function resolveGlassMaterial(
  look: string,
  win11Capable: boolean,
  systemTransparencyEnabled: boolean,
): GlassMaterial {
  return look === 'glass' && win11Capable && systemTransparencyEnabled ? 'acrylic' : 'none';
}

/**
 * 解析 `reg query ...Personalize /v EnableTransparency` 输出为布尔。
 * 键缺失 = Win11 默认开（返回 true）；显式 0 / 解析不了 = false（保守不启用
 * 材质——实测透明效果关时材质退化成死灰一片，比实心更难看，宁缺毋滥）。
 */
export function parseTransparencyFlag(regOutput: string | null): boolean {
  if (regOutput === null) {
    return true;
  }
  const m = /REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/.exec(regOutput);
  if (m === null || m[1] === undefined) {
    return false;
  }
  const v = m[1].startsWith('0x') ? Number.parseInt(m[1], 16) : Number(m[1]);
  return v === 1;
}
