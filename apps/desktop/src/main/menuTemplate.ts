/**
 * main/menuTemplate.ts —— 原生应用菜单模板（TASK-T51-01 §1②）。
 *
 * 纯函数、零 electron 运行时依赖（只 `import type`），供 `menu.ts` 装配成
 * `Menu.buildFromTemplate` 的入参，也供 test/menu.test.ts 在 Node 环境直测
 * 「label 全走 i18n」「快捷键不与既有全局键双绑」两条硬约束。
 *
 * 文案同源：直接读 renderer 的 `i18n/{zh-CN,en-US}.ts`（纯数据对象，无 DOM/
 * react 依赖）——与 renderer `t()` 用同一份字典，受 i18n.test.ts 键完备门禁约束。
 *
 * 快捷键双绑核查（对 `state/tabs.ts` / App.tsx / main/index.ts 现有键逐字核对）：
 * - Ctrl/Cmd+W → 应用里是「关标签」（`tabsShortcutAction` 的 'close'），菜单
 *   Close Tab **委托同一逻辑**（renderer 收到 menu:action 后走 closeActiveTab），
 *   因此这里 `registerAccelerator:false`：不抢系统键，Ctrl+W 仍由窗口既有
 *   keydown 门控路径处理（settings/命令面板打开时不劫持），菜单点击为等价入口。
 *   绝不挂 role:'close'（那会关窗口）。
 * - Ctrl/Cmd+K（命令面板，main globalShortcut + renderer 两路）→ 菜单项只展示
 *   提示不注册（`registerAccelerator:false`），避免第三路双绑。
 * - Edit 的 undo/redo/cut/copy/paste/selectAll 用标准 role，但同样
 *   `registerAccelerator:false`：编辑器是页内 ProseMirror（自装 history/keymap），
 *   若由系统菜单抢注 Ctrl+Z/C/V/A，页内编辑撤销/复制会被截断。
 * - View 的缩放用 role（Ctrl+±/0 不在页签键位 1..9 内，不冲突），正常注册。
 */

import type { MenuItemConstructorOptions } from 'electron';
import { enUS } from '../renderer/src/i18n/en-US';
import { zhCN } from '../renderer/src/i18n/zh-CN';
import type { MenuActionId } from '../shared/ipc';

export type MenuLocale = 'zh-CN' | 'en-US';

/** menu.* 键名（两字典同构，受 i18n 门禁①保证）。 */
export type MenuLabelKey = keyof typeof zhCN.menu;

/** 两字典的值类型不同（字面量），按「键集合 + string 值」的结构收口。 */
const DICTS: Record<MenuLocale, { menu: Record<MenuLabelKey, string> }> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** 按 locale 取 menu.* 文案（main 侧唯一取词口；NotFound 不该发生——键受门禁约束）。 */
export function menuText(locale: MenuLocale, key: MenuLabelKey): string {
  return DICTS[locale].menu[key];
}

/** 未识别的 locale 一律回落 zh-CN（与 renderer i18n 的回落方向一致）。 */
export function toMenuLocale(locale: string): MenuLocale {
  return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

/**
 * 组装完整应用菜单模板：File / Edit / View / Help 四组。
 * `onAction` 为动作出口——renderer 侧动作经 IPC 广播，'about' 由 main 就地弹窗。
 */
export function buildMenuTemplate(
  locale: MenuLocale,
  onAction: (action: MenuActionId) => void,
): MenuItemConstructorOptions[] {
  const L = (key: MenuLabelKey): string => menuText(locale, key);
  /** 会派发给 renderer 的普通项。 */
  const action = (
    key: MenuLabelKey,
    id: MenuActionId,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => ({
    label: L(key),
    click: () => {
      onAction(id);
    },
    ...extra,
  });
  /** 标准 role 项：label 走 i18n，accelerator 默认（可按需不注册）。 */
  const role = (
    key: MenuLabelKey,
    r: NonNullable<MenuItemConstructorOptions['role']>,
    registerAccelerator: boolean,
  ): MenuItemConstructorOptions => ({
    label: L(key),
    role: r,
    ...(registerAccelerator ? {} : { registerAccelerator: false }),
  });

  return [
    {
      label: L('file'),
      submenu: [
        action('fileNewPage', 'newPage', { accelerator: 'CmdOrCtrl+N' }),
        action('fileImport', 'import'),
        action('fileTrash', 'openTrash'),
        { type: 'separator' },
        // 关标签 ≠ 关窗口：委托页签逻辑（见文件头双绑说明），不注册系统键。
        action('fileCloseTab', 'closeTab', { accelerator: 'CmdOrCtrl+W', registerAccelerator: false }),
        { type: 'separator' },
        { label: L('fileQuit'), role: 'quit' },
      ],
    },
    {
      label: L('edit'),
      submenu: [
        role('editUndo', 'undo', false),
        role('editRedo', 'redo', false),
        { type: 'separator' },
        role('editCut', 'cut', false),
        role('editCopy', 'copy', false),
        role('editPaste', 'paste', false),
        role('editSelectAll', 'selectAll', false),
      ],
    },
    {
      label: L('view'),
      submenu: [
        action('viewToggleSidebar', 'toggleSidebar'),
        action('viewToggleFullWidth', 'toggleFullWidth'),
        // 与 Ctrl/Cmd+K 全局键同键：只展示提示，不注册（避免与 globalShortcut 双绑）。
        action('viewCommandPalette', 'commandPalette', {
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
        }),
        { type: 'separator' },
        role('viewZoomIn', 'zoomIn', true),
        role('viewZoomOut', 'zoomOut', true),
        role('viewZoomReset', 'resetZoom', true),
      ],
    },
    {
      label: L('help'),
      submenu: [action('helpAbout', 'about')],
    },
  ];
}
