/**
 * Editor.tsx —— useEditor 装配（直接用 @tiptap/core 的 Editor 类，不引 @tiptap/react）。
 *
 * 数据链路：content = blocksToPMDoc(doc)（投影）；onUpdate → pmDocToBlocks（反投影）
 * → onChange(BlockDoc)。**本组件不 commit**：外发由 EditSession 负责（debounce + batch）。
 * 主题容器 class = `sc-editor`（颜色一律来自 --sc-* token）。
 */
import { useEffect, useRef } from 'react';
import { Editor as TiptapEditor } from '@tiptap/core';
import { LamportClock } from '@septcats/core';
import type { ActorId } from '@septcats/core';
import { blocksToPMDoc, pmDocToBlocks, type BlockDoc, type PMDocJSON } from '../model';
import { editorExtensions } from '../types';
import './editor.css';

/** 编辑器包自用的本地 actor（apps 层接 IPC 时换成真实设备 ID）。 */
export const EDITOR_ACTOR: ActorId = 'editor0001';

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
      onUpdate: ({ editor }) => {
        const json = editor.getJSON() as unknown as PMDocJSON;
        const next = pmDocToBlocks(json, docRef.current, () => clock.tick());
        docRef.current = next;
        onChangeRef.current(next);
      },
    });
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
