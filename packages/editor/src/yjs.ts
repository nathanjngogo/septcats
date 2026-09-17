/**
 * yjs.ts —— Yjs ↔ Tiptap(ProseMirror) 协作绑定（T19-03，协作 CRDT 落地 2/4）。
 *
 * 职责（任务书 §1）：
 * - 上行：PM 事务 →（ySyncPlugin）→ Y.Doc 增量 → 防抖合并（默认 100ms）→
 *   `crdt_update` payload（base64）→ 由上层透传 @septcats/core 事件账；
 * - 下行：`crdt_update` payload → applyCrdtUpdate() → Y.Doc →（ySyncPlugin）→ PM；
 * - 状态隔离：每页一个 Y.XmlFragment（名字 `page:<pageId>`），跨 page 互不干扰。
 *
 * 纪律：
 * - 不改 Tiptap 核心，只用官方绑定 y-prosemirror 的 ySyncPlugin（经 registerPlugin 注入）；
 * - 撤销由 Yjs UndoManager 承载（y-prosemirror 的 yUndoPlugin）：协作语义下只撤本地
 *   变更、不撤远端协作者的内容；不注册 Tiptap history 命令（commands.undo/redo 不存在）；
 * - 编辑器永不写 fs/db——本类只产出 payload，组 Op（lamport/op_id）是上层的事；
 * - 远端增量不回灌生成 op（transaction.local 过滤，防回环）；并发冲突由 Yjs CRDT
 *   决胜（双端同序收敛），本地已产出的 op 不因远端到达而回滚——「优先本地」。
 *
 * Y.Doc 'update' 事件签名为四参 (update, origin, doc, tr)——注意第三参是 Doc、
 * 第四参才是 Transaction，tr.local 判本地必须取第四参（否则本地增量全部被误滤）。
 */
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { CrdtUpdateEntry, CrdtUpdatePayload } from '@septcats/core';
import {
  prosemirrorToYXmlFragment,
  ySyncPlugin,
  yUndoPluginKey,
  yXmlFragmentToProseMirrorRootNode,
  yUndoPlugin,
} from 'y-prosemirror';
import * as Y from 'yjs';

/** 上行 op 的防抖窗口（毫秒）：连续事务合并为单 op，防高频小 op（任务书 §1.2）。
 *  命名带 YJS 前缀：与 seq.ts 的 DEFAULT_DEBOUNCE_MS（seq 防抖，300）区分，避免入口 star 导出歧义。 */
export const YJS_DEFAULT_DEBOUNCE_MS = 100;

/** page 级 Y.Doc 的根类型命名：`page:<pageId>`（pageId 分区）。 */
export function fragmentNameOf(pageId: string): string {
  return `page:${pageId}`;
}

/** {@link YjsEditor.attach} 的选项。 */
export interface YjsAttachOptions {
  /**
   * PM→Y 初始种子开关（默认 true）：Y 侧为空而编辑器带初始内容时，把编辑器内容
   * 上行 Y（种子客户端语义）。协作场景下，账本已有该页 crdt 历史的「迟到种子端」
   * 必须传 false —— 否则双端各自种子会因 Yjs client ID 不同把同一份文本变成两份
   * （T19-05-1）。传 false 时 Y 保持空文档，内容随后续下行增量补齐。
   */
  seed?: boolean;
}

export interface YjsEditorOptions {
  /**
   * 注入 T19-02 `ReplayReport.crdtUpdates`（可整包注入，重放冷启动）。
   * 只应用 pageId 与本实例相同的条目，其余忽略（pageId 分区）。
   */
  crdtUpdates?: readonly CrdtUpdateEntry[];
  /** 防抖 flush 产出 payload 时的回调（上层透传 core 事件账）。 */
  onOp?: (payload: CrdtUpdatePayload) => void;
  /** 防抖窗口毫秒数，默认 {@link YJS_DEFAULT_DEBOUNCE_MS}。 */
  debounceMs?: number;
}

// ---------------------------------------------------------------------------
// base64（Uint8Array ↔ base64；浏览器/jsdom/Electron renderer 通用 btoa/atob 路线）
// ---------------------------------------------------------------------------

const B64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 远端增量的 applyUpdate origin 标记（调试用；判远端靠 transaction.local）。 */
const REMOTE_ORIGIN = 'septcats:remote';

/**
 * Yjs 协作绑定器：一个实例 = 一个 page 的 Y.Doc + 一个 Tiptap 编辑器。
 * 生命周期：构造（可注入回放增量）→ attach(editor) → 编辑/同步 → destroy()。
 */
export class YjsEditor {
  /** 本实例负责的页 id（crdt_update payload 的 pageId）。 */
  readonly pageId: string;
  /** 页级 Y.Doc：真相是 Yjs，PM 文档只是投影（与「块模型是真相」并行的协作层真相）。 */
  readonly doc: Y.Doc;
  /** PM 绑定的根类型：`doc.getXmlFragment(page:<pageId>)`。 */
  readonly fragment: Y.XmlFragment;

  private readonly onOp: ((payload: CrdtUpdatePayload) => void) | undefined;
  private readonly debounceMs: number;
  private readonly pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private attachedEditor: TiptapEditor | null = null;
  private syncPlugin: ReturnType<typeof ySyncPlugin> | null = null;

  constructor(pageId: string, options: YjsEditorOptions = {}) {
    this.pageId = pageId;
    this.onOp = options.onOp;
    this.debounceMs = options.debounceMs ?? YJS_DEFAULT_DEBOUNCE_MS;
    this.doc = new Y.Doc();
    this.fragment = this.doc.getXmlFragment(fragmentNameOf(pageId));
    this.doc.on('update', this.handleDocUpdate);
    for (const entry of options.crdtUpdates ?? []) {
      this.applyCrdtUpdate(entry);
    }
  }

  /** 待发增量条数（测试/调试用）。 */
  get pendingOpCount(): number {
    return this.pending.length;
  }

  // -------------------------------------------------------------------------
  // 绑定：Y.Doc ↔ ProseMirror（ySyncPlugin 完成双向映射，这里只管注入与初始化同步）
  // -------------------------------------------------------------------------

  /**
   * 绑定 Tiptap 编辑器（一个实例只能绑一个编辑器）。
   * @param options.seed PM→Y 初始种子开关（默认 true，见 {@link YjsAttachOptions.seed}）。
   */
  attach(editor: TiptapEditor, options: YjsAttachOptions = {}): this {
    if (this.destroyed) {
      throw new Error(`YjsEditor(pageId=${this.pageId}) 已 destroy，不能再 attach`);
    }
    if (this.attachedEditor !== null) {
      throw new Error(`YjsEditor(pageId=${this.pageId}) 已绑定到另一个编辑器实例`);
    }
    this.attachedEditor = editor;
    const seed = options.seed ?? true;

    if (this.fragment.length > 0) {
      // Y 侧已有内容（注入回放/远端先行）时，先把 PM 投影替换为 Y 内容，
      // 再注册 ySyncPlugin：否则插件首次渲染会把 PM 初始内容清空（Y 是真相）。
      try {
        const fromY = yXmlFragmentToProseMirrorRootNode(this.fragment, editor.schema);
        if (!fromY.eq(editor.state.doc)) {
          editor.view.dispatch(
            editor.state.tr.replaceWith(0, editor.state.doc.content.size, fromY.content),
          );
        }
      } catch (error) {
        // Y 内容含 schema 外节点等异常：只记录，不阻断编辑器（任务书 §4 错误处理）
        console.error(`[YjsEditor] Y→PM 初始投影失败（pageId=${this.pageId}）`, error);
      }
    } else if (seed && editor.state.doc.content.size > 0) {
      // PM→Y 种子（种子客户端语义）：Y 侧为空而编辑器带初始内容时，先把编辑器
      // 内容上行 Y（走正常 handleDocUpdate → 防抖上行通道）。必须发生在注册
      // ySyncPlugin 之前——否则插件首渲染（Y 空 → 渲染空文档）会清掉 PM 初始内容，
      // 种子就永远丢了。
      try {
        this.doc.transact(() => {
          prosemirrorToYXmlFragment(editor.state.doc, this.fragment);
        });
      } catch (error) {
        console.error(`[YjsEditor] PM→Y 初始种子失败（pageId=${this.pageId}）`, error);
      }
    }

    this.syncPlugin = ySyncPlugin(this.fragment);
    editor.registerPlugin(this.syncPlugin);
    // 撤销由 Yjs UndoManager 承载（yUndoPlugin）：trackedOrigins 只含 ySyncPluginKey，
    // 协作语义下撤销只撤本地变更、不撤远端协作者的内容。PM 侧 commands.undo/redo
    // 不存在（未注册 Tiptap History 命令）；上层用 y-prosemirror 的 undoCommand/redoCommand。
    editor.registerPlugin(yUndoPlugin());
    // 空转一拍：触发 ySyncPlugin 的首渲染（PM→Y 种子上行 + DOM 与 state 对齐）。
    // meta-only 事务不改文档，不会产生多余 op（docChanged=false）。
    editor.view.dispatch(editor.state.tr.setMeta('septcats:yjs-attach', true));
    editor.on('transaction', this.handleTransaction);
    return this;
  }

  // -------------------------------------------------------------------------
  // 下行：core 事件账的 crdt_update → Y.Doc →（ySyncPlugin）→ PM
  // -------------------------------------------------------------------------

  /**
   * 应用一条 crdt_update 增量。
   * @returns true = 已应用；false = 被忽略（pageId 不符 / 已销毁 / 增量非法）。
   */
  applyCrdtUpdate(entry: CrdtUpdateEntry | CrdtUpdatePayload): boolean {
    if (this.destroyed) {
      return false;
    }
    if (entry.pageId !== this.pageId) {
      return false; // pageId 分区：跨页增量绝不进本页 Y.Doc
    }
    try {
      const bytes = base64ToBytes(entry.updateB64);
      Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN);
      return true;
    } catch (error) {
      // 坏 base64 / 非法 Yjs 增量：记录但不抛（不影响编辑器功能，任务书 §4）
      console.error(`[YjsEditor] applyCrdtUpdate 失败（pageId=${this.pageId}）`, error);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 上行：Y.Doc 增量 → 防抖合并 → crdt_update payload（由上层透传 core）
  // -------------------------------------------------------------------------

  /**
   * 立即收集待发增量并生成 `crdt_update` payload（base64）。
   * 无待发增量时返回 null。调用后防抖计时器取消、pending 清空。
   */
  sync(): CrdtUpdatePayload | null {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush();
  }

  private flush(): CrdtUpdatePayload | null {
    if (this.destroyed || this.pending.length === 0) {
      return null;
    }
    const merged = Y.mergeUpdates([...this.pending]);
    this.pending.length = 0;
    const payload: CrdtUpdatePayload = {
      pageId: this.pageId,
      updateB64: bytesToBase64(merged),
      // 状态向量水位：供对端/持久层做增量协商（T19-02 payload 契约的 svFromB64）
      svFromB64: bytesToBase64(Y.encodeStateVector(this.doc)),
    };
    this.onOp?.(payload);
    return payload;
  }

  private scheduleFlush(): void {
    if (this.destroyed || this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /**
   * Y.Doc 增量监听：只为**本地**事务积攒待发增量。
   * 注意 Y.Doc 'update' 事件是四参 (update, origin, doc, tr)——第三参是 Doc、
   * 第四参才是 Transaction，tr.local 必须取第四参（取错会把本地增量全滤掉）。
   * - 远端 apply（applyCrdtUpdate / 构造注入回放）tr.local=false → 不回灌（防回环）；
   * - 本地事务（编辑器同步、PM→Y 种子、本地 undo/redo）tr.local=true → 入 pending；
   * - 并发冲突由 Yjs CRDT 全序决胜（双端收敛一致），本地已产出的 op 不回滚——优先本地。
   */
  private handleDocUpdate = (
    update: Uint8Array,
    _origin: unknown,
    _doc: Y.Doc,
    tr: Y.Transaction,
  ): void => {
    if (this.destroyed || !tr.local) {
      return;
    }
    this.pending.push(update);
    this.scheduleFlush();
  };

  /**
   * 编辑器事务监听（任务书 §1.2）：文档有变更时兜底调度防抖 flush。
   * PM→Y 的实际写入由 ySyncPlugin 在同一事务周期完成（触发 handleDocUpdate），
   * 本监听只保证「事务可见 → 必有一次 flush 调度」；pending 为空时 flush 无害。
   */
  private handleTransaction = ({ transaction }: { transaction: Transaction }): void => {
    if (this.destroyed || !transaction.docChanged) {
      return;
    }
    this.scheduleFlush();
  };

  // -------------------------------------------------------------------------

  /** 解绑并销毁：注销插件、摘监听、清计时器、销毁 Y.Doc。幂等。 */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.attachedEditor !== null) {
      this.attachedEditor.off('transaction', this.handleTransaction);
      if (this.syncPlugin !== null) {
        this.attachedEditor.unregisterPlugin(this.syncPlugin);
        this.syncPlugin = null;
      }
      // 按 key 注销 yUndoPlugin（其 view.destroy 会级联销毁 UndoManager）
      this.attachedEditor.unregisterPlugin(yUndoPluginKey);
      this.attachedEditor = null;
    }
    this.doc.off('update', this.handleDocUpdate);
    this.doc.destroy();
  }
}
