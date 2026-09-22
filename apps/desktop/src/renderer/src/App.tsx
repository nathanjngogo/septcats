import { useCallback, useEffect, useState } from 'react';
import { setGlobalThemeMode, ToastViewport } from '@septcats/ui';
import {
  AiRobot,
  AppShell,
  Breadcrumb,
  GearSix,
  IconButton,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
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
import { ManualView } from './manual/ManualView';
import { TabsBar } from './tabs/TabsBar';
import { closeActiveTab, handleTabsKeydown } from './tabs/shortcuts';
import { CloseAskDialog } from './close/CloseAskDialog';
import { TemplateSaveDialog } from './templates/TemplateSaveDialog';
import { LayoutPicker } from './layout/LayoutPicker';
import { LayoutEditorPage } from './layout/LayoutEditorPage';
import { OPEN_LAYOUT_EDITOR_EVENT } from './layout/LayoutSection';
import { t, useLocale } from './i18n';
import { SyncStatusButton } from './sync/SyncStatus';
import { CommandPalette } from './palette/CommandPalette';
import { configurePaletteCommands } from './palette/commands';
import { paletteActions, usePalette } from './state/palette';
import { templatesActions } from './state/templates';
import { pageTypeOf, pagesActions, pagesStore, pagesBreadcrumbItems, pushToast, usePages } from './state/pages';
import { pageWidthActions } from './state/pageWidth';
import { layoutActions, layoutStore, nextLayoutPreset, useLayout } from './layout/layoutState';
import './App.css';

/**
 * 命令行为装配（openSettings/openImport 引用稳定，一次性装配；空 deps 防御在 commands.ts 的调用方保证）。
 * T23-02 §B：「另存为模板」是条件命令——选中页变化时重装配，无选中页则命令不出现（不置灰、不抛错）。
 */
function useCommandWiring(
  openSettings: () => void,
  openImport: () => void,
  openManual: () => void,
  openLayoutEditor: () => void,
): void {
  // T25-01：locale 变化 → 重装配命令（label/hint 在绑定时经 t() 现取）
  const locale = useLocale();
  useEffect(() => {
    const configure = (): void => {
      const state = pagesStore.getState();
      // T41-01-1：「全宽 / 固定宽度」对 DB 页无视觉效果（同侧栏 ⋯ 菜单的隐藏口径）——
      // 选中页为 database 时不注入 toggleFullWidth，命令不出现（不留「执行了没反应」路径）
      const selectedNode = state.nodes.find((node) => node.id === state.selectedId);
      const widthToggleable = selectedNode !== undefined && pageTypeOf(selectedNode) !== 'database';
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
            // T56-01：命令面板「使用说明书」入口（与帮助菜单同一条视图通道）
            openManual,
            // T57-01：命令面板「布局编辑器」入口（与顶栏布局弹框的「自定义编辑…」同一通道）
            openLayoutEditor,
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
            // T41-01：「全宽 / 固定宽度」条件命令（每页独立，toggle 写 pageWidth store+存储）；
            // T41-01-1：仅对非 DB 页注入（DB 页经条件 spread 摘除 → 命令不出现）
            ...(widthToggleable
              ? {
                  toggleFullWidth: (): void => {
                    const id = pagesStore.getState().selectedId;
                    if (id !== null) {
                      pageWidthActions.toggle(id);
                    }
                  },
                }
              : {}),
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
          state.selectedId !== null,
        ),
      );
    };
    configure();
    const unsubscribe = pagesStore.subscribe(configure);
    return unsubscribe;
  }, [openSettings, openImport, openManual, openLayoutEditor, locale]);
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
  const [view, setView] = useState<'editor' | 'settings' | 'import' | 'manual' | 'layout'>('editor');
  // T57-01 §1.1/§1.2：顶栏「布局」钮的弹框开合（aria-pressed 同源）
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  // T25-01：订阅 locale —— 切换语言时整棵组件树重渲染（t() 在渲染期现取文案）
  useLocale();
  const searchOpen = usePalette((state) => state.searchOpen);
  const openSettings = useCallback(() => setView('settings'), []);
  const openImport = useCallback(() => setView('import'), []);
  // T56-01：说明书视图入口（帮助菜单 + 命令面板共用；Esc/关闭钮回 editor）
  const openManual = useCallback(() => setView('manual'), []);
  const closeManual = useCallback(() => setView('editor'), []);
  // T57-01 §1.3：独立布局编辑器页入口（设置页入口按钮 / 弹框「自定义编辑…」/
  // 命令面板 三者同一出口）；「完成」回编辑器视图
  const openLayoutEditor = useCallback(() => {
    setLayoutPickerOpen(false);
    setView('layout');
  }, []);
  const closeLayoutEditor = useCallback(() => setView('editor'), []);
  useCommandWiring(openSettings, openImport, openManual, openLayoutEditor);

  // T51-01：侧栏开合的唯一出口（顶栏按钮 + 原生菜单 View→折叠侧栏 共用），
  // 开合写入布局状态（持久化），位置同步 effect 保持 collapsed 一致。
  const toggleSidebar = useCallback((): void => {
    const next = !collapsed;
    setCollapsed(next);
    layoutActions.setSidebarPosition(next ? 'collapsed' : 'left');
  }, [collapsed]);

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

  // T57-01 §1.3：设置页「布局」区块的入口按钮（同一事件通道解耦，路由仍在 App）
  useEffect(() => {
    window.addEventListener(OPEN_LAYOUT_EDITOR_EVENT, openLayoutEditor);
    return () => {
      window.removeEventListener(OPEN_LAYOUT_EDITOR_EVENT, openLayoutEditor);
    };
  }, [openLayoutEditor]);

  // T37-01 §0.3：页签键盘快捷键（编辑器视图内生效；键位与既有 Ctrl/Cmd+K 不相交）。
  // Ctrl/Cmd+W 关当前（相邻回落）· Ctrl/Cmd+Tab 下一个（循环）· Ctrl/Cmd+1..9 跳第 N
  // （超出页签数夹到最后一个）。settings/import/回收站/搜索页/命令面板打开时不劫持。
  const inSettingsFlag = view === 'settings';
  const inImportFlag = view === 'import';
  const inManualFlag = view === 'manual';
  const inLayoutFlag = view === 'layout';
  const searchOpenFlag = usePalette((state) => state.searchOpen);
  const paletteOpenFlag = usePalette((state) => state.open);
  const pagesViewFlag = usePages((state) => state.view);
  useEffect(() => {
    const editorVisible =
      !inSettingsFlag &&
      !inImportFlag &&
      !inManualFlag &&
      !inLayoutFlag &&
      !searchOpenFlag &&
      !paletteOpenFlag &&
      pagesViewFlag === 'pages';
    const onKeyDown = (event: KeyboardEvent): void => {
      handleTabsKeydown(event, { editorVisible });
    };
    window.addEventListener('keydown', onKeyDown);
    // T51-01：原生菜单动作派发（同一编辑器可见门控——Close Tab 与 Ctrl+W 同条件、
    // 同 closeActiveTab 逻辑；空 op 不产生）。菜单不做 role:'close'，绝不关窗口。
    const unsubscribeMenu = window.septcats.menu.onAction(({ action }) => {
      switch (action) {
        case 'newPage':
          void pagesActions.createPage(null);
          break;
        case 'import':
          setView('import');
          break;
        case 'openTrash':
          pagesActions.showTrash();
          break;
        case 'toggleSidebar':
          toggleSidebar();
          break;
        case 'toggleFullWidth': {
          const id = pagesStore.getState().selectedId;
          if (id !== null) {
            pageWidthActions.toggle(id);
          }
          break;
        }
        case 'commandPalette':
          paletteActions.open();
          break;
        // T56-01：帮助 →「使用说明书」→ 全屏说明书阅读视图
        case 'helpManual':
          setView('manual');
          break;
        case 'closeTab':
          if (editorVisible) {
            closeActiveTab();
          }
          break;
        default:
          break;
      }
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubscribeMenu();
    };
  }, [inSettingsFlag, inImportFlag, inManualFlag, inLayoutFlag, searchOpenFlag, paletteOpenFlag, pagesViewFlag, toggleSidebar]);

  const inSettings = view === 'settings';
  const inImport = view === 'import';
  const inManual = view === 'manual';
  const inLayout = view === 'layout';

  // T51-01：侧栏开合的唯一出口（顶栏/标签条按钮 + 原生菜单 View→折叠侧栏 共用），
  // 开合写入布局状态（持久化），位置同步 effect 保持 collapsed 一致。
  const sidebarToggle = (
    <IconButton
      icon={SidebarSimple}
      label={collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
      aria-expanded={!collapsed}
      data-testid="side-toggle"
      className="app-tabrow-toggle"
      onClick={toggleSidebar}
    />
  );

  // T22-01 §0.A：pages 视图面包屑真路径（trash → 「回收站」；选中页 → 祖先链；
  // 无选中 → 工作区名）。settings/importWizard 保持既有文案；整份 state 订阅
  // （引用稳定，见 store.ts 选择器约束）。
  const pagesState = usePages((state) => state);

  // T52-01 §1.1/§1.2：编辑器视图 = 标签条行存在的那一支（设置/导入/回收站/搜索页各有
  // 自己的顶栏语义，顶栏折叠钮仍由 AppShell 渲染）。编辑器视图下：
  //   ① 顶栏左侧不再显示「工作区名」兜底（名字常驻侧栏头部）；
  //   ② 折叠钮搬到标签条行最左（`sidebarToggle`），顶栏的同名钮由 `.app-shell--fused` 隐藏。
  const editorView = !inSettings && !inImport && !inManual && !inLayout && pagesState.view === 'pages' && !searchOpen;

  // T52-01 §1.1：工作区名改由侧栏头部常驻承载 → 顶栏左端不再渲染「只剩工作区名」的兜底。
  const breadcrumb =
    inSettings ? (
      <Breadcrumb items={[{ label: t('settings.title') }]} />
    ) : inImport ? (
      <Breadcrumb items={[{ label: t('importWizard.title') }]} />
    ) : inManual ? (
      <Breadcrumb items={[{ label: t('manual.title') }]} />
    ) : inLayout ? (
      // T57-01 §1.3：独立布局编辑器页（顶栏面包屑随视图）
      <Breadcrumb items={[{ label: t('settings.layout.editorTitle') }]} />
    ) : pagesState.view === 'pages' && pagesState.selectedId === null ? null : (
      <Breadcrumb items={pagesBreadcrumbItems(pagesState)} />
    );

  return (
    <>
      <AppShell
        className={editorView ? 'app-shell--fused' : ''}
        sidebarCollapsed={collapsed}
        onToggleSidebar={toggleSidebar}
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
                T39-01：AI 面板位置=隐藏时不渲染入口；
                T58-01 §1.2：ICON 换像素机器人头（开=眼亮 / 关=眼暗，见 pixelIcons.css） */}
            {aiHidden ? null : (
              <IconButton
                icon={AiRobot}
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
            {/* T57-01 §1.1：顶栏「布局」钮（设置钮左边，顺序 Sync→Plus→Layout→Gear）——
                弹像素快选框；aria-pressed = 弹框打开态 */}
            <IconButton
              icon={SidebarSimple}
              label={t('app.layoutLabel')}
              aria-pressed={layoutPickerOpen}
              data-testid="layout-open"
              onClick={() => {
                setLayoutPickerOpen((open) => !open);
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
        ) : inManual ? (
          // T56-01：全屏说明书阅读视图（Esc / 关闭钮回 editor）
          <ManualView onClose={closeManual} />
        ) : inLayout ? (
          // T57-01 §1.3：独立布局编辑器页（「完成」回 editor）
          <LayoutEditorPage onDone={closeLayoutEditor} />
        ) : pagesState.view === 'trash' ? (
          <TrashList />
        ) : searchOpen ? (
          <SearchPage />
        ) : (
          // T37-01：编辑列容器闭合高度链（T30 零滚动红线）——标签条行定高 flex:none，
          // PageView flex:1 吃剩余高度，窗口滚动仍只发生在 .pv-root 内部。
          // T52-01 §1.2/§1.3：标签条行总是渲染（布局隐藏标签条时只留行 + 折叠钮插槽，
          // 收起态钮仍可达）；活动标签 content 白底与 .pv-root 连通（TabsBar.css）。
          // T38-01：编辑列 + AI 对话侧栏同行（收起 = 不渲染，主区自动变宽）。
          // T39-01：AI 面板位置=底部 → 主行转纵向（面板定高在下）；隐藏 → 不渲染。
          <div className={`app-main-row${aiPosition === 'bottom' ? ' app-main-row--ai-bottom' : ''}`}>
            <div className="app-editor-col">
              <TabsBar showTabs={tabsVisible} leading={sidebarToggle} />
              <PageView />
            </div>
            {chatOpen && !aiHidden ? <AiChatPanel /> : null}
          </div>
        )}
      </AppShell>
      <CommandPalette />
      <TemplateSaveDialog />
      {/* T57-01 §1.2：布局快选弹框（overlay，不挡主区的结构变化——选卡即时重排可见） */}
      <LayoutPicker
        open={layoutPickerOpen}
        onClose={() => {
          setLayoutPickerOpen(false);
        }}
        onEdit={openLayoutEditor}
      />
      {/* T24-01 §0.A：「删除页面」二次确认（命令面板与侧栏行菜单共用） */}
      <PageDeleteDialog />
      {/* T54-01 §1②：关窗询问框（自绘像素模态；main 拦 close 并冲刷完后推 close:ask） */}
      <CloseAskDialog />
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
