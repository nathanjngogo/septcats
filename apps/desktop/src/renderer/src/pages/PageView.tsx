/**
 * PageView.tsx —— 页面阅读/编辑视图（T5 §4 接线，薄壳）。
 *
 * 组装：Editor + BlockControls + SlashMenu + SelectionToolbar。
 * 数据（T21-01）：按 pagesStore.selectedId 经 `blocks:list` 加载真实 blocks 喂编辑器；
 * EditSession 的 commit 经 `blocks:commit` 透传 Op 落库（失败走 onError 不吞）；
 * 设备身份真源在 main——op 的 actor 由 main 写入前权威改写（TASK-T28-01），
 * 渲染层只传契约要求的占位值。
 * 无选中页（空库/删掉唯一页/初始加载）走既有空态（T26-01 §0.A：demo 假内容兜底
 * 已整体移除，不再回落 DEMO_PAGE）。
 * 打开真实页调一次 touchRecent（失败只记录）。
 * 编辑器只吐 BlockDoc，外发由 EditSession debounce 成一批 Op（计划书 §8.1）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { ulid } from '@septcats/core';
import type { ActorId } from '@septcats/core';
import {
  EditSession,
  filterWikilinkCandidates,
  insertWikilinkSelection,
  pmNodeNameOf,
  resolveWikilinkTarget,
  type BlockDoc,
  type WikilinkClickInfo,
  type WikilinkMenuState,
} from '@septcats/editor';
import type { SlashItem } from '@septcats/editor';
import {
  BlockControls,
  Editor,
  SelectionToolbar,
  SlashMenu,
  applyLinkInSelection,
  applySortKeyAssignments,
  blockIdAtPos,
  blockPosById,
  firstLineAnchorCompensation,
  firstLineRectOf,
  handleTopForFirstLine,
  planBlockDrop,
  setBlockAnchorStyle,
  EDITOR_ACTOR,
  type BlockAction,
  type SelectionRect,
} from '@septcats/editor/react';
import { Button, ErrorPanel, Skeleton } from '@septcats/ui';
import { consumePendingJump, setEditorChatProvider } from '../ai/chatBridge';
import type { PageChatContext } from '../ai/chatContext';
import { AI_BLOCK_ACTIONS, buildAiMessages } from '../../../shared/aiPrompts';
import type { AiBlockAction } from '../../../shared/aiPrompts';
import { AiActionPanel } from '../ai/AiActionPanel';
import { attachCollab, detachCollab } from '../collab/collabClient';
import { t } from '../i18n';
import { aliveNodes, pushToast, pageTypeOf, pagesActions, usePages } from '../state/pages';
import { usePageWidth } from '../state/pageWidth';
import { registerFlushTask } from '../state/flushRegistry';
import { BacklinksPanel } from './BacklinksPanel';
import { reconcileWikilinkTargets } from './wikilinkResolve';
import { DbPage } from '../db/DbPage';
import { WikiLanding } from './WikiLanding';
import './PageView.css';

/**
 * TASK-T28-01：设备身份的唯一真源在 main——`blocks:commit` 写入前会把每个 op 的
 * actor/lamport.d 权威改写为本机真实 actor（main/blocks.ts 的 rebindOpActor）。
 * 渲染层不携带、也不得决定设备身份：下面只是 EditSession / DropContext 契约要求的
 * 占位值（借编辑器包自用的本地 actor 常量），一律会被 main 覆盖。
 */
const PAGE_ACTOR_PLACEHOLDER: ActorId = EDITOR_ACTOR;

/** PageView 的内容分发输入（T7b：database 页走 DbPage，其余走编辑器）。 */
export interface PageViewPage {
  id: string;
  title: string;
  /** 一期 page 行无 kind 列；'database' 表示行内数据库页（缺省按普通编辑器页处理）。 */
  kind?: 'page' | 'database' | undefined;
}

export interface PageViewProps {
  page?: PageViewPage | undefined;
}

type EditorHandle = Exclude<
  Parameters<NonNullable<ComponentProps<typeof Editor>['onReady']>>[0],
  null
>;

function blockIdentityOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest('[data-id]')?.getAttribute('data-id') ?? null;
}

/** AI 面板的受控状态（TASK-T18-03 §2.4：打开/phase/结果/错误/空态全在这里）。 */
interface AiPanelState {
  open: boolean;
  action: AiBlockAction | null;
  phase: 'idle' | 'busy' | 'ok' | 'error';
  result: string;
  error: string;
  emptyReason: string | null;
  canApply: boolean;
}

const AI_PANEL_CLOSED: AiPanelState = {
  open: false,
  action: null,
  phase: 'idle',
  result: '',
  error: '',
  emptyReason: null,
  canApply: false,
};

/** 打开面板时的应用目标快照（面板期间编辑器可能变动，apply 按快照区间落地）。 */
interface AiApplyTarget {
  action: AiBlockAction;
  /** 替换区间（摘要/改写/翻译）；continue 只用 insertAt。 */
  from: number;
  to: number;
  /** continue 的插入点：无选中=块末，有选中=选区末尾。 */
  insertAt: number;
}

/**
 * 内容数据态（T21-01，对齐 DbPage 的 loading/error/ready 四态口径）：
 * ready 含「空页」（blocks=[] → 空文档，可直接输入）。T26-01 §0.A：demo 态已移除。
 */
type PageDocState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: BlockDoc };

export function PageView({ page }: PageViewProps) {
  const docRef = useRef<BlockDoc | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 手柄/浮层的定位基准（.pv-body，position:relative = 浮层 offsetParent）。 */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  /** 「转为数据库」后跳转到新建的 DB 页（一期无路由，用本地状态承载；T24-01 起选中同步到 pagesStore，见 convertToDatabase）。 */
  const [dbPageId, setDbPageId] = useState<string | null>(null);

  // T21-01 数据源：pagesStore.selectedId 驱动真实页；T26-01 §0.A：无选中页不再回落
  // DEMO_PAGE——走空态（activePage = null）
  const selectedId = usePages((state) => state.selectedId);
  const pageNodes = usePages((state) => state.nodes);
  const selectedNode =
    page === undefined && selectedId !== null
      ? (pageNodes.find((node) => node.id === selectedId) ?? null)
      : null;
  const activePage: PageViewPage | null =
    page ?? (selectedNode !== null ? { id: selectedNode.id, title: selectedNode.title } : null);
  const activePageId = activePage?.id ?? null;
  /**
   * T42-01 承载判定（统一处理，同时闭环 T40-01-2）：页面类型来自 pagesStore 真树
   * （main 侧权威判定：存活 collection 行 → database；否则 page_type 列）。
   * 重开/重载后树重拉，库页仍是 database 页（不再依赖当次会话的 dbPageId 本地态）。
   */
  const activeNodeType: 'page' | 'wiki' | 'database' =
    page !== undefined
      ? (page.kind ?? 'page')
      : selectedNode !== null
        ? pageTypeOf(selectedNode)
        : 'page';

  /**
   * T42-01-1：与下方渲染分派严格同构的「本渲染是否真正承载编辑器」判定。
   * wiki 落地页 / 数据库页走 WikiLanding / DbPage（无编辑器实例挂载）。协作接入
   * 必须以此为门——否则「新建子页 → 返回 wiki 落地页」时，Editor 卸载与
   * setEditor(null) 重渲染之间的残留编辑器实例会带着 wiki 页 id 去接协作层
   * （Y→PM 初始投影失败 + y-sync$ 插件重复注册，两条 console 错误）。
   */
  const rendersEditor =
    activePage !== null &&
    !(activePage.kind === 'database' || activeNodeType === 'database') &&
    !(activeNodeType === 'wiki' && selectedNode !== null) &&
    dbPageId === null;

  // T41-01：页面级「全宽 / 固定宽度」开关（Notion 式）。只读状态切片（toggle 在
  // 侧栏 ⋯ 菜单 / 命令面板），宽度表现由 .pv-root[data-measure='full'] CSS 承载，
  // 这里不量测、不内联改宽高；页面级开关优先于 T39-01 的全局 measure 默认。
  const fullWidthPages = usePageWidth((state) => state.full);
  const isFullWidth = activePageId !== null && fullWidthPages.has(activePageId);

  const [docState, setDocState] = useState<PageDocState>({ status: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadBlocks = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  /**
   * 块手柄归属（T32-01 §1.1）：hover 即出现（不要求先选中）。
   * - hoverBlockId：鼠标悬停命中的块（pv-root 内只前进不清零，离开 pv-root 才清）；
   * - pinnedBlockId：块操作菜单打开期间钉住的块（防止移向菜单时手柄漂移/消失）；
   * - 兜底 activeBlockId：纯键盘用户（光标所在块）也能 Tab 到手柄。
   */
  const [hoverBlockId, setHoverBlockId] = useState<string | null>(null);
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null);
  const handleBlockId = pinnedBlockId ?? hoverBlockId ?? activeBlockId;
  const [handleTop, setHandleTop] = useState(0);
  /** 手柄量测器（applyBlockType 补偿落样式后手动触发一次重对齐）。 */
  const measureHandleRef = useRef<() => void>(() => {});
  const [anchor, setAnchor] = useState<SelectionRect | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  /** 斜杠菜单锚点（光标视口坐标换算到 .pv-body；null = 退化到 CSS 缺省位）。 */
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  /** T44-01：双链补全菜单状态（`[[query` 触发；null = 关闭）。 */
  const [wikiMenu, setWikiMenu] = useState<WikilinkMenuState | null>(null);
  /** T44-01：内容修订号（每次编辑 +1；反向链接面板防抖重拉 = 实时更新）。 */
  const [blocksRevision, setBlocksRevision] = useState(0);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [aiPanel, setAiPanel] = useState<AiPanelState>(AI_PANEL_CLOSED);
  const aiTargetRef = useRef<AiApplyTarget | null>(null);
  const aiRunIdRef = useRef(0);

  const [session, setSession] = useState<EditSession | null>(null);
  const sessionRef = useRef<EditSession | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * T54-01 §1①：把当前编辑轮次接进关窗冲刷链——main 拦 close 后发 editor:flush，
   * renderer 跑完全部注册任务才回 ack（「键入正文 → 立刻关窗」的正文因此必在库）。
   * 任务经 sessionRef 现读：换页/重建 session 后冲刷的永远是当前实例。
   */
  useEffect(
    () =>
      registerFlushTask(async () => {
        await sessionRef.current?.flush();
      }),
    [],
  );

  /**
   * EditSession 工厂（T21-01）：EditSession 产出的 ops 原样透传 `blocks:commit`
   * （renderer 不组 Op）。commit 返回的 Promise 失败时 reject → EditSession 先调
   * onError 再向 flush() 冒泡（不吞）。
   */
  const createSession = useCallback((initial: BlockDoc): EditSession => {
    return new EditSession({
      actor: PAGE_ACTOR_PLACEHOLDER,
      commit: async (ops) => {
        await window.septcats.blocks.commit({ ops });
      },
      now: () => Date.now(),
      initial,
      onError: (error) => {
        console.error('[PageView] commit 失败（不吞）', error);
      },
    });
  }, []);

  // 按选中页加载 blocks（T21-01 §0.4）；换页/卸载前冲掉旧页在途编辑轮次（commit
  // 闭包捕获的是旧页 pageId，落库目标正确）
  useEffect(() => {
    if (activePageId === null) {
      return;
    }
    let cancelled = false;
    setDocState({ status: 'loading' });
    window.septcats.blocks
      .list({ pageId: activePageId })
      .then((blocks) => {
        if (cancelled) {
          return;
        }
        const doc: BlockDoc = { pageId: activePageId, blocks };
        docRef.current = doc;
        setDocState({ status: 'ready', doc });
      })
      .catch((error: unknown) => {
        console.error('[PageView] blocks:list 失败', error);
        if (cancelled) {
          return;
        }
        setDocState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
      const current = sessionRef.current;
      if (current !== null) {
        void current.flush().catch(() => undefined);
      }
    };
  }, [activePageId, reloadNonce]);

  // session 跟随内容态重建（EditSession 的 baseline 只能在构造时给定）
  useEffect(() => {
    if (docState.status !== 'ready') {
      setSession(null);
      return;
    }
    setSession(createSession(docState.doc));
  }, [docState, createSession]);

  // 打开真实页调一次 touchRecent（既有 API；失败只记录，§0.6）
  useEffect(() => {
    if (activePageId === null) {
      return;
    }
    window.septcats.recent.touch({ pageId: activePageId }).catch((error: unknown) => {
      console.error('[PageView] touchRecent 失败（只记录）', error);
    });
  }, [activePageId]);

  const handleChange = useCallback(
    (next: BlockDoc) => {
      docRef.current = next;
      session?.onDocChange(next);
      // T44-01：反向链接面板随编辑实时更新（面板内防抖重拉）
      setBlocksRevision((revision) => revision + 1);
    },
    [session],
  );

  /**
   * T42-01-1：分派到非编辑器承载（wiki 落地页 / 数据库页）时清掉残留编辑器实例，
   * 防止残留实例继续被选中同步 / AI 桥 / 协作接入等 editor 消费方误用。
   */
  useEffect(() => {
    if (!rendersEditor && editor !== null) {
      setEditor(null);
    }
  }, [rendersEditor, editor]);

  /**
   * 协作层接线（TASK-T19-05 §1 renderer 面）：编辑器就绪后接入（无可见控件，UI 零
   * 视觉变化）；编辑器销毁/换页时释放。IPC 失败只记录，不阻断编辑（collabClient 内
   * 已 catch，这里是 attach 往返本身的兜底）。T42-01-1：门控加「本渲染真正承载
   * 编辑器」——wiki/database 页不接协作层（渲染分派不产出编辑器实例）。
   * T44-01-1：attach 完成置 collabReady——双链存活对账必须排在 Y→PM 投影/PM→Y
   * 种子之后，否则投影会把对账结果覆盖回去（见下方 reconcile effect）。
   */
  const [collabReady, setCollabReady] = useState(false);
  useEffect(() => {
    if (editor === null || activePageId === null || !rendersEditor) {
      return;
    }
    let cancelled = false;
    setCollabReady(false);
    attachCollab(activePageId, editor, () => cancelled)
      .then(() => {
        if (!cancelled) {
          setCollabReady(true);
        }
      })
      .catch((error: unknown) => {
        console.error('[PageView] 协作层接入失败（不阻断编辑）', error);
      });
    return () => {
      cancelled = true;
      detachCollab(activePageId);
    };
  }, [editor, activePageId, rendersEditor]);

  /**
   * T44-01-1：双链「解析语义 ↔ 页面存活」对账。pages.tree 返回 alive+deleted
   * 全量节点，链接 attrs.target 是插入时写死的页 id——目标页软删后无人重估就会
   * 永远显示已解析（PM 真机 B3/B3b 实证）。这里以存活集合为真源双向收敛：
   * 死 target → null（转未解析，点击走新建路径）；null + 唯一存活标题命中 →
   * 回填 id（回收站恢复后重新解析）。时机：collab attach 完成（防 Y→PM 投影
   * 覆盖）+ 页面树存活态变化时（删页/恢复随 refresh 即时生效）；模块幂等，
   * 无需变更时零事务。
   */
  const aliveKey = useMemo(
    () => pageNodes.map((node) => `${node.id}:${String(node.alive)}:${node.title}`).join('|'),
    [pageNodes],
  );
  useEffect(() => {
    if (editor === null || !collabReady) {
      return;
    }
    reconcileWikilinkTargets(editor, pageNodes);
    // aliveKey 是 pageNodes 的存活态签名：删页/恢复/改名随 refresh 到来时重对账
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, collabReady, aliveKey]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const syncSelection = () => {
      const { from, to } = editor.state.selection;
      setActiveBlockId(blockIdAtPos(editor, from));
      // 斜杠菜单锚点随光标实时更新（键入 query 时菜单跟着走；SlashMenu 内部再做视口夹紧）
      const body = bodyRef.current;
      if (body !== null) {
        try {
          const coords = editor.view.coordsAtPos(from);
          const bodyRect = body.getBoundingClientRect();
          setSlashPos({ top: coords.bottom - bodyRect.top, left: coords.left - bodyRect.left });
        } catch {
          // pos 越界等瞬态：保留上次锚点
        }
      }
      if (from === to) {
        setAnchor(null);
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        setAnchor({
          top: Math.min(start.top, end.top),
          left: Math.min(start.left, end.left),
          width: Math.max(Math.abs(end.right - start.left), 1),
          height: Math.max(Math.abs(end.bottom - start.top), 1),
        });
      } catch {
        setAnchor(null);
      }
    };
    const flush = () => {
      if (session === null) {
        return;
      }
      void session.flush();
    };
    editor.on('selectionUpdate', syncSelection);
    editor.on('update', syncSelection);
    editor.on('blur', flush);
    syncSelection();
    return () => {
      editor.off('selectionUpdate', syncSelection);
      editor.off('update', syncSelection);
      editor.off('blur', flush);
    };
  }, [editor, session]);

  /**
   * T38-01：AI 对话侧栏的编辑器桥 —— 注册当前页上下文提供者与引用块跳转。
   * 编辑器未就绪/数据库页 → 注销（聊天侧回落到无上下文）。provider 闭包经
   * editor.state 现读，无陈旧文档问题；标题/页 id 变化时重注册。
   */
  const jumpToBlockId = useCallback((target: EditorHandle, blockId: string): void => {
    const pos = blockPosById(target, blockId);
    if (pos === null) {
      return;
    }
    target.commands.setTextSelection(pos + 1);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-id="${blockId}"]`)?.scrollIntoView({ block: 'center' });
    });
  }, []);

  const chatPageTitle = activePage?.title ?? null;
  const chatPageIsDb = activeNodeType === 'database';
  useEffect(() => {
    if (editor === null || activePageId === null || chatPageTitle === null || chatPageIsDb) {
      setEditorChatProvider(null);
      return;
    }
    const pageTitle = chatPageTitle;
    setEditorChatProvider({
      pageId: activePageId,
      getPageContext: (): PageChatContext | null => {
        const blocks: Array<{ id: string; text: string }> = [];
        editor.state.doc.forEach((node) => {
          const id = node.attrs['id'];
          if (typeof id === 'string' && node.textContent.trim().length > 0) {
            blocks.push({ id, text: node.textContent });
          }
        });
        const { from, to } = editor.state.selection;
        const selectedText = from !== to ? editor.state.doc.textBetween(from, to, '\n') : null;
        return { pageId: activePageId, pageTitle, blocks, selectedText };
      },
      jumpToBlock: (blockId) => {
        jumpToBlockId(editor, blockId);
      },
    });
    return () => {
      setEditorChatProvider(null);
    };
  }, [editor, activePageId, chatPageTitle, chatPageIsDb, jumpToBlockId]);

  // T38-01：跨页引用跳转 —— 编辑器就绪（key=pageId 重建后）消费 pending 跳转
  useEffect(() => {
    if (editor === null || activePageId === null || chatPageIsDb) {
      return;
    }
    const pending = consumePendingJump(activePageId);
    if (pending !== null) {
      jumpToBlockId(editor, pending.blockId);
    }
  }, [editor, activePageId, chatPageIsDb, jumpToBlockId]);

  /**
   * T44-01：双链点击（Obsidian 式）。
   * 已解析（target 是**存活**页 id）→ 页签打开目标页（openInTab 同页不重复开）；
   * 未解析（target=null 或指向已删/不存在的页）→ 新建该标题页并跳转，回填节点 target
   * （稳定 id 键——此后改名不破链）。目标行为显式（新建+跳转），绝不静默无反应。
   * T44-01-1：pages.tree 返回 alive+deleted 全量节点——判活必须过滤 alive=1，
   * 否则指向已删页的链接会打开死页页签而不是走新建路径（claim#3 口径）。
   */
  const handleWikilinkClick = useCallback(
    (info: WikilinkClickInfo): void => {
      if (editor === null) {
        return;
      }
      const targetAlive =
        info.target !== null &&
        pageNodes.some((node) => node.id === info.target && node.alive === 1);
      if (targetAlive && info.target !== null) {
        pagesActions.openInTab(info.target);
        return;
      }
      void (async () => {
        const created = await window.septcats.pages.create({ parentId: null });
        await window.septcats.pages.rename({ id: created.id, title: info.title });
        await pagesActions.refresh();
        pagesActions.openInTab(created.id);
        // 回填 target（未解析 → 已解析）：节点以稳定 id 为键，改名不破链
        resolveWikilinkTarget(editor, info.pos, created.id);
      })().catch((error: unknown) => {
        console.error('[PageView] 未解析链接新建目标页失败（不吞）', error);
      });
    },
    [editor, pageNodes],
  );

  /**
   * 双链补全候选：当前工作区**存活**页面（树真源；T44-01-1 起排除已删页——
   * 删掉的页不该再作为跳转目标被补全出来），按标题过滤（纯函数，limit 8）。
   */
  const wikilinkHost = {
    candidates: aliveNodes(pageNodes).map((node) => ({ id: node.id, title: node.title })),
    onMenuChange: setWikiMenu,
    onLinkClick: handleWikilinkClick,
  };

  /** 补全确认：把 `[[query` 区间替换为 wikilink 节点（target=候选稳定 id）。 */
  const handleWikiSelect = useCallback(
    (item: { id: string; label: string }): void => {
      setWikiMenu(null);
      if (editor === null || wikiMenu === null) {
        return;
      }
      const caret = editor.state.selection.from;
      const candidate = pageNodes.find((node) => node.id === item.id);
      insertWikilinkSelection(editor, wikiMenu.from, caret, {
        target: item.id,
        title: candidate?.title ?? item.label,
        alias: null,
      });
    },
    [editor, wikiMenu, pageNodes],
  );

  /**
   * 手柄定位（T36-01 §1.1）：簇垂直中心 = 归属块**首行行框**的垂直中心（偏差 ≤1px）。
   * 首行行框取编辑器 coordsAtPos(块内容起点) 的行框盒——多行块只按首行（T32-01 时代的
   * 「块顶=手柄顶」即 PM 实测簇 centerY 偏 3px 的根因）；叶子块（divider/image）退化
   * 整块盒。换型/输入等文档变化会移动首行行框 → 随 editor 'update' 重测（菜单钉住
   * 期间同样保持对齐）；仍夹在 .pv-body 顶防越出视口（T32-01 ①）。
   */
  useEffect(() => {
    if (handleBlockId === null) {
      return;
    }
    const body = bodyRef.current;
    if (body === null) {
      return;
    }
    const measure = (): void => {
      const el = body.querySelector(`[data-id="${handleBlockId}"]`);
      if (!(el instanceof HTMLElement)) {
        return;
      }
      const elRect = el.getBoundingClientRect();
      const pos = editor !== null ? blockPosById(editor, handleBlockId) : null;
      const node = editor !== null && pos !== null ? editor.state.doc.nodeAt(pos) : null;
      const firstLine =
        editor !== null && pos !== null && node !== null
          ? firstLineRectOf(editor.view, node, pos)
          : null;
      const line = firstLine ?? { top: elRect.top, bottom: elRect.bottom };
      const cluster = body.querySelector('.pv-handle');
      const clusterHeight =
        cluster instanceof HTMLElement && cluster.offsetHeight > 0
          ? cluster.offsetHeight
          : line.bottom - line.top;
      setHandleTop(Math.max(handleTopForFirstLine(line, clusterHeight, body.getBoundingClientRect().top), 0));
    };
    measureHandleRef.current = measure;
    measure();
    if (editor === null) {
      return;
    }
    editor.on('update', measure);
    return () => {
      editor.off('update', measure);
      measureHandleRef.current = () => {};
    };
  }, [handleBlockId, editor, docState]);

  /**
   * 换型（手柄菜单与斜杠菜单共用；blockId 由调用方给定）。
   * T36-01 §1.2 视觉锚定：换型前量首行行框中心，换型后把位移用 inline
   * padding-top（下移，不参与坍缩）/ margin-top（上移，按坍缩代数）补偿回零——
   * 首行中心不动、scrollTop 不被牵动、光标映射后仍在原块（tr 未 scrollIntoView）。
   * 补偿是**量测驱动**的（每次转换前重测现状），不累积误差；叶子块（divider/image）
   * 或量测失败时退化为旧行为。JS 量测补偿而非块型 CSS 改间距的原因：列表块是
   * 扁平单 li 块（块间 0 间距是列表观感的一部分），统一锚点 CSS 会破坏列表节奏，
   * 且 UA margin 坍缩使 CSS 补偿无法对任意前邻块成立。
   */
  const applyBlockType = useCallback(
    (blockId: string | null, blockType: string, level?: 1 | 2 | 3) => {
      if (editor === null || blockId === null) {
        return;
      }
      const pos = blockPosById(editor, blockId);
      if (pos === null) {
        return;
      }
      const node = editor.state.doc.nodeAt(pos);
      const nodeType = editor.state.schema.nodes[pmNodeNameOf(blockType)];
      if (node === null || nodeType === undefined) {
        return;
      }
      const beforeRect = firstLineRectOf(editor.view, node, pos);
      const beforeCenter =
        beforeRect !== null ? (beforeRect.top + beforeRect.bottom) / 2 : null;
      const attrs: Record<string, unknown> = { ...node.attrs };
      if (level !== undefined) {
        attrs['level'] = level;
      }
      if (blockType === 'code' && typeof attrs['lang'] !== 'string') {
        attrs['lang'] = '';
      }
      if (blockType === 'to_do' && typeof attrs['checked'] !== 'boolean') {
        attrs['checked'] = false;
      }
      const tr = editor.state.tr;
      if (nodeType.spec.content === undefined) {
        // 原子块（divider/image）不接受既有内容，必须整体替换
        tr.replaceWith(pos, pos + node.nodeSize, nodeType.create(attrs));
      } else {
        tr.setNodeMarkup(pos, nodeType, attrs);
      }
      editor.view.dispatch(tr);
      if (beforeCenter === null) {
        return;
      }
      // PM 的 dispatch 同步完成 DOM 更新 → 此处的量测已反映新块型
      const afterNode = editor.state.doc.nodeAt(pos);
      const el = document.querySelector(`[data-id="${blockId}"]`);
      if (afterNode === null || afterNode.isLeaf || !(el instanceof HTMLElement)) {
        return;
      }
      const afterRect = firstLineRectOf(editor.view, afterNode, pos);
      if (afterRect === null) {
        return;
      }
      const afterStyle = window.getComputedStyle(el);
      const prev = el.previousElementSibling;
      // 前邻块的 margin-bottom；首块传 0——首块的 margin-top 与 .ProseMirror（无
      // padding/border）坍缩传播，视觉上同样有效（PM 实测 P→H1 dTop=-4 = mt 16↔12 差），
      // 坍缩代数与「mb=0 的前邻」完全同构。
      const marginBottomPrev =
        prev instanceof HTMLElement
          ? parseFloat(window.getComputedStyle(prev).marginBottom) || 0
          : 0;
      const input = {
        centerBefore: beforeCenter,
        centerAfter: (afterRect.top + afterRect.bottom) / 2,
        paddingTopAfter: parseFloat(afterStyle.paddingTop) || 0,
        marginTopAfter: parseFloat(afterStyle.marginTop) || 0,
        marginBottomPrev,
      };
      const comp = firstLineAnchorCompensation(input);
      // 补偿以 Node 装饰承载（PM 重渲染自动重放）：直接写 el.style 会被
      // EditSession/collab 回声引发的重渲染抹掉（T36-01 真机实证）
      setBlockAnchorStyle(editor, blockId, comp);
      // 补偿移动了首行 → 手柄重对齐（'update' 已在 dispatch 内跑过，这里补一次）
      measureHandleRef.current();
    },
    [editor],
  );

  const handleBlockAction = useCallback(
    (action: BlockAction) => {
      // 动作落在手柄归属块上（hover 的块），而非光标所在块（T32-01 §1.1 Notion 手感）
      const targetId = handleBlockId;
      if (editor === null || targetId === null) {
        return;
      }
      const pos = blockPosById(editor, targetId);
      if (pos === null) {
        return;
      }
      const node = editor.state.doc.nodeAt(pos);
      if (node === null) {
        return;
      }
      const tr = editor.state.tr;
      switch (action.kind) {
        case 'delete': {
          editor.view.dispatch(tr.delete(pos, pos + node.nodeSize));
          return;
        }
        case 'duplicate': {
          const copy = node.type.create({ ...node.attrs, id: ulid() }, node.content, node.marks);
          editor.view.dispatch(tr.insert(pos + node.nodeSize, copy));
          return;
        }
        case 'convert': {
          applyBlockType(targetId, action.blockType, action.level);
          return;
        }
        case 'color': {
          const markType = editor.state.schema.marks['color'];
          if (markType === undefined) {
            return;
          }
          const from = pos + 1;
          const to = pos + node.nodeSize - 1;
          tr.removeMark(from, to, markType);
          if (action.token !== 'default' && to > from) {
            tr.addMark(from, to, markType.create({ token: action.token }));
          }
          editor.view.dispatch(tr);
          return;
        }
        default: {
          const exhaustive: never = action;
          throw new Error(`PageView: unknown block action ${String(exhaustive)}`);
        }
      }
    },
    [editor, handleBlockId, applyBlockType],
  );

  /** 点击 ＋：在手柄归属块后插入空段落并把光标移进去（T32-01 §1.1）。 */
  const insertBlockAfterHandle = useCallback((): void => {
    if (editor === null || handleBlockId === null) {
      return;
    }
    const pos = blockPosById(editor, handleBlockId);
    const node = pos !== null ? editor.state.doc.nodeAt(pos) : null;
    const paragraphType = editor.state.schema.nodes['paragraph'];
    if (pos === null || node === null || paragraphType === undefined) {
      return;
    }
    const insertAt = pos + node.nodeSize;
    const tr = editor.state.tr.insert(insertAt, paragraphType.create({ id: ulid() }));
    editor.view.dispatch(tr);
    // 空段落内容起点 = insertAt + 1（@tiptap/pm 未在 apps 直依，走实例命令设选区）
    editor.commands.setTextSelection(insertAt + 1);
  }, [editor, handleBlockId]);

  const handleSlashSelect = useCallback(
    (item: SlashItem) => {
      setSlashOpen(false);
      setSlashQuery('');
      // 应用前清掉「/query」触发文本：取块内光标前最后一个 '/' 到光标的区间删除，
      // 再把光标所在块换成所选块型（T32-01 §1.2）。
      let caretBlockId: string | null = null;
      if (editor !== null) {
        const caret = editor.state.selection.from;
        caretBlockId = blockIdAtPos(editor, caret);
        const pos = caretBlockId !== null ? blockPosById(editor, caretBlockId) : null;
        if (pos !== null && caret > pos + 1) {
          const inner = editor.state.doc.textBetween(pos + 1, caret, '\n');
          const slashIndex = inner.lastIndexOf('/');
          if (slashIndex >= 0) {
            editor.view.dispatch(editor.state.tr.delete(pos + 1 + slashIndex, caret));
          }
        }
      }
      applyBlockType(caretBlockId, item.blockType, item.level);
    },
    [applyBlockType, editor],
  );

  const requestLink = useCallback((target: EditorHandle) => {
    const href = window.prompt(t('editor.linkPrompt'), 'https://');
    if (href === null) {
      return;
    }
    if (!applyLinkInSelection(target, href)) {
      console.warn('[PageView] 链接未应用（未选中文本或 href 不在白名单）', href);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // 双链补全菜单打开期间，斜杠触发让位（两浮层不叠开；键盘归 SlashMenu capture）
      if (wikiMenu !== null) {
        return;
      }
      if (event.key === '/') {
        setSlashOpen(true);
        setSlashQuery('');
        return;
      }
      if (!slashOpen) {
        return;
      }
      if (event.key === 'Backspace') {
        setSlashQuery((query) => query.slice(0, -1));
        return;
      }
      if (event.key.length === 1 && /[a-zA-Z0-9\u4e00-\u9fa5]/.test(event.key)) {
        setSlashQuery((query) => query + event.key);
      }
    },
    [slashOpen, wikiMenu],
  );

  /** hover 即出现手柄（T32-01 §1.1）：pv-body 内只前进不清零（跨块间隙不闪烁）。 */
  const onMouseOver = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (pinnedBlockId !== null) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest('.pv-handle') !== null) {
        return; // 悬停手柄/菜单本体时不切换归属块
      }
      const id = blockIdentityOf(target);
      if (id !== null) {
        setHoverBlockId(id);
      }
    },
    [pinnedBlockId],
  );

  const onMouseLeaveBody = useCallback((): void => {
    if (pinnedBlockId === null) {
      setHoverBlockId(null);
    }
  }, [pinnedBlockId]);

  /** 菜单开着时钉住手柄归属块（关闭后交还 hover 跟随）。 */
  const handleControlsOpenChange = useCallback(
    (open: boolean) => {
      setPinnedBlockId(open ? handleBlockId : null);
    },
    [handleBlockId],
  );

  const onDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      dragIdRef.current = handleBlockId;
      if (handleBlockId !== null) {
        // T60-01 ①：payload 走**私有 MIME**——拖到正文上时，drop 先被 ProseMirror 的
        // 原生 drop 监听处理（React 合成 drop 在它之后），若带 text/plain，PM 会把
        // 「块 id 当纯文本」插进落点（T60 真机实测：正文被插进 26 位 id）。
        // 私有 MIME 对 PM 不可解析（getData('text/plain') = ''）→ 正文零污染；
        // 落点归属仍由本组件 onDrop + dragIdRef 判定，不依赖 dataTransfer 内容。
        // 注：jsdom 的合成 dragstart 没有 dataTransfer（undefined）→ 一律走真值判定。
        const dt = event.dataTransfer;
        if (dt !== null && dt !== undefined) {
          dt.setData('application/x-septcats-block-id', handleBlockId);
          dt.effectAllowed = 'move';
        }
      }
    },
    [handleBlockId],
  );

  /** T60-01 ①：拖拽落在 ⋮⋮ 键上，拖完（成功/取消）都要清拖拽态与落点提示线。 */
  const onDragEnd = useCallback((): void => {
    dragIdRef.current = null;
    setDropTarget(null);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const targetId = blockIdentityOf(event.target);
    setDropTarget(targetId !== null && targetId !== dragIdRef.current ? targetId : null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const draggedId = dragIdRef.current;
      dragIdRef.current = null;
      setDropTarget(null);
      if (editor === null || draggedId === null) {
        return;
      }

      const targetId = blockIdentityOf(event.target);
      const currentDoc = docRef.current;
      if (currentDoc === null) {
        return;
      }
      const order = currentDoc.blocks.filter((entry) => entry.alive === 1).map((entry) => entry.id);
      let beforeId: string | null = null;
      if (targetId !== null && targetId !== draggedId) {
        const element = event.target instanceof HTMLElement ? event.target.closest('[data-id]') : null;
        const rect = element?.getBoundingClientRect();
        const dropAfter = rect === undefined ? false : event.clientY > rect.top + rect.height / 2;
        beforeId = dropAfter ? order[order.indexOf(targetId) + 1] ?? null : targetId;
      }

      const fromPos = blockPosById(editor, draggedId);
      if (fromPos === null) {
        return;
      }
      const node = editor.state.doc.nodeAt(fromPos);
      if (node === null) {
        return;
      }
      // ① PM 侧立即移动（视觉生效；onUpdate → handleChange → session）
      const tr = editor.state.tr.delete(fromPos, fromPos + node.nodeSize);
      const rawTarget = beforeId === null ? null : blockPosById(editor, beforeId);
      const insertAt =
        rawTarget === null ? tr.doc.content.size : rawTarget > fromPos ? rawTarget - node.nodeSize : rawTarget;
      tr.insert(insertAt, node);
      editor.view.dispatch(tr);

      // ② sort_key：dnd.ts 的纯函数给最小 reorder（放不下则整层重平衡）。
      //    diff 以「数组顺序」识别 reorder（sort_key 字段在 patch 里被排除），所以必须把
      //    拖后的视觉顺序写回 blocks 数组，否则差分为空、落库为空（T32-01 §2.④ 修复）。
      const aliveOrder = currentDoc.blocks
        .filter((entry) => entry.alive === 1)
        .map((entry) => entry.id);
      const fromIndex = aliveOrder.indexOf(draggedId);
      aliveOrder.splice(fromIndex, 1);
      const toIndex = beforeId === null ? aliveOrder.length : aliveOrder.indexOf(beforeId);
      aliveOrder.splice(toIndex < 0 ? aliveOrder.length : toIndex, 0, draggedId);
      const blockById = new Map(currentDoc.blocks.map((entry) => [entry.id, entry]));
      const reorderedDoc: BlockDoc = {
        pageId: currentDoc.pageId,
        blocks: [
          ...aliveOrder
            .map((id) => blockById.get(id))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined),
          ...currentDoc.blocks.filter((entry) => entry.alive !== 1),
        ],
      };
      const plan = planBlockDrop(
        currentDoc,
        // 占位 actor（会被 main 覆盖）：plan.ops 不外发，提交仍走 EditSession 差分
        { actor: PAGE_ACTOR_PLACEHOLDER, now: Date.now() },
        draggedId,
        beforeId,
      );
      if (plan.kind === 'noop') {
        return;
      }
      const next = applySortKeyAssignments(reorderedDoc, plan.assignments);
      docRef.current = next;
      session?.onDocChange(next);
    },
    [editor, session],
  );

  const convertToDatabase = useCallback((): void => {
    if (activePage === null) {
      return;
    }
    void (async () => {
      const workspaces = await window.septcats.workspaces.list();
      const workspaceId = workspaces.activeId;
      if (workspaceId === null) {
        console.error('[PageView] 转为数据库失败：无活动工作区');
        return;
      }
      const created = await window.septcats.db.create({ workspaceId, title: activePage.title });
      setDbPageId(created.pageId);
      // T24-01 §0.B（判别①结论）：转换跳转只落在本地 dbPageId，pagesStore.selectedId
      // 仍指原页 → 面板「另存为模板」按 selectedId 取页会存错页（kind=page）。
      // 这里先对账树（侧栏立即出现新库页），再 selectPage 同步选中（含 touchRecent）。
      await pagesActions.refresh();
      pagesActions.selectPage(created.pageId);
    })().catch((error: unknown) => {
      console.error('[PageView] 转为数据库失败（不吞）', error);
    });
  }, [activePage]);

  /**
   * 块级 AI 动作（TASK-T18-03 §2.4）：取文本（选中优先/块文本回退）→ ai.state() 三态门控
   * → ai.chat() → 面板呈现。应用走 TipTap transaction + 既有保存路径，不新增旁路。
   */
  const runAiAction = useCallback(
    async (action: AiBlockAction): Promise<void> => {
      if (editor === null) {
        return;
      }
      const runId = ++aiRunIdRef.current;
      const { from, to } = editor.state.selection;
      let text: string;
      if (from !== to) {
        // 选中优先：整段选中文本（块边界用换行拼接）
        text = editor.state.doc.textBetween(from, to, '\n');
        aiTargetRef.current = { action, from, to, insertAt: to };
      } else {
        // 无选中 → 光标所在最近的块级文本节点（沿 depth 向上找 isBlock && isTextblock）
        const $from = editor.state.doc.resolve(from);
        let blockStart = -1;
        let blockSize = 0;
        let blockText = '';
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.isBlock && node.isTextblock) {
            blockStart = $from.start(depth) - 1;
            blockSize = node.nodeSize;
            blockText = node.textContent;
            break;
          }
        }
        if (blockStart < 0 || blockText.length === 0) {
          aiTargetRef.current = null;
          setAiPanel({ ...AI_PANEL_CLOSED, open: true, action, emptyReason: t('ai.emptyText') });
          return;
        }
        text = blockText;
        const replaceFrom = blockStart + 1;
        const replaceTo = blockStart + blockSize - 1;
        aiTargetRef.current = { action, from: replaceFrom, to: replaceTo, insertAt: replaceTo };
      }
      setAiPanel({ ...AI_PANEL_CLOSED, open: true, action, phase: 'busy' });
      try {
        // ai.state() 门控三态：未启用 / 无 provider / 正常
        const st = await window.septcats.ai.state();
        if (runId !== aiRunIdRef.current) {
          return;
        }
        if (!st.enabled) {
          setAiPanel((prev) => ({ ...prev, phase: 'idle', emptyReason: t('ai.needEnable') }));
          return;
        }
        if (st.providers.length === 0) {
          setAiPanel((prev) => ({ ...prev, phase: 'idle', emptyReason: t('ai.needProvider') }));
          return;
        }
        const providerId = st.activeProviderId ?? st.providers[0]?.id;
        if (providerId === undefined) {
          setAiPanel((prev) => ({ ...prev, phase: 'idle', emptyReason: t('ai.needProvider') }));
          return;
        }
        const res = await window.septcats.ai.chat({
          providerId,
          messages: buildAiMessages({ action, text }),
        });
        if (runId !== aiRunIdRef.current) {
          return;
        }
        setAiPanel((prev) => ({ ...prev, phase: 'ok', result: res.text, canApply: true }));
      } catch (error: unknown) {
        if (runId !== aiRunIdRef.current) {
          return;
        }
        setAiPanel((prev) => ({
          ...prev,
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [editor],
  );

  // septcats:ai-action 事件入口（照 SyncStatus 的 septcats:sync-open 先例）
  useEffect(() => {
    const known = AI_BLOCK_ACTIONS as readonly string[];
    const onAiAction = (event: Event): void => {
      const action = (event as CustomEvent).detail?.action;
      if (typeof action === 'string' && known.includes(action)) {
        void runAiAction(action as AiBlockAction);
      }
    };
    window.addEventListener('septcats:ai-action', onAiAction);
    return () => {
      window.removeEventListener('septcats:ai-action', onAiAction);
    };
  }, [runAiAction]);

  const closeAiPanel = useCallback((): void => {
    aiRunIdRef.current += 1; // 作废在途请求，防止迟到的 setState
    aiTargetRef.current = null;
    setAiPanel(AI_PANEL_CLOSED);
  }, []);

  /** 应用（§0.5）：摘要/改写/翻译=替换，续写=块末/选区末追加；dispatch 后走既有保存路径。 */
  const applyAiResult = useCallback((): void => {
    if (editor === null || aiPanel.phase !== 'ok') {
      return;
    }
    const target = aiTargetRef.current;
    if (target === null) {
      return;
    }
    const tr = editor.state.tr;
    if (target.action === 'continue') {
      tr.insertText(aiPanel.result, target.insertAt, target.insertAt);
    } else {
      tr.insertText(aiPanel.result, target.from, target.to);
    }
    editor.view.dispatch(tr);
    closeAiPanel();
    pushToast(t('ai.applied'), 'info');
  }, [editor, aiPanel.phase, aiPanel.result, closeAiPanel]);

  const retryAiAction = useCallback((): void => {
    const action = aiPanel.action;
    if (action !== null) {
      void runAiAction(action);
    }
  }, [aiPanel.action, runAiAction]);

  const openAiSettings = useCallback((): void => {
    // 跳设置页：路由在 App（本地 state），经窗口事件解耦（照 sync-open 先例）
    window.dispatchEvent(new CustomEvent('septcats:open-settings'));
  }, []);

  // T26-01 §0.A：无选中页（空库/删掉唯一页/树未就绪）→ 既有空态，不再回落 demo 假内容。
  // 空态复用回收站/搜索空态同款 token 组合（.pv-empty 与 .trash-empty 同口径），文案走 t()。
  if (activePage === null) {
    return (
      <div className="pv-root" ref={containerRef}>
        <div className="pv-empty">{t('editor.emptyPage')}</div>
      </div>
    );
  }

  // T42-01：承载判定统一走真树注解——database 页（含重开/重载后的库页，T40-01-2
  // 闭环）→ DbPage；wiki 页 → WikiLanding；dbPageId 本地态仅作转换瞬间的兜底。
  if (activePage.kind === 'database' || activeNodeType === 'database') {
    return <DbPage pageId={activePage.id} />;
  }
  if (activeNodeType === 'wiki' && selectedNode !== null) {
    return <WikiLanding key={selectedNode.id} node={selectedNode} />;
  }
  if (dbPageId !== null) {
    return <DbPage pageId={dbPageId} />;
  }

  // T21-01：ready（含空页）喂编辑器；loading / error 走既有四态外壳
  // （Skeleton / ErrorPanel，均为 @septcats/ui 既有组件，无新增组件与 token）。
  const editorDoc: BlockDoc | null = docState.status === 'ready' ? docState.doc : null;

  return (
    <div className="pv-root" ref={containerRef} data-measure={isFullWidth ? 'full' : undefined}>
      <div className="pv-title-row">
        <span className="pv-page-icon" aria-hidden="true">
          🔭
        </span>
        <h1 className="pv-page-title">{activePage.title}</h1>
        <Button variant="secondary" size="sm" onClick={convertToDatabase}>
          {t('editor.convertToDatabase')}
        </Button>
      </div>
      <div
        className="pv-body"
        ref={bodyRef}
        onKeyDown={onKeyDown}
        onMouseOver={onMouseOver}
        onMouseLeave={onMouseLeaveBody}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {handleBlockId !== null ? (
          // T60-01 ①：拖拽从 ⋮⋮ 键发起（HTML5 drag 在「壳 draggable + 指针落按钮」下
          // 不生效），故壳不再挂 draggable、只保留 T53 立体语法；dragstart/dragend 经
          // BlockControls 的 dragHandleProps 落到抓手键本体（+ 键不可拖）。
          <div className="pv-handle" style={{ top: handleTop }}>
            <BlockControls
              blockId={handleBlockId}
              onAction={handleBlockAction}
              onInsert={insertBlockAfterHandle}
              onOpenChange={handleControlsOpenChange}
              dragHandleProps={{ draggable: true, onDragStart, onDragEnd }}
              visible
            />
          </div>
        ) : null}
        {docState.status === 'loading' ? (
          <Skeleton lines={8} />
        ) : docState.status === 'error' ? (
          <ErrorPanel description={docState.message} onRetry={reloadBlocks} />
        ) : editorDoc !== null ? (
          // doc 挂载时读一次（packages/editor/react/Editor.tsx），key=pageId 保证换页重建
          <Editor
            key={editorDoc.pageId}
            doc={editorDoc}
            onChange={handleChange}
            onReady={setEditor}
            wikilinkHost={wikilinkHost}
          />
        ) : null}
        {dropTarget === null ? null : <div className="pv-dropline" data-target={dropTarget} />}
        <SlashMenu
          open={slashOpen}
          query={slashQuery}
          position={slashPos ?? undefined}
          onSelect={handleSlashSelect}
          onClose={() => {
            setSlashOpen(false);
            setSlashQuery('');
          }}
        />
        <SlashMenu
          open={wikiMenu !== null}
          query={wikiMenu?.query ?? ''}
          position={slashPos ?? undefined}
          title={t('editor.wikilinkMenuTitle')}
          items={filterWikilinkCandidates(wikilinkHost.candidates, wikiMenu?.query ?? '').map(
            (candidate) => ({ id: candidate.id, label: candidate.title, hint: '' }),
          )}
          onSelect={handleWikiSelect}
          onClose={() => {
            setWikiMenu(null);
          }}
        />
        <SelectionToolbar editor={editor} anchor={anchor} onRequestLink={requestLink} />
      </div>
      <BacklinksPanel pageId={activePage.id} revision={blocksRevision} />
      <AiActionPanel
        open={aiPanel.open}
        action={aiPanel.action}
        phase={aiPanel.phase}
        result={aiPanel.result}
        error={aiPanel.error}
        emptyReason={aiPanel.emptyReason}
        canApply={aiPanel.canApply}
        onApply={applyAiResult}
        onRetry={retryAiAction}
        onOpenSettings={openAiSettings}
        onClose={closeAiPanel}
      />
    </div>
  );
}
