import { useCallback, useEffect, useState } from 'react';
import { setGlobalThemeMode, ToastViewport } from '@septcats/ui';
import {
  AppShell,
  Breadcrumb,
  IconButton,
  SidebarSimple,
} from '@septcats/ui';
import { AiChatPanel } from './ai/AiChatPanel';
import { aiChatActions, useAiChat } from './ai/chatState';
import { PageView } from './pages/PageView';
import { PageDeleteDialog } from './pages/PageDeleteDialog';
import { BatchDeleteDialog } from './pages/BatchDeleteDialog';
// T87-02：Win/Linux 自绘菜单带（原生菜单栏不吃应用 CSS，老板 09-28 令整窗随主题变）
import { MenuBarBand } from './menu/MenuBarBand';
import { TopBarButton } from './layout/TopBarButton';
// T93-01：一级导航轨 + 「知识库」二级栏（老板 09-29 令：侧栏再加一级区分一级菜单）
import { NavRail, type RailKey } from './nav/NavRail';
import { KnowledgePanel } from './nav/KnowledgePanel';
import { navActions, useNav } from './nav/navState';
import { TitleBarBand } from './menu/TitleBarBand';
import { PageLockDialog } from './pages/PageLockDialog';
import { PageExportDialog } from './pages/PageExportDialog';
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
import { ResizeHandle } from './layout/ResizeHandle';
import { OPEN_LAYOUT_EDITOR_EVENT } from './layout/LayoutSection';
import { t, useLocale } from './i18n';
import { SyncStatusButton } from './sync/SyncStatus';
import { CommandPalette } from './palette/CommandPalette';
import { configurePaletteCommands } from './palette/commands';
import { paletteActions, usePalette } from './state/palette';
import { templatesActions } from './state/templates';
import { pageTypeOf, pagesActions, pagesStore, pagesBreadcrumbItems, pushToast, usePages } from './state/pages';
import { pageWidthActions } from './state/pageWidth';
import { WorkbenchPage } from './workbench/WorkbenchPage';
import { workbenchActions, useWorkbench } from './workbench/state';
import { TemplateMarketPage } from './workbench/TemplateMarketPage';
import { layoutActions, layoutStore, nextLayoutPreset, useLayout } from './layout/layoutState';
import { paletteActions as themePaletteActions } from './theme/paletteState';
import { lookActions } from './theme/lookState';
import { useWallpaperUnderlay } from './theme/wallpaperUnderlay';
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
  openWorkbench: () => void,
  openWorkbenchMarket: () => void,
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
            // T66-01 §1.2：命令面板「工作台」入口（go home / workbench）
            openWorkbench,
            // T72-01 §范围1：命令面板「工作台模板市场」入口（与顶栏房子钮/Alt+H 同效）
            openWorkbenchMarket,
            // 老板 09-27 令（取消主题画廊）：配色/质感已内联进「设置→外观」，
            // 命令面板只保留「切到 X 派系 / X 质感」，不再有开画廊这一条。
            setThemePalette: (id): void => {
              themePaletteActions.setPalette(id);
            },
            // T85-01：命令面板「切到 X 质感」三条（与配色切换同通道）
            setThemeLook: (id): void => {
              lookActions.setLook(id);
            },
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
            // T67-01-B2-01 范围4：加锁/移除锁条件命令（仅当前选中页出现，且二选一）。
            // 已锁页 → removeLock（开移除弹层）；未锁页 → addLock（开加锁弹层）。
            // 两条互斥，与侧栏 ⋯ 菜单口径一致；无选中页由 configurePaletteCommands 摘除。
            ...(state.selectedId !== null && state.lockedIds.has(state.selectedId)
              ? {
                  removeLock: (): void => {
                    const id = pagesStore.getState().selectedId;
                    if (id !== null) {
                      pagesActions.openLockDialog(id, 'remove');
                    }
                  },
                }
              : {
                  addLock: (): void => {
                    const id = pagesStore.getState().selectedId;
                    if (id !== null) {
                      pagesActions.openLockDialog(id, 'set');
                    }
                  },
                }),
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
  }, [openSettings, openImport, openManual, openLayoutEditor, openWorkbench, openWorkbenchMarket, locale]);
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
  const [view, setView] = useState<'editor' | 'settings' | 'import' | 'manual' | 'layout' | 'market'>('editor');
  // T57-01 §1.1/§1.2：顶栏「布局」钮的弹框开合（aria-pressed 同源）
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  // T90-01B：玻璃档壁纸衬底（桌面壁纸铺 html 底，透明链只在 [data-wallpaper=1] 生效）
  useWallpaperUnderlay();
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
  // T66-01 §1.1/§1.2：工作台（home）视图态住 workbench slice——覆盖编辑区（标签行内
  // PageView 换装），侧栏/顶栏/标签条保持可点。入口三件套（房子钮/命令/Alt+H）
  // 一律先回 editor 视图再开 home——home 与设置/导入/说明书/布局页不叠放。
  const workbenchView = useWorkbench((state) => state.view);
  const openWorkbench = useCallback(() => {
    setView('editor');
    workbenchActions.openHome();
  }, []);
  const closeWorkbench = useCallback(() => workbenchActions.closeHome(), []);
  // T72-01 §范围1：工作台模板市场入口（顶栏房子钮 / 命令 / Alt+H 同效）。
  // 市场是覆盖编辑区的视图（与设置/导入同通道），打开先收 home——market 与 home 不叠放。
  const openWorkbenchMarket = useCallback((): void => {
    workbenchActions.closeHome();
    setView('market');
  }, []);
  const closeMarket = useCallback(() => setView('editor'), []);
  useCommandWiring(openSettings, openImport, openManual, openLayoutEditor, openWorkbench, openWorkbenchMarket);

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

  // T65-01 §1.1：挂载时初始化配色派系（读存储 + 挂根属性 data-palette），
  // 与 layoutActions.init 同款管线（theme 层 data-theme 由 ThemeProvider 管，palette 自管）。
  useEffect(() => {
    themePaletteActions.init();
  }, []);

  // T85-01：挂载时初始化质感派系（读存储 + 挂根属性 data-look；pixel 缺省 = 现状）。
  useEffect(() => {
    lookActions.init();
  }, []);

  // T39-01：侧栏位置随布局状态同步（预设切换/导入布局后生效）
  useEffect(() => {
    setCollapsed(sidebarPosition === 'collapsed');
  }, [sidebarPosition]);

  // T61-01 §2：窗口变窄时把两侧宽度重新夹进「视口 30%」（老板口径恒成立）。
  // 无变化时 reclampToViewport 零副作用（不写盘/不通知），故可安全挂 resize。
  useEffect(() => {
    const onResize = (): void => {
      layoutActions.reclampToViewport();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

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

  // T87-02：Windows 撤原生菜单 → 其注册的快捷键补挂 renderer 侧（动作单源=menu 出口）：
  //   Ctrl+N 新建页面；Ctrl+±/0 缩放（经 menu.role → 本窗 webContents.setZoomLevel）。
  //   Edit 六件套原本 registerAccelerator:false（页内 ProseMirror 自持），无需补。
  //   仅 Win 生效——mac 保留原生菜单，其 accelerator 照常注册，避免双触发。
  useEffect(() => {
    if (!/Windows/i.test(navigator.userAgent)) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey && !event.metaKey && !event.altKey)) {
        return;
      }
      const k = event.key.toLowerCase();
      if (k === 'n' && !event.shiftKey) {
        event.preventDefault();
        void window.septcats.menu.click({ action: 'newPage' });
      } else if (k === '=' || k === '+') {
        event.preventDefault();
        void window.septcats.menu.role({ role: 'zoomIn' });
      } else if (k === '-') {
        event.preventDefault();
        void window.septcats.menu.role({ role: 'zoomOut' });
      } else if (k === '0') {
        event.preventDefault();
        void window.septcats.menu.role({ role: 'resetZoom' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // T72-01 §范围1：快捷键 Alt+H 打开工作台模板市场（T66 原「开合工作台」语义改为开市场；
  // 与既有 Ctrl/Cmd 系键位不相交；命令面板打开时不劫持——输入焦点在 palette 输入框）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'h' || event.key === 'H')) {
        if (paletteOpenForHotkey) {
          return;
        }
        event.preventDefault();
        openWorkbenchMarket();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [paletteOpenForHotkey, openWorkbenchMarket]);

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

  // T66-01 §1.1：挂载对账——读卡配置；上次退出停在 home → 先落 pages 视图 + toast
  // 防呆提示（home 不是死路；标记已在 init() 里清掉）。
  useEffect(() => {
    const { restoredFromHome } = workbenchActions.init();
    if (restoredFromHome) {
      pushToast(t('workbench.restoredToast'), 'info');
    }
  }, []);

  // T66-01 §1.1/§3 红线「home 不得成为死角」的兜底闸（三通道）：
  // (A) pagesStore 导航变化——home 打开时以「首个 ready 快照」为基线，任何后续页面
  //     导航（侧栏/页签/搜索/回收站/新建落点）先收 home 再走既有语义；启动首帧未
  //     ready 时不抢先关（load() 落 selectedId 属初始基线而非用户导航）。
  useEffect(() => {
    if (workbenchView !== 'home') {
      return;
    }
    const snapshotOf = (): { selectedId: string | null; view: string } => {
      const state = pagesStore.getState();
      return { selectedId: state.selectedId, view: state.view };
    };
    let baseline = pagesStore.getState().status === 'ready' ? snapshotOf() : null;
    return pagesStore.subscribe(() => {
      const next = pagesStore.getState();
      if (next.status !== 'ready') {
        return;
      }
      if (baseline === null) {
        baseline = snapshotOf();
        return;
      }
      if (next.selectedId !== baseline.selectedId || next.view !== baseline.view) {
        workbenchActions.closeHome();
      }
    });
  }, [workbenchView]);
  // (B) 覆盖式弹层（设置/导入/说明书/布局页/搜索页）打开即收 home——
  //     这些各有自己的顶栏语义，与 home 不同时叠放。
  useEffect(() => {
    if (workbenchView !== 'home') {
      return;
    }
    if (view !== 'editor' || searchOpen) {
      workbenchActions.closeHome();
    }
  }, [workbenchView, view, searchOpen]);
  // (C) 指针捕获——home 打开期间点侧栏任意行 / 标签条任意页签（含**当前已选中页**
  //     的同页点击：(A) 的 selectedId 快照比对捕捉不到），先收 home 再放行点击原语义。
  useEffect(() => {
    if (workbenchView !== 'home') {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('.sc-shell__sidebar, .app-tabrow') !== null) {
        workbenchActions.closeHome();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [workbenchView]);

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
  const inMarket = view === 'market';

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

  // T93-01 一级导航轨：一级 = 去哪块地（笔记/知识库/工作台/模板/回收站）。
  // 高亮单真源 = 既有视图状态派生（market / trash / home / nav.panel），组件自己不存。
  const railPanel = useNav((state) => state.panel);
  const railActive: RailKey =
    inMarket
      ? 'templates'
      : workbenchView === 'home'
        ? 'home'
        : pagesState.view === 'trash'
          ? 'trash'
          : railPanel === 'kb'
            ? 'kb'
            : 'notes';
  const onRailSelect = useCallback(
    (key: RailKey): void => {
      if (key === 'home') {
        // 一级项互相排斥：进工作台先离开回收站视图（否则二级栏/高亮会打架）
        pagesActions.showPages();
        openWorkbench();
        return;
      }
      if (key === 'templates') {
        pagesActions.showPages();
        openWorkbenchMarket();
        return;
      }
      // 其余三项都住在编辑器视图里（工作台/market 都要先退出）
      setView('editor');
      workbenchActions.closeHome();
      if (key === 'trash') {
        pagesActions.showTrash();
        return;
      }
      navActions.setPanel(key === 'kb' ? 'kb' : 'notes');
      pagesActions.showPages();
    },
    [openWorkbench, openWorkbenchMarket],
  );

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

  // T87-02：Windows 撤了原生菜单栏 → 自绘菜单带顶上（吃全套主题 token；
  // macOS 不渲染 = OS 惯例 + nativeTheme 已联动，判定在组件内与 main 撤菜单同口径）
  return (
    <div className="app-frame">
      <TitleBarBand />
      <MenuBarBand />
      <div className="app-frame_body">
      <AppShell
        className={editorView ? 'app-shell--fused' : ''}
        sidebarCollapsed={collapsed}
        onToggleSidebar={toggleSidebar}
        breadcrumb={breadcrumb}
        actions={
          <>
            {/* T72-01 §范围1：顶栏房子钮 = 工作台模板市场入口（Alt+H / 命令面板同效）。
                原「我的工作台」home 入口保留为市场内的 workbench-open 行内钮（见
                TemplateMarketPage）。glyph 曾为应用层局部自绘，T74-01 已收编进
                @septcats/ui（packages/ui/src/icons.tsx），调用点零改动。 */}
            {/* 09-29 老板令：顶栏「同步状态那一行」按键全部换成中文按键 →
                「图标去掉」= 纯中文文字钮（TopBarButton，无 glyph）。
                aria-label / data-testid / aria-pressed 语义原样保留。 */}
            <TopBarButton
              label={t('app.workbenchMarketLabel')}
              text={t('app.marketText')}
              pressed={view === 'market'}
              testId="workbench-market-open"
              onClick={openWorkbenchMarket}
            />
            <TopBarButton
              label={t('app.searchLabel')}
              text={t('app.searchText')}
              onClick={() => {
                paletteActions.open();
              }}
            />
            {/* T38-01 §0.6：顶栏 AI 对话入口（可收起右侧面板的开关，Ctrl+J 同效）；
                T39-01：AI 面板位置=隐藏时不渲染入口；
                T58-01 §1.2：ICON 换像素机器人头（开=眼亮 / 关=眼暗，见 pixelIcons.css） */}
            {aiHidden ? null : (
              <TopBarButton
                label={t('app.aiChatLabel')}
                text={t('app.aiText')}
                pressed={chatOpen}
                onClick={toggleAiPanel}
              />
            )}
            {/* T26-01 §0.B：顶栏同步状态走 SyncStatusButton（T13-01 六态、全 i18n）。
                原 SyncPill 的 STATE_LABEL 硬编码在 @septcats/ui（packages/** 红线禁碰）
                且 state="idle" 是静态假态，切 English 后仍显示「已同步」——换真钮后
                文案走 sync.* 双语键（键已存在，无需新增）。 */}
            <SyncStatusButton />
            <TopBarButton
              label={t('importWizard.title')}
              text={t('importWizard.title')}
              pressed={inImport}
              onClick={() => {
                setView((current) => (current === 'import' ? 'editor' : 'import'));
              }}
            />
            {/* T57-01 §1.1：顶栏「布局」钮（设置钮左边，顺序 Sync→Plus→Layout→Gear）——
                弹像素快选框；aria-pressed = 弹框打开态 */}
            <TopBarButton
              label={t('app.layoutLabel')}
              text={t('app.layoutLabel')}
              pressed={layoutPickerOpen}
              testId="layout-open"
              onClick={() => {
                setLayoutPickerOpen((open) => !open);
              }}
            />
            <TopBarButton
              label={t('app.settingsLabel')}
              text={t('app.settingsLabel')}
              pressed={inSettings}
              onClick={() => {
                setView((current) => (current === 'settings' ? 'editor' : 'settings'));
              }}
            />
          </>
        }
        rail={<NavRail active={railActive} onSelect={onRailSelect} />}
        sidebar={
          // T61-01 §2：侧栏右缘拖拽把手与侧栏同宿主（折叠态侧栏整列 display:none →
          // 把手随之不可见，无需额外条件；把手自身也按 position='collapsed' 早退）。
          // T93-01：二级栏按一级项分流 —— 「知识库」显示库列表，其余显示页面树。
          <>
            {railActive === 'kb' ? <KnowledgePanel /> : <SidebarTree />}
            <ResizeHandle side="sidebar" />
          </>
        }
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
        ) : inMarket ? (
          // T72-01 §范围2：工作台模板市场（全屏 region，Esc/关闭钮回 editor；
          // 与 home/workbench 不叠放——打开即收 home，见 openWorkbenchMarket）
          <TemplateMarketPage onClose={closeMarket} onOpenWorkbench={openWorkbench} />
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
              {/* T66-01 §1.1：home 覆盖编辑区（标签条/侧栏/顶栏保持可见可点——
                  点页面行/页签经 App 兜底闸先收 home 再走原语义；Esc/关闭钮回 pages） */}
              {workbenchView === 'home' ? <WorkbenchPage onClose={closeWorkbench} /> : <PageView />}
            </div>
            {/* T61-01 §2：AI 面板左缘拖拽把手（position='right' 才由组件自身渲染；
                bottom/hidden 不挂——宽度对纵向布局无意义）。 */}
            {chatOpen && !aiHidden ? <ResizeHandle side="ai" /> : null}
            {chatOpen && !aiHidden ? <AiChatPanel /> : null}
          </div>
        )}
      </AppShell>
      </div>{/* /app-frame_body */}
      {/* 弹层族 = 根层 fixed 定位，不参与 frame 的 flex 布局 */}
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
      {/* T86-01：侧栏批量删除的二次确认（老板 09-27 令） */}
      <BatchDeleteDialog />
      {/* T67-01-B2-01 范围1：加锁/改密/移除 弹层（侧栏行菜单 + 命令面板共用） */}
      <PageLockDialog />
      {/* R27（T79-01）：页面导出 Markdown 的 scope 选择弹层（侧栏行菜单入口） */}
      <PageExportDialog />
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
    </div>
  );
}
