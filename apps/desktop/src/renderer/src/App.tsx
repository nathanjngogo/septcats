import { useCallback, useEffect, useState } from 'react';
import { setGlobalThemeMode, ToastViewport } from '@septcats/ui';
import {
  AppShell,
  Breadcrumb,
  GearSix,
  IconButton,
  MagnifyingGlass,
  Plus,
  Sparkle,
} from '@septcats/ui';
import { AiChatPanel } from './ai/AiChatPanel';
import { aiChatActions, useAiChat } from './ai/chatState';
import { PageView } from './pages/PageView';
import { PageDeleteDialog } from './pages/PageDeleteDialog';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportWizard } from './pages/ImportWizard';
import { SidebarTree } from './pages/SidebarTree';
import { TrashList } from './pages/TrashList';
import { TabsBar } from './tabs/TabsBar';
import { handleTabsKeydown } from './tabs/shortcuts';
import { TemplateSaveDialog } from './templates/TemplateSaveDialog';
import { t, useLocale } from './i18n';
import { SyncStatusButton } from './sync/SyncStatus';
import { CommandPalette } from './palette/CommandPalette';
import { configurePaletteCommands } from './palette/commands';
import { paletteActions, usePalette } from './state/palette';
import { templatesActions } from './state/templates';
import { pagesActions, pagesStore, pagesBreadcrumbItems, pushToast, usePages } from './state/pages';
import { pageWidthActions } from './state/pageWidth';
import { layoutActions, layoutStore, nextLayoutPreset, useLayout } from './layout/layoutState';
import './App.css';

/**
 * 命令行为装配（openSettings/openImport 引用稳定，一次性装配；空 deps 防御在 commands.ts 的调用方保证）。
 * T23-02 §B：「另存为模板」是条件命令——选中页变化时重装配，无选中页则命令不出现（不置灰、不抛错）。
 */
function useCommandWiring(openSettings: () => void, openImport: () => void): void {
  // T25-01：locale 变化 → 重装配命令（label/hint 在绑定时经 t() 现取）
  const locale = useLocale();
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
                pushToast(t('app.noWorkspaceToSwitch'), 'info');
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
            // T24-01 §0.A：「删除页面」条件命令 → 既有二次确认弹层（PageDeleteDialog）
            deletePage: (): void => {
              const id = pagesStore.getState().selectedId;
              if (id !== null) {
                pagesActions.requestDeletePage(id);
              }
            },
            // T41-01：「全宽 / 固定宽度」条件命令（每页独立，toggle 写 pageWidth store+存储）
            toggleFullWidth: (): void => {
              const id = pagesStore.getState().selectedId;
              if (id !== null) {
                pageWidthActions.toggle(id);
              }
            },
            notify: (message): void => {
              pushToast(message, 'info');
            },
            // T38-01：AI 对话面板开合（命令面板命令）；T39-01：AI 面板位置=隐藏时开合无效
            openAiChat: (): void => {
              if (layoutStore.getState().layout.ai.position !== 'hidden') {
                aiChatActions.togglePanel();
              }
            },
            // T39-01 §0.5：「切换布局预设」命令（循环 notion→focus→workbench，toast 反馈）
            cycleLayoutPreset: (): void => {
              const next = nextLayoutPreset(layoutStore.getState().layout.preset);
              layoutActions.applyPreset(next);
              pushToast(t('settings.layout.presetSwitched').replace('{name}', t(`settings.layout.presetName.${next}`)), 'info');
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
  }, [openSettings, openImport, locale]);
}

/**
 * 应用外壳（M0 骨架 → T5 内容区接入编辑器 → M7 命令面板/搜索页 → T21-02 侧栏真树）：
 * 顶栏（面包屑 + 搜索/同步/设置）+ 侧栏（pagesStore 真树，SidebarTree）+
 * 内容区（PageView / SearchPage）。
 * 视觉基准 = docs/mockups/01-editor.html、02-sidebar-tree.html、04/05（面板与搜索页），
 * 正式视觉由 PM 真机截图复审。
 */
export function App() {
  // T39-01 §0.2：侧栏收起态由布局状态持有（持久化）；顶栏开合钮写入布局状态
  const sidebarPosition = useLayout((state) => state.layout.sidebar.position);
  const [collapsed, setCollapsed] = useState(sidebarPosition === 'collapsed');
  const [view, setView] = useState<'editor' | 'settings' | 'import'>('editor');
  // T25-01：订阅 locale —— 切换语言时整棵组件树重渲染（t() 在渲染期现取文案）
  useLocale();
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

  // T39-01 §0.2/§0.3：挂载时读布局存储（损坏回退默认）+ 注入根节点 CSS 变量
  useEffect(() => {
    layoutActions.init();
  }, []);

  // T39-01：侧栏位置随布局状态同步（预设切换/导入布局后生效）
  useEffect(() => {
    setCollapsed(sidebarPosition === 'collapsed');
  }, [sidebarPosition]);

  // T38-01 §0.1/§1.5：面板开合状态恢复（收起 → 重启 → 仍收起）。
  // T39-01：无手动开合记录时以布局「默认展开」为准（AI 面板隐藏时恒收起）。
  useEffect(() => {
    const layout = layoutStore.getState().layout;
    aiChatActions.initPanel(layout.ai.expanded && layout.ai.position !== 'hidden');
  }, []);

  // T38-01 §0.6：Ctrl/Cmd+J 开合 AI 对话（与 Ctrl+K/W/Tab/1..9 不相交；
  // 命令面板打开时不劫持——输入焦点在 palette 输入框）。
  // T39-01：AI 面板位置=隐藏 → 开合无效（toggleAiPanel 统一出口，见下方声明）。
  const paletteOpenForHotkey = usePalette((state) => state.open);
  // T38-01：AI 对话面板开合（顶栏按钮 aria-pressed + 编辑列旁的侧栏渲染）。
  // T39-01：位置=隐藏 → 面板不渲染、顶栏入口隐藏、Ctrl+J/命令开合无效。
  const chatOpen = useAiChat((state) => state.open);
  const aiPosition = useLayout((state) => state.layout.ai.position);
  const aiHidden = aiPosition === 'hidden';
  const tabsVisible = useLayout((state) => state.layout.tabsVisible);
  const toggleAiPanel = useCallback((): void => {
    if (!aiHidden) {
      aiChatActions.togglePanel();
    }
  }, [aiHidden]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'j' || event.key === 'J')
      ) {
        if (paletteOpenForHotkey) {
          return;
        }
        event.preventDefault();
        toggleAiPanel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [paletteOpenForHotkey, toggleAiPanel]);

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

  // T37-01 §0.3：页签键盘快捷键（编辑器视图内生效；键位与既有 Ctrl/Cmd+K 不相交）。
  // Ctrl/Cmd+W 关当前（相邻回落）· Ctrl/Cmd+Tab 下一个（循环）· Ctrl/Cmd+1..9 跳第 N
  // （超出页签数夹到最后一个）。settings/import/回收站/搜索页/命令面板打开时不劫持。
  const inSettingsFlag = view === 'settings';
  const inImportFlag = view === 'import';
  const searchOpenFlag = usePalette((state) => state.searchOpen);
  const paletteOpenFlag = usePalette((state) => state.open);
  const pagesViewFlag = usePages((state) => state.view);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      handleTabsKeydown(event, {
        editorVisible:
          !inSettingsFlag &&
          !inImportFlag &&
          !searchOpenFlag &&
          !paletteOpenFlag &&
          pagesViewFlag === 'pages',
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [inSettingsFlag, inImportFlag, searchOpenFlag, paletteOpenFlag, pagesViewFlag]);

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
          // T39-01：开合写入布局状态（持久化），位置同步 effect 保持 collapsed 一致
          const next = !collapsed;
          setCollapsed(next);
          layoutActions.setSidebarPosition(next ? 'collapsed' : 'left');
        }}
        breadcrumb={breadcrumb}
        actions={
          <>
            <IconButton
              icon={MagnifyingGlass}
              label={t('app.searchLabel')}
              onClick={() => {
                paletteActions.open();
              }}
            />
            {/* T38-01 §0.6：顶栏 AI 对话入口（可收起右侧面板的开关，Ctrl+J 同效）；
                T39-01：AI 面板位置=隐藏时不渲染入口 */}
            {aiHidden ? null : (
              <IconButton
                icon={Sparkle}
                label={t('app.aiChatLabel')}
                aria-pressed={chatOpen}
                onClick={toggleAiPanel}
              />
            )}
            {/* T26-01 §0.B：顶栏同步状态走 SyncStatusButton（T13-01 六态、全 i18n）。
                原 SyncPill 的 STATE_LABEL 硬编码在 @septcats/ui（packages/** 红线禁碰）
                且 state="idle" 是静态假态，切 English 后仍显示「已同步」——换真钮后
                文案走 sync.* 双语键（键已存在，无需新增）。 */}
            <SyncStatusButton />
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
              label={t('app.settingsLabel')}
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
          // T37-01：编辑列容器闭合高度链（T30 零滚动红线）——标签条定高 flex:none，
          // PageView flex:1 吃剩余高度，窗口滚动仍只发生在 .pv-root 内部。
          // T38-01：编辑列 + AI 对话侧栏同行（收起 = 不渲染，主区自动变宽）。
          // T39-01：AI 面板位置=底部 → 主行转纵向（面板定高在下）；隐藏 → 不渲染。
          <div className={`app-main-row${aiPosition === 'bottom' ? ' app-main-row--ai-bottom' : ''}`}>
            <div className="app-editor-col">
              {tabsVisible ? <TabsBar /> : null}
              <PageView />
            </div>
            {chatOpen && !aiHidden ? <AiChatPanel /> : null}
          </div>
        )}
      </AppShell>
      <CommandPalette />
      <TemplateSaveDialog />
      {/* T24-01 §0.A：「删除页面」二次确认（命令面板与侧栏行菜单共用） */}
      <PageDeleteDialog />
      {/* T24-01 §0.C：全局 Toast 视口（pushToast 队列渲染；根层挂载，底部居中、
          不遮挡居中 Dialog；样式全部走 @septcats/ui 既有 token） */}
      <ToastViewport
        toasts={pagesState.toasts}
        onDismiss={(id) => {
          pagesActions.dismissToast(id);
        }}
      />
    </>
  );
}
