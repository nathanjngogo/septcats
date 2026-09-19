/**
 * Editor.tsx —— useEditor 装配（直接用 @tiptap/core 的 Editor 类，不引 @tiptap/react）。
 *
 * 数据链路：content = blocksToPMDoc(doc)（投影）；onUpdate → pmDocToBlocks（反投影）
 * → onChange(BlockDoc)。**本组件不 commit**：外发由 EditSession 负责（debounce + batch）。
 * 主题容器 class = `sc-editor`（颜色一律来自 --sc-* token）。
 */
import { useEffect, useRef } from 'react';
import { Editor as TiptapEditor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { LamportClock } from '@septcats/core';
import type { ActorId } from '@septcats/core';
import {
  blocksToPMDoc,
  isPmBlockNodeName,
  pmDocToBlocks,
  type BlockDoc,
  type PMDocJSON,
} from '../model';
import { editorExtensions } from '../types';
import { blockAnchorPlugin } from './blockAnchor';
import './editor.css';

/** 编辑器包自用的本地 actor（apps 层接 IPC 时换成真实设备 ID）。 */
export const EDITOR_ACTOR: ActorId = 'editor0001';

/**
 * 块 id 回写事务的 meta 标记（TASK-T32-01B）：
 * 模型层 pmDocToBlocks 给新块生成 ulid，但 PM 节点 attrs.id 仍为空 →
 * blockIdAttribute.renderHTML 不输出 data-id → 块手柄结构性无法渲染（真机
 * DOM-DIAG.blockCount = 0）。回写只补 id，不带此 meta 的事务才反投影，
 * 防止 onChange / 回写互相触发成环。
 */
const BLOCK_ID_WRITEBACK_META = 'septcats:block-id-writeback';

/**
 * 把 BlockDoc 的块 id 回写到 PM 顶层节点（TASK-T32-01B 核心修复）。
 *
 * 对应关系：pmDocToBlocks 按 `isPmBlockNodeName` 过滤顶层节点后逐位生成块
 * （存活块 = 过滤后节点序；tombstone 追加在尾部），故这里用同一过滤口径取
 * 顶层块节点、与存活块按序配对；节点缺 id（新键入块）或 id 不符时 setNodeMarkup
 * 补上。补写事务带 {@link BLOCK_ID_WRITEBACK_META}，onUpdate 见 meta 直接跳过。
 * 节点数与存活块数不符（对应关系被外力破坏）时保守放弃，不猜。
 */
export function writeBackBlockIds(editor: TiptapEditor, doc: BlockDoc): void {
  const liveBlocks = doc.blocks.filter((block) => block.alive === 1);
  const blockNodes: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.forEach((node, offset) => {
    if (isPmBlockNodeName(node.type.name)) {
      blockNodes.push({ node, pos: offset });
    }
  });
  if (blockNodes.length !== liveBlocks.length) {
    return;
  }
  const tr = editor.state.tr;
  let changed = false;
  blockNodes.forEach((entry, index) => {
    const blockId = liveBlocks[index]?.id;
    if (blockId === undefined || entry.node.attrs['id'] === blockId) {
      return;
    }
    tr.setNodeMarkup(entry.pos, undefined, { ...entry.node.attrs, id: blockId });
    changed = true;
  });
  if (!changed) {
    return;
  }
  tr.setMeta(BLOCK_ID_WRITEBACK_META, true);
  editor.view.dispatch(tr);
}

export interface EditorProps {
  /** 初始文档（挂载时读一次；之后编辑器是原位真相，外部改 doc 不会回灌）。 */
  doc: BlockDoc;
  onChange: (doc: BlockDoc) => void;
  onReady?: (editor: TiptapEditor | null) => void;
  editable?: boolean;
  className?: string;
}

export function Editor({ doc, onChange, onReady, editable = true, className }: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<BlockDoc>(doc);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const editableRef = useRef(editable);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  editableRef.current = editable;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const clock = new LamportClock(EDITOR_ACTOR);
    const initial = blocksToPMDoc(docRef.current);
    if ((initial.content ?? []).length === 0) {
      // PM 的 doc 要求 block+：空页补一个空段落，避免 schema 校验直接抛错
      initial.content = [{ type: 'paragraph' }];
    }
    const instance = new TiptapEditor({
      element: host,
      extensions: editorExtensions(),
      content: initial,
      editable: editableRef.current,
      onUpdate: ({ editor: instance, transaction }) => {
        // 回写事务（只补 attrs.id）：模型层已是终态，跳过反投影防成环
        if (transaction.getMeta(BLOCK_ID_WRITEBACK_META) === true) {
          return;
        }
        const json = instance.getJSON() as unknown as PMDocJSON;
        const next = pmDocToBlocks(json, docRef.current, () => clock.tick());
        docRef.current = next;
        onChangeRef.current(next);
        // 反投影后把新块 id 写回 PM 节点 → DOM 出现 data-id（T32-01B）
        writeBackBlockIds(instance, next);
      },
    });
    // T36-01：块锚定补偿装饰（换块型首行视觉锚定；见 react/blockAnchor.ts）
    instance.registerPlugin(blockAnchorPlugin());
    onReadyRef.current?.(instance);
    return () => {
      onReadyRef.current?.(null);
      instance.destroy();
    };
  }, []);

  const classes = className === undefined ? 'sc-editor' : `sc-editor ${className}`;
  return <div ref={hostRef} className={classes} data-testid="septcats-editor" />;
}

/** 选区锚点所在的块 id（供手柄/工具条定位；无 id 的节点返回 null）。 */
export function blockIdAtPos(editor: TiptapEditor, pos: number): string | null {
  let found: string | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found !== null) {
      return;
    }
    const from = offset;
    const to = offset + node.nodeSize;
    if (pos >= from && pos <= to) {
      const id: unknown = node.attrs['id'];
      found = typeof id === 'string' && id.length > 0 ? id : null;
    }
  });
  return found;
}

/** 块 id → 该块在 PM 文档里的起始位置（before 位置，可直接喂给 setNodeMarkup）。 */
export function blockPosById(editor: TiptapEditor, blockId: string): number | null {
  let found: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found !== null) {
      return;
    }
    if (node.attrs['id'] === blockId) {
      found = offset;
    }
  });
  return found;
}
