/**
 * trayTemplate.ts —— 托盘右键菜单模板（TASK-T54-01 §1③）。
 *
 * 纯函数、零 electron 运行时依赖（只 `import type`），供 tray.ts 装配成
 * `Menu.buildFromTemplate` 的入参，也供 test/close-guard.test.ts 在 Node 环境直测
 * 「label 全走 i18n」「两项动作各自派发」两条硬约束（范式同 main/menuTemplate.ts）。
 *
 * 文案同源：直接读 renderer 的 `i18n/{zh-CN,en-US}.ts`（纯数据对象）——与 renderer
 * `t()` 用同一份字典，受 apps/desktop/test/i18n.test.ts 键完备门禁约束。
 */

import type { MenuItemConstructorOptions } from 'electron';
import { enUS } from '../renderer/src/i18n/en-US';
import { zhCN } from '../renderer/src/i18n/zh-CN';
import type { MenuLocale } from './menuTemplate';

/** 托盘菜单文案键（两字典同构，受 i18n 门禁①保证）。 */
export type TrayLabelKey = 'trayShow' | 'trayQuit';

const DICTS: Record<MenuLocale, { menu: Record<TrayLabelKey, string> }> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** 按 locale 取托盘菜单文案（main 侧唯一取词口）。 */
export function trayText(locale: MenuLocale, key: TrayLabelKey): string {
  return DICTS[locale].menu[key];
}

export interface TrayMenuActions {
  /** 「显示主窗口」：无窗口则建窗，隐藏/最小化则恢复并聚焦。 */
  show(): void;
  /** 「退出」：走 quittingFlag 真退（不再弹询问框）。 */
  quit(): void;
}

/** 两项托盘菜单：显示主窗口 / 退出。 */
export function buildTrayMenuTemplate(
  locale: MenuLocale,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: trayText(locale, 'trayShow'), click: () => actions.show() },
    { type: 'separator' },
    { label: trayText(locale, 'trayQuit'), click: () => actions.quit() },
  ];
}
