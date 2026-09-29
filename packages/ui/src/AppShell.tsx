import type { ReactNode } from 'react';
import clsx from 'clsx';
import { SidebarSimple } from './Icon';
import { IconButton } from './IconButton';
import './AppShell.css';

export interface AppShellProps {
  breadcrumb?: ReactNode;
  /** 顶栏右侧动作（搜索/同步/设置…） */
  actions?: ReactNode;
  sidebar?: ReactNode;
  /**
   * T93-01 一级导航轨（NavRail）插槽：不传时网格仍是两列（零影响）；
   * 传了则最左多一列 `--sc-layout-rail`，顶栏/主区右移，折叠态只收二级栏。
   */
  rail?: ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * AppShell —— 布局壳：顶栏 40px / 侧栏 240px（折叠 = 完全收起，宽度 0）/ 内容区无内衬。
 * 视觉基准：docs/mockups 01-editor.html、02-sidebar-tree.html（顶栏 + 侧栏 + 主区）。
 *
 * T52-01（老板 09-21 §5）：顶栏不再通栏横切窗口宽度 —— 侧栏跨满整列（顶端顶到窗口内容区
 * 第 0 行，即原生菜单下沿），顶栏只覆盖右侧主区列（`.sc-shell__topbar { grid-column: 2 }`）。
 * 折叠钮仍由本组件渲染（props API 零改动：`onToggleSidebar` 语义不变）；desktop 侧在
 * 编辑器视图把它藏掉并在标签条行最左自渲染一个（TASK-T52-01 §1.2）。
 */
export function AppShell({
  breadcrumb,
  actions,
  sidebar,
  rail,
  sidebarCollapsed = false,
  onToggleSidebar,
  children,
  className,
}: AppShellProps) {
  return (
    <div
      className={clsx(
        'sc-shell',
        rail !== undefined && 'sc-shell--rail',
        sidebarCollapsed && 'sc-shell--collapsed',
        className,
      )}
    >
      <div className="sc-shell__body">
        {rail === undefined ? null : <aside className="sc-shell__rail">{rail}</aside>}
        {sidebar === undefined ? null : <aside className="sc-shell__sidebar">{sidebar}</aside>}
        <header className="sc-shell__topbar">
          <IconButton
            icon={SidebarSimple}
            label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            aria-expanded={!sidebarCollapsed}
            onClick={onToggleSidebar}
          />
          <div className="sc-shell__crumb">{breadcrumb ?? null}</div>
          <div className="sc-shell__actions">{actions ?? null}</div>
        </header>
        <main className="sc-shell__main">{children}</main>
      </div>
    </div>
  );
}
