import { useCallback, useEffect, useState } from 'react';
import { setGlobalThemeMode } from '@septcats/ui';
import {
  AppShell,
  Breadcrumb,
  GearSix,
  IconButton,
  MagnifyingGlass,
  Plus,
  SyncPill,
} from '@septcats/ui';
import { PageView } from './pages/PageView';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportWizard } from './pages/ImportWizard';
import { SidebarTree } from './pages/SidebarTree';
import { TrashList } from './pages/TrashList';
import { TemplateSaveDialog } from './templates/TemplateSaveDialog';
import { t } from './i18n';
import { CommandPalette } from './palette/CommandPalette';
import { configurePaletteCommands } from './palette/commands';
import { paletteActions, usePalette } from './state/palette';
import { templatesActions } from './state/templates';
import { pagesActions, pagesStore, pagesBreadcrumbItems, pushToast, usePages } from './state/pages';
import './App.css';

/**
 * 命令行为装配（openSettings/openImport 引用稳定，一次性装配；空 deps 防御在 commands.ts 的调用方保证）。
 * T23-02 §B：「另存为模板」是条件命令——选中页变化时重装配，无选中页则命令不出现（不置灰、不抛错）。
 */
function useCommandWiring(openSettings: () => void, openImport: () => void): void {
  useEffect(() => {
    const configure = (): void => {
      paletteActions.configureCommands(
        configurePaletteCommands(
          {
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
            saveAsTemplate: (): void => {
              templatesActions.beginSaveFromPage();
            },
            notify: (message): void => {
              pushToast(message, 'info');
            },
            setThemeMode: (mode): void => {
              setGlobalThemeMode(mode);
            },
          },
          pagesStore.getState().selectedId !== null,
        ),
      );
    };
    configure();
    const unsubscribe = pagesStore.subscribe(configure);
    return unsubscribe;
  }, [openSettings, openImport]);
}

/**
 * 应用外壳（M0 骨架 → T5 内容区接入编辑器 → M7 命令面板/搜索页 → T21-02 侧栏真树）：
 * 顶栏（面包屑 + 搜索/同步/设置）+ 侧栏（pagesStore 真树，SidebarTree）+
 * 内容区（PageView / SearchPage）。
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

  // T22-01 §0.A：pages 视图面包屑真路径（trash → 「回收站」；选中页 → 祖先链；
  // 无选中 → 工作区名）。settings/importWizard 保持既有文案；整份 state 订阅
  // （引用稳定，见 store.ts 选择器约束）。
  const pagesState = usePages((state) => state);

  const breadcrumb =
    inSettings ? (
      <Breadcrumb items={[{ label: t('settings.title') }]} />
    ) : inImport ? (
      <Breadcrumb items={[{ label: t('importWizard.title') }]} />
    ) : (
      <Breadcrumb items={pagesBreadcrumbItems(pagesState)} />
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
        sidebar={<SidebarTree />}
      >
        {inSettings ? (
          <SettingsPage />
        ) : inImport ? (
          <ImportWizard onOpenHome={() => setView('editor')} />
        ) : pagesState.view === 'trash' ? (
          <TrashList />
        ) : searchOpen ? (
          <SearchPage />
        ) : (
          <PageView />
        )}
      </AppShell>
      <CommandPalette />
      <TemplateSaveDialog />
    </>
  );
}
