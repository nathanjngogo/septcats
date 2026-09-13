/**
 * PageView.tsx —— 页面阅读/编辑视图（T5 §4 接线，薄壳）。
 *
 * 组装：Editor + BlockControls + SlashMenu + SelectionToolbar。
 * 数据：**memorySession**（commit = console + 内存数组），不接 db IPC —— T6 接线。
 * 编辑器只吐 BlockDoc，外发由 EditSession debounce 成一批 Op（计划书 §8.1）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps, DragEvent, KeyboardEvent } from 'react';
import { sortSequence, ulid } from '@septcats/core';
import type { Op } from '@septcats/core';
import {
  EditSession,
  inlineDoc,
  pmNodeNameOf,
  text,
  type Block,
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
import { Button } from '@septcats/ui';
import { DbPage } from '../db/DbPage';
import './PageView.css';

const PAGE_ID = 'pg00000000000000000000demo';
/** ActorId 规则：8-32 位 [a-z0-9]。T6 换成真实设备 ID。 */
const PAGE_ACTOR = 'desktop0001';
/** 演示用图片 sha（内容寻址 file_id 的形状，不是真文件）。 */
const DEMO_IMAGE_SHA = 'a'.repeat(64);

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

const DEMO_PAGE: PageViewPage = { id: PAGE_ID, title: '暗物质探测实验笔记', kind: 'page' };

type EditorHandle = Exclude<
  Parameters<NonNullable<ComponentProps<typeof Editor>['onReady']>>[0],
  null
>;

interface DemoBlockSpec {
  type: string;
  props?: Record<string, unknown>;
  content?: Block['content'];
}

/** 「一页假文档，含 9 块型各一」（§4）。 */
function buildDemoDoc(): BlockDoc {
  const specs: DemoBlockSpec[] = [
    {
      type: 'paragraph',
      content: inlineDoc([text('本页汇总 LZ 类稀有事件探测的实验现状与文献线索。')]),
    },
    { type: 'heading', props: { level: 2 }, content: inlineDoc([text('一、探测器矩阵')]) },
    {
      type: 'to_do',
      props: { checked: true },
      content: inlineDoc([text('整理 XENONnT 2025 SR 的 WIMP 上限图，录入阅读清单')]),
    },
    {
      type: 'to_do',
      props: { checked: false },
      content: inlineDoc([text('复核 LZ 核反冲效率曲线的统计误差来源')]),
    },
    {
      type: 'quote',
      props: { icon: 'ℹ' },
      content: inlineDoc([text('口径提醒：各家实验的曝光量单位不同，制表前统一换算为 ton·yr。')]),
    },
    {
      type: 'quote',
      content: inlineDoc([text('「稀有事件率本底是暗物质直接探测的终极限制。」')]),
    },
    {
      type: 'code',
      props: { lang: 'python' },
      content: 'er = np.interp(energy_kev, breakpoints, values)',
    },
    { type: 'bulleted_list', content: inlineDoc([text('低本底计数与屏蔽方案')]) },
    { type: 'numbered_list', content: inlineDoc([text('先统一单位，再制表')]) },
    { type: 'divider' },
    {
      type: 'image',
      props: { file_id: DEMO_IMAGE_SHA, caption: '图 1：排除曲线（待插入）', width: 480 },
    },
  ];
  const keys = sortSequence(specs.length);
  const blocks: Block[] = specs.map((spec, index) => ({
    id: ulid(1_700_000_000_000 + index),
    page_id: PAGE_ID,
    type: spec.type,
    props: spec.props ?? {},
    content: spec.content ?? (spec.type === 'divider' || spec.type === 'image' ? null : inlineDoc([])),
    parent_id: null,
    sort_key: keys[index] ?? 'A00000000',
    alive: 1,
    version: 1,
    last_edited: 1_700_000_000_000,
  }));
  return { pageId: PAGE_ID, blocks };
}

function blockIdentityOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  return target.closest('[data-id]')?.getAttribute('data-id') ?? null;
}

export function PageView({ page = DEMO_PAGE }: PageViewProps) {
  const [initialDoc] = useState(buildDemoDoc);
  const docRef = useRef<BlockDoc>(initialDoc);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ledgerRef = useRef<Op[]>([]);
  const dragIdRef = useRef<string | null>(null);
  /** 「转为数据库」后跳转到新建的 DB 页（一期无路由，用本地状态承载）。 */
  const [dbPageId, setDbPageId] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [handleTop, setHandleTop] = useState(0);
  const [anchor, setAnchor] = useState<SelectionRect | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const [session] = useState(
    () =>
      new EditSession({
        actor: PAGE_ACTOR,
        commit: (ops) => {
          // memorySession：不接 db IPC（T6），只留痕 + 内存账本。
          ledgerRef.current.push(...ops);
          console.info(`[PageView] commit batch · ${String(ops.length)} ops`, ops);
        },
        now: () => Date.now(),
        initial: initialDoc,
        onError: (error) => {
          console.error('[PageView] commit 失败（不吞）', error);
        },
      }),
  );

  const handleChange = useCallback(
    (next: BlockDoc) => {
      docRef.current = next;
      session.onDocChange(next);
    },
    [session],
  );

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
          throw new Error(`PageView：未知块操作 ${String(exhaustive)}`);
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
    const href = window.prompt('链接地址（https:// / notion:// / page: / #锚点）', 'https://');
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
      const order = docRef.current.blocks.filter((entry) => entry.alive === 1).map((entry) => entry.id);
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
        docRef.current,
        { actor: PAGE_ACTOR, now: Date.now() },
        draggedId,
        beforeId,
      );
      if (plan.kind === 'noop') {
        return;
      }
      const next = applySortKeyAssignments(docRef.current, plan.assignments);
      docRef.current = next;
      session.onDocChange(next);
    },
    [editor, session],
  );

  const convertToDatabase = useCallback((): void => {
    void (async () => {
      const workspaces = await window.septcats.workspaces.list();
      const workspaceId = workspaces.activeId;
      if (workspaceId === null) {
        console.error('[PageView] 转为数据库失败：无活动工作区');
        return;
      }
      const created = await window.septcats.db.create({ workspaceId, title: page.title });
      setDbPageId(created.pageId);
    })().catch((error: unknown) => {
      console.error('[PageView] 转为数据库失败（不吞）', error);
    });
  }, [page.title]);

  if (page.kind === 'database') {
    return <DbPage pageId={page.id} />;
  }
  if (dbPageId !== null) {
    return <DbPage pageId={dbPageId} />;
  }

  return (
    <div className="pv-root" ref={containerRef}>
      <div className="pv-title-row">
        <span className="pv-page-icon" aria-hidden="true">
          🔭
        </span>
        <h1 className="pv-page-title">{page.title}</h1>
        <Button variant="secondary" size="sm" onClick={convertToDatabase}>
          转为数据库
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
        <Editor doc={initialDoc} onChange={handleChange} onReady={setEditor} />
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
    </div>
  );
}
