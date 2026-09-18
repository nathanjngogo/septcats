import { useCallback, useEffect, useState } from 'react';
import type { IconGlyph } from '@septcats/ui';
import { setGlobalThemeMode } from '@septcats/ui';
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
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportWizard } from './pages/ImportWizard';
import { t } from './i18n';
import { CommandPalette } from './palette/CommandPalette';
import { bindPaletteCommands } from './palette/commands';
import { paletteActions, usePalette } from './state/palette';
import { pagesStore, pagesActions, pushToast } from './state/pages';
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

/** 命令行为装配（openSettings/openImport 引用稳定，一次性装配；空 deps 防御在 commands.ts 的调用方保证）。 */
function useCommandWiring(openSettings: () => void, openImport: () => void): void {
  useEffect(() => {
    paletteActions.configureCommands(
      bindPaletteCommands({
        createPage: (): void => {
          void pagesActions.createPage(null);
        },
        switchToNextWorkspace: (): void => {
          const state = pagesStore.getState();
          const ids = state.workspaces.map((item) => item.id);
          if (state.workspaceId === null || ids.length < 2) {
            pushToast('没有可切换的工作区', 'info');
            return;
          }
          const nextIndex = (ids.indexOf(state.workspaceId) + 1) % ids.length;
          const nextId = ids[nextIndex];
          if (nextId !== undefined) {
            void pagesActions.switchWorkspace(nextId);
          }
        },
        openTrash: (): void => {
          pagesActions.showTrash();
        },
        openSettings,
        openImport,
        runAiAction: (action): void => {
          // T18-03：命令面板不 import PageView 内部——经窗口事件解耦（照 sync-open 先例）
          window.dispatchEvent(new CustomEvent('septcats:ai-action', { detail: { action } }));
        },
        notify: (message): void => {
          pushToast(message, 'info');
        },
        setThemeMode: (mode): void => {
          setGlobalThemeMode(mode);
        },
      }),
    );
  }, [openSettings, openImport]);
}

/**
 * 应用外壳（M0 骨架 → T5 内容区接入编辑器 → M7 命令面板/搜索页）：
 * 顶栏（面包屑 + 搜索/同步/设置）+ 侧栏（3 层假树）+ 内容区（PageView / SearchPage）。
 * 视觉基准 = docs/mockups/01-editor.html、02-sidebar-tree.html、04/05（面板与搜索页），
 * 正式视觉由 PM 真机截图复审。
 */
export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'editor' | 'settings' | 'import'>('editor');
  const searchOpen = usePalette((state) => state.searchOpen);
  const openSettings = useCallback(() => setView('settings'), []);
  const openImport = useCallback(() => setView('import'), []);
  useCommandWiring(openSettings, openImport);

  // T20-02 §0.B：挂载时初始化 pages store（workspaceId 就位后命令面板/搜索页才真正
  // 发起检索——palette.runSearch 在 workspaceId=null 时静默早退）。
  // load() 幂等：重复调用只是多一次 IPC 快照对账、以同一 activeId 覆盖同一状态切片，
  // StrictMode 双挂载不会产生状态抖动。
  useEffect(() => {
    void pagesActions.load();
  }, []);

  // T18-03：AI 面板空态「打开设置」入口（PageView 经窗口事件解耦，路由仍在 App）
  useEffect(() => {
    const onOpenSettings = (): void => {
      setView('settings');
    };
    window.addEventListener('septcats:open-settings', onOpenSettings);
    return () => {
      window.removeEventListener('septcats:open-settings', onOpenSettings);
    };
  }, []);

  const inSettings = view === 'settings';
  const inImport = view === 'import';

  const breadcrumb =
    inSettings ? (
      <Breadcrumb items={[{ label: t('settings.title') }]} />
    ) : inImport ? (
      <Breadcrumb items={[{ label: t('importWizard.title') }]} />
    ) : (
      <Breadcrumb items={[{ label: '研究' }, { label: '暗物质探测实验笔记' }]} />
    );

  return (
    <>
      <AppShell
        sidebarCollapsed={collapsed}
        onToggleSidebar={() => {
          setCollapsed((current) => !current);
        }}
        breadcrumb={breadcrumb}
        actions={
          <>
            <IconButton
              icon={MagnifyingGlass}
              label="搜索（Ctrl+K）"
              onClick={() => {
                paletteActions.open();
              }}
            />
            <SyncPill state="idle" lastSyncedAt="09:41" />
            <IconButton
              icon={Plus}
              label={t('importWizard.title')}
              aria-pressed={inImport}
              onClick={() => {
                setView((current) => (current === 'import' ? 'editor' : 'import'));
              }}
            />
            <IconButton
              icon={GearSix}
              label="设置"
              aria-pressed={inSettings}
              onClick={() => {
                setView((current) => (current === 'settings' ? 'editor' : 'settings'));
              }}
            />
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
        {inSettings ? (
          <SettingsPage />
        ) : inImport ? (
          <ImportWizard onOpenHome={() => setView('editor')} />
        ) : searchOpen ? (
          <SearchPage />
        ) : (
          <PageView />
        )}
      </AppShell>
      <CommandPalette />
    </>
  );
}
