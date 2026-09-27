import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu } from '@septcats/ui';
import type { MenuEntry } from '@septcats/ui';
import type { MenuActionId, MenuRole } from '../../../shared/ipc';
import { t, useLocale } from '../i18n';
import './MenuBarBand.css';

/**
 * MenuBarBand —— 自绘菜单带（TASK-T87-02，老板 09-28：「整个软件随着主题而改变」）。
 *
 * 存在理由：原生菜单栏由 OS 绘制、完全不吃应用 CSS —— 用户选了配色派系/质感风格，
 * 唯独「文件 编辑 视图 帮助」这条带纹丝不动。Windows/Linux 下撤掉原生菜单
 * （main/installApplicationMenu 置 null），由本组件顶上：吃 --sc-color-* token，
 * 随 theme（明暗）× palette（配色派系）× look（质感）全量联动。
 * macOS 不渲染本组件（系统惯例 = 顶部全局菜单栏，OS 原生条已随 nativeTheme 联动深浅）。
 *
 * 行为单源：条目动作全部回发 main.handleMenuAction（window.septcats.menu.click），
 * 与原生菜单走**同一个**动作出口；编辑/缩放标准 role 经 menu.role 转发本窗
 * webContents 执行（语义对齐旧原生模板：registerAccelerator 无关——快捷键仍走
 * 页内既有门控路径，本带只是鼠标入口）。
 */

type GroupDef = {
  key: string;
  items: MenuEntry[];
  /** 'action' 项走 menu.click；'role' 项走 menu.role。 */
  run: (id: string) => void;
};

const ACTION_IDS = new Set<string>([
  'newPage', 'import', 'openTrash', 'toggleSidebar', 'toggleFullWidth',
  'commandPalette', 'closeTab', 'helpManual', 'about', 'quit',
]);

/** 动作 → 键盘提示（仅展示，不注册；与旧原生菜单 accelerator 语义同源）。 */
const HINTS: Record<string, string> = {
  newPage: 'Ctrl+N',
  commandPalette: 'Ctrl+K',
  closeTab: 'Ctrl+W',
  editUndo: 'Ctrl+Z',
  editRedo: 'Ctrl+Y',
  editCut: 'Ctrl+X',
  editCopy: 'Ctrl+C',
  editPaste: 'Ctrl+V',
  editSelectAll: 'Ctrl+A',
  viewZoomIn: 'Ctrl++',
  viewZoomOut: 'Ctrl+-',
  viewZoomReset: 'Ctrl+0',
};

/** 菜单 role 条目 id → 标准 role 名（MENU_ROLES 同源）。 */
const ROLE_BY_ID: Record<string, MenuRole> = {
  editUndo: 'undo',
  editRedo: 'redo',
  editCut: 'cut',
  editCopy: 'copy',
  editPaste: 'paste',
  editSelectAll: 'selectAll',
  viewZoomIn: 'zoomIn',
  viewZoomOut: 'zoomOut',
  viewZoomReset: 'resetZoom',
};

/** 平台判定口径与 main/installApplicationMenu 撤原生菜单一致：仅 Windows 自绘。 */
export function isWindowsShell(): boolean {
  return /Windows/i.test(navigator.userAgent);
}

export function MenuBarBand(): ReactNode {
  useLocale();
  const visible = isWindowsShell();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Esc / 点外关闭（自绘下拉的最低完备交互）
  useEffect(() => {
    if (!visible || openKey === null) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenKey(null);
      }
    };
    const onClick = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpenKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [visible, openKey]);

  if (!visible) {
    return null;
  }

  const run = (id: string): void => {
    const role = ROLE_BY_ID[id];
    if (role !== undefined) {
      void window.septcats.menu.role({ role });
    } else if (ACTION_IDS.has(id)) {
      void window.septcats.menu.click({ action: id as MenuActionId });
    }
    setOpenKey(null);
  };

  const groups: GroupDef[] = [
    {
      key: 'file',
      items: [
        { id: 'newPage', label: t('menu.fileNewPage'), hint: HINTS.newPage },
        { id: 'import', label: t('menu.fileImport') },
        { id: 'openTrash', label: t('menu.fileTrash') },
        { id: 'closeTab', label: t('menu.fileCloseTab'), hint: HINTS.closeTab },
        { id: 'quit', label: t('menu.fileQuit') },
      ],
      run,
    },
    {
      key: 'edit',
      items: [
        { id: 'editUndo', label: t('menu.editUndo'), hint: HINTS.editUndo },
        { id: 'editRedo', label: t('menu.editRedo'), hint: HINTS.editRedo },
        { id: 'editCut', label: t('menu.editCut'), hint: HINTS.editCut },
        { id: 'editCopy', label: t('menu.editCopy'), hint: HINTS.editCopy },
        { id: 'editPaste', label: t('menu.editPaste'), hint: HINTS.editPaste },
        { id: 'editSelectAll', label: t('menu.editSelectAll'), hint: HINTS.editSelectAll },
      ],
      run,
    },
    {
      key: 'view',
      items: [
        { id: 'toggleSidebar', label: t('menu.viewToggleSidebar') },
        { id: 'toggleFullWidth', label: t('menu.viewToggleFullWidth') },
        { id: 'commandPalette', label: t('menu.viewCommandPalette'), hint: HINTS.commandPalette },
        { id: 'viewZoomIn', label: t('menu.viewZoomIn'), hint: HINTS.viewZoomIn },
        { id: 'viewZoomOut', label: t('menu.viewZoomOut'), hint: HINTS.viewZoomOut },
        { id: 'viewZoomReset', label: t('menu.viewZoomReset'), hint: HINTS.viewZoomReset },
      ],
      run,
    },
    {
      key: 'help',
      items: [
        { id: 'helpManual', label: t('menu.helpManual') },
        { id: 'about', label: t('menu.helpAbout') },
      ],
      run,
    },
  ];

  return (
    <div className="menub_band" data-testid="menu-bar-band" ref={rootRef}>
      {groups.map((g) => (
        <div className="menub_slot" key={g.key}>
          <button
            type="button"
            className="menub_item"
            data-testid={`menu-bar-${g.key}`}
            aria-haspopup="menu"
            aria-expanded={openKey === g.key}
            onClick={(event) => {
              // 必须阻断冒泡：Menu 的文档级「点空白关闭」监听会把这次开合 click
              // 误判为空白点击（按钮不在菜单根内）→ 刚开即关（真机 t87-02 复现）。
              event.stopPropagation();
              setOpenKey((v) => (v === g.key ? null : g.key));
            }}
          >
            {t(`menu.${g.key}`)}
          </button>
          {openKey === g.key ? (
            <div className="menub_pop">
              <Menu items={g.items} label={t(`menu.${g.key}`)} onSelect={g.run} onDismiss={() => setOpenKey(null)} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
