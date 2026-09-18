/**
 * PageView.tsx —— 页面阅读/编辑视图（T5 §4 接线，薄壳）。
 *
 * 组装：Editor + BlockControls + SlashMenu + SelectionToolbar。
 * 数据（T21-01）：按 pagesStore.selectedId 经 `blocks:list` 加载真实 blocks 喂编辑器；
 * EditSession 的 commit 经 `blocks:commit` 原样透传 Op 落库（失败走 onError 不吞）。
 * 无选中页（空库/删掉唯一页/初始加载）走既有空态（T26-01 §0.A：demo 假内容兜底
 * 已整体移除，不再回落 DEMO_PAGE）。
 * 打开真实页调一次 touchRecent（失败只记录）。
 * 编辑器只吐 BlockDoc，外发由 EditSession debounce 成一批 Op（计划书 §8.1）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps, DragEvent, KeyboardEvent } from 'react';
import { ulid } from '@septcats/core';
import {
  EditSession,
  pmNodeNameOf,
  type BlockDoc,
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
  planBlockDrop,
  type BlockAction,
  type SelectionRect,
} from '@septcats/editor/react';
import { Button, ErrorPanel, Skeleton } from '@septcats/ui';
import { AI_BLOCK_ACTIONS, buildAiMessages } from '../../../shared/aiPrompts';
import type { AiBlockAction } from '../../../shared/aiPrompts';
import { AiActionPanel } from '../ai/AiActionPanel';
import { attachCollab, detachCollab } from '../collab/collabClient';
import { t } from '../i18n';
import { pushToast, pagesActions, usePages } from '../state/pages';
import { DbPage } from '../db/DbPage';
import './PageView.css';

/** ActorId 规则：8-32 位 [a-z0-9]。T6 换成真实设备 ID。 */
const PAGE_ACTOR = 'desktop0001';

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

  const [docState, setDocState] = useState<PageDocState>({ status: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadBlocks = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [handleTop, setHandleTop] = useState(0);
  const [anchor, setAnchor] = useState<SelectionRect | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
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
   * EditSession 工厂（T21-01）：EditSession 产出的 ops 原样透传 `blocks:commit`
   * （renderer 不组 Op）。commit 返回的 Promise 失败时 reject → EditSession 先调
   * onError 再向 flush() 冒泡（不吞）。
   */
  const createSession = useCallback((initial: BlockDoc): EditSession => {
    return new EditSession({
      actor: PAGE_ACTOR,
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
    },
    [session],
  );

  /**
   * 协作层接线（TASK-T19-05 §1 renderer 面）：编辑器就绪后接入（无可见控件，UI 零
   * 视觉变化）；编辑器销毁/换页时释放。IPC 失败只记录，不阻断编辑（collabClient 内
   * 已 catch，这里是 attach 往返本身的兜底）。
   */
  useEffect(() => {
    if (editor === null || activePageId === null) {
      return;
    }
    let cancelled = false;
    attachCollab(activePageId, editor, () => cancelled).catch((error: unknown) => {
      console.error('[PageView] 协作层接入失败（不阻断编辑）', error);
    });
    return () => {
      cancelled = true;
      detachCollab(activePageId);
    };
  }, [editor, activePageId]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const syncSelection = () => {
      const { from, to } = editor.state.selection;
      setActiveBlockId(blockIdAtPos(editor, from));
      const container = containerRef.current;
      if (container !== null) {
        try {
          setHandleTop(editor.view.coordsAtPos(from).top - container.getBoundingClientRect().top);
        } catch {
          setHandleTop(0);
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

  /** 换型（手柄菜单与斜杠菜单共用）。 */
  const applyBlockType = useCallback(
    (blockType: string, level?: 1 | 2 | 3) => {
      if (editor === null || activeBlockId === null) {
        return;
      }
      const pos = blockPosById(editor, activeBlockId);
      if (pos === null) {
        return;
      }
      const node = editor.state.doc.nodeAt(pos);
      const nodeType = editor.state.schema.nodes[pmNodeNameOf(blockType)];
      if (node === null || nodeType === undefined) {
        return;
      }
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
    },
    [editor, activeBlockId],
  );

  const handleBlockAction = useCallback(
    (action: BlockAction) => {
      if (editor === null || activeBlockId === null) {
        return;
      }
      const pos = blockPosById(editor, activeBlockId);
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
          applyBlockType(action.blockType, action.level);
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
    [editor, activeBlockId, applyBlockType],
  );

  const handleSlashSelect = useCallback(
    (item: SlashItem) => {
      setSlashOpen(false);
      setSlashQuery('');
      applyBlockType(item.blockType, item.level);
    },
    [applyBlockType],
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
    [slashOpen],
  );

  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      dragIdRef.current = activeBlockId;
      if (activeBlockId !== null) {
        event.dataTransfer?.setData('text/plain', activeBlockId);
      }
    },
    [activeBlockId],
  );

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

      // ② sort_key：dnd.ts 的纯函数给最小 reorder（放不下则整层重平衡）
      const plan = planBlockDrop(
        currentDoc,
        { actor: PAGE_ACTOR, now: Date.now() },
        draggedId,
        beforeId,
      );
      if (plan.kind === 'noop') {
        return;
      }
      const next = applySortKeyAssignments(currentDoc, plan.assignments);
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

  if (activePage.kind === 'database') {
    return <DbPage pageId={activePage.id} />;
  }
  if (dbPageId !== null) {
    return <DbPage pageId={dbPageId} />;
  }

  // T21-01：ready（含空页）喂编辑器；loading / error 走既有四态外壳
  // （Skeleton / ErrorPanel，均为 @septcats/ui 既有组件，无新增组件与 token）。
  const editorDoc: BlockDoc | null = docState.status === 'ready' ? docState.doc : null;

  return (
    <div className="pv-root" ref={containerRef}>
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
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {activeBlockId !== null ? (
          <div
            className="pv-handle"
            style={{ top: handleTop }}
            draggable
            onDragStart={onDragStart}
            onDragEnd={() => {
              dragIdRef.current = null;
              setDropTarget(null);
            }}
          >
            <BlockControls blockId={activeBlockId} onAction={handleBlockAction} visible />
          </div>
        ) : null}
        {docState.status === 'loading' ? (
          <Skeleton lines={8} />
        ) : docState.status === 'error' ? (
          <ErrorPanel description={docState.message} onRetry={reloadBlocks} />
        ) : editorDoc !== null ? (
          // doc 挂载时读一次（packages/editor/react/Editor.tsx），key=pageId 保证换页重建
          <Editor key={editorDoc.pageId} doc={editorDoc} onChange={handleChange} onReady={setEditor} />
        ) : null}
        {dropTarget === null ? null : <div className="pv-dropline" data-target={dropTarget} />}
        <SlashMenu
          open={slashOpen}
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={() => {
            setSlashOpen(false);
            setSlashQuery('');
          }}
        />
        <SelectionToolbar editor={editor} anchor={anchor} onRequestLink={requestLink} />
      </div>
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
