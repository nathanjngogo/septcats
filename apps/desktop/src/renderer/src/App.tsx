import { useState } from 'react';
import type { IconGlyph } from '@septcats/ui';
import {
  AppShell,
  Breadcrumb,
  CaretRight,
  Clock,
  FileText,
  FolderSimple,
  GearSix,
  Icon,
  IconButton,
  MagnifyingGlass,
  Note,
  Plus,
  Star,
  SyncPill,
  Trash,
} from '@septcats/ui';
import { PageView } from './pages/PageView';
import './App.css';

interface TreeRowProps {
  label: string;
  icon: IconGlyph;
  depth?: number;
  active?: boolean;
  branch?: boolean;
  count?: number;
}

/** 侧栏行的最小假数据实现（正式页面树由 M5 接管）。 */
function TreeRow({ label, icon, depth = 0, active = false, branch = false, count }: TreeRowProps) {
  return (
    <div
      className={active ? 'app-nav-row app-nav-row--active' : 'app-nav-row'}
      style={{ paddingLeft: `calc(var(--sc-space-sm) + var(--sc-space-md) * ${String(depth)})` }}
    >
      <span className="app-nav-tw">{branch ? <Icon icon={CaretRight} size="sm" /> : null}</span>
      <Icon icon={icon} size="sm" className="app-nav-ic" />
      <span className="app-nav-tx">{label}</span>
      {count === undefined ? null : <span className="app-nav-count">{count}</span>}
    </div>
  );
}

/**
 * 应用外壳（M0 骨架 → T5 内容区接入编辑器）：
 * 顶栏（面包屑 + 搜索/同步/设置）+ 侧栏（3 层假树）+ 内容区 PageView。
 * 视觉基准 = docs/mockups/01-editor.html 与 02-sidebar-tree.html，正式视觉由 PM 真机截图复审。
 */
export function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AppShell
      sidebarCollapsed={collapsed}
      onToggleSidebar={() => {
        setCollapsed((current) => !current);
      }}
      breadcrumb={
        <Breadcrumb items={[{ label: '研究' }, { label: '暗物质探测实验笔记' }]} />
      }
      actions={
        <>
          <IconButton icon={MagnifyingGlass} label="搜索（Ctrl+K）" />
          <SyncPill state="idle" lastSyncedAt="09:41" />
          <IconButton icon={GearSix} label="设置" />
        </>
      }
      sidebar={
        <div className="app-side">
          <div className="app-side-head">
            <Icon icon={FolderSimple} size="sm" />
            个人工作区
          </div>
          <div className="app-side-scroll">
            <TreeRow label="新建页面" icon={Plus} />
            <TreeRow label="收藏" icon={Star} count={12} />
            <TreeRow label="最近" icon={Clock} count={8} />
            <TreeRow label="研究" icon={FolderSimple} branch />
            <TreeRow label="论文速览" icon={FileText} depth={1} />
            <TreeRow label="暗物质探测实验笔记" icon={FileText} depth={1} active />
            <TreeRow label="探测器矩阵" icon={Note} depth={2} />
            <TreeRow label="本底估算" icon={Note} depth={2} />
            <TreeRow label="读书" icon={FolderSimple} branch />
          </div>
          <div className="app-side-foot">
            <Icon icon={Trash} size="sm" />
            回收站
          </div>
        </div>
      }
    >
      <PageView />
    </AppShell>
  );
}
