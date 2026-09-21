/**
 * tray.ts —— 系统托盘（TASK-T54-01 §1③）。
 *
 * electron 运行时面（`Tray` / `Menu` / `nativeImage`）：模板装配走纯函数
 * `trayTemplate.ts`，本文件只做「建托盘 + 装菜单 + 左键 toggle + 换语言重建」。
 *
 * 图标：暂用品牌 `build/icon.ico`（T55 换新像素图标时换引用）。查找顺序
 * `resourcesPath/build` → `appPath/build` → `out/main/../../build`（dev 即
 * apps/desktop/build）；都找不到 → 空图 + WARNING（托盘仍可用、菜单仍可弹，
 * 只是图标不可见——不因图标缺失阻断关窗路径）。
 *
 * 纪律：本模块**只**暴露托盘句柄（`getTray`）；「显示/退出」的真实动作由
 * main/index.ts 注入（那里才持有窗口与 quittingFlag）。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import type { BrowserWindow } from 'electron';
import type { MenuLocale } from './menuTemplate';
import { buildTrayMenuTemplate, type TrayMenuActions } from './trayTemplate';

/** 进程内唯一托盘实例（真机探针经 main inspector 取它做窗口级取证）。 */
let currentTray: Tray | null = null;
/** 托盘右键菜单实例（语言切换即重建；探针取证口 getTrayMenu 读它）。 */
let currentMenu: Menu | null = null;

export interface CreateTrayOptions {
  locale: MenuLocale;
  /** 已存在的窗口或 null（无窗口时「显示主窗口」需重建）。 */
  getWindow(): BrowserWindow | null;
  actions: TrayMenuActions;
  log: (message: string) => void;
}

/** 托盘图标路径（候选逐个 existsSync；全无 → null）。 */
export function resolveTrayIconPath(): string | null {
  const candidates = [
    process.resourcesPath === undefined ? '' : join(process.resourcesPath, 'build', 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(__dirname, '..', '..', 'build', 'icon.ico'),
  ];
  for (const candidate of candidates) {
    if (candidate.length > 0 && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** 建托盘并装菜单；重复调用先销毁旧实例（换语言重建走 refreshTrayMenu）。 */
export function createTray(options: CreateTrayOptions): Tray {
  const iconPath = resolveTrayIconPath();
  if (iconPath === null) {
    options.log('托盘图标未找到（build/icon.ico），以空图启动（托盘与菜单仍可用）');
  }
  const image = iconPath === null ? nativeImage.createEmpty() : nativeImage.createFromPath(iconPath);
  const tray = new Tray(image);
  tray.setToolTip('Septcats');
  currentMenu = Menu.buildFromTemplate(buildTrayMenuTemplate(options.locale, options.actions));
  tray.setContextMenu(currentMenu);
  // 左键 = 显隐 toggle（Notion/Slack 式手感；右键 → 上面那份 context menu）
  tray.on('click', () => {
    const window = options.getWindow();
    if (window === null) {
      options.actions.show();
      return;
    }
    if (window.isVisible() && !window.isMinimized()) {
      window.hide();
      return;
    }
    options.actions.show();
  });
  currentTray?.destroy();
  currentTray = tray;
  options.log(`托盘就绪（locale=${options.locale}，icon=${iconPath ?? '(空)'}）`);
  return tray;
}

/** 当前托盘实例（探针取证口 + 换语言重建用）。 */
export function getTray(): Tray | null {
  return currentTray;
}

/** 当前托盘右键菜单实例（探针取证口：真实 menu.popup 取证与模板跨证用）。 */
export function getTrayMenu(): Menu | null {
  return currentMenu;
}

/** 语言切换后重建右键菜单（label 走 i18n，须即时生效）。 */
export function refreshTrayMenu(locale: MenuLocale, actions: TrayMenuActions): void {
  currentMenu = Menu.buildFromTemplate(buildTrayMenuTemplate(locale, actions));
  currentTray?.setContextMenu(currentMenu);
}

/** 退出前销毁（will-quit）。 */
export function destroyTray(): void {
  currentTray?.destroy();
  currentTray = null;
  currentMenu = null;
}
