/**
 * main/menu.ts —— 原生应用菜单装配（TASK-T51-01 §1②）。
 *
 * 唯一职责：把纯模板（menuTemplate.ts）交给 Electron 的 `Menu.buildFromTemplate`
 * 并 `setApplicationMenu`。启动用当前 locale；设置页切语言 → settings:patch 落盘后
 * 重新调用本函数即时重建（见 main/index.ts）。
 *
 * 本文件 import electron，故不进 Node 单测；模板逻辑在 menuTemplate.ts 单测。
 */

import { Menu } from 'electron';
import type { MenuActionId } from '../shared/ipc';
import { buildMenuTemplate, type MenuLocale } from './menuTemplate';

/** 按 locale 重建并安装应用菜单（label 全走 i18n 字典）。 */
export function applyApplicationMenu(
  locale: MenuLocale,
  onAction: (action: MenuActionId) => void,
): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(locale, onAction)));
}
