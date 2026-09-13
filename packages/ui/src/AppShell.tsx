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
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * AppShell —— 布局壳：顶栏 40px / 侧栏 240px（折叠 48px）/ 内容区无内衬。
 * 视觉基准：docs/mockups 01-editor.html、02-sidebar-tree.html（顶栏 + 侧栏 + 主区）。
 */
export function AppShell({
  breadcrumb,
  actions,
  sidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
  children,
  className,
}: AppShellProps) {
  return (
    <div className={clsx('sc-shell', sidebarCollapsed && 'sc-shell--collapsed', className)}>
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
      <div className="sc-shell__body">
        {sidebar === undefined ? null : <aside className="sc-shell__sidebar">{sidebar}</aside>}
        <main className="sc-shell__main">{children}</main>
      </div>
    </div>
  );
}
