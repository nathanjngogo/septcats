/**
 * collabClient.ts —— 渲染端协作接线（TASK-T19-05 §1 renderer 面）。
 *
 * 一页一个 YjsEditor（复用 T19-03，Y.Doc ↔ Tiptap 双向绑定在此进程内成立）：
 * - attach：`collab:attach` 取回 main 的播种集（快照区段聚合 + 账本 op，opId 去重）
 *   → 构造注入重建 Y.Doc → attach 到 Tiptap（Y 非空时 Y→PM 投影，Y 空 + PM 有内容
 *   时 PM→Y 种子——种子客户端语义由 T19-03 attach 内建，双端不各自种子的约定由
 *   「先取 main 状态再 attach」的时序保证）；
 * - 上行：YjsEditor 防抖 flush 的 payload → `collab:apply`（main 组 Op 入真相层）；
 * - 下行：`collab:update` 推流按 pageId 路由到本进程 YjsEditor（applyCrdtUpdate 幂等，
 *   REMOTE origin 不回灌）；
 * - detach：先 sync() 冲掉防抖尾（≤100ms 增量），再 IPC detach（main flush + LRU 释放）。
 *
 * 纪律：无 UI、无可见控件（UI 零视觉变化红线）；IPC 失败只记录不阻断编辑。
 */
import { YjsEditor } from '@septcats/editor';
import type { CrdtUpdateEntry } from '@septcats/core';
import type { CollabUpdateEntry, CollabUplinkInput } from '../../../shared/collab';

/** YjsEditor.attach 收的 Tiptap 编辑器类型（经 attach 签名推导，避免直依赖 @tiptap/core）。 */
type CollabEditor = Parameters<YjsEditor['attach']>[0];

/** 本进程打开中的协作页（pageId → YjsEditor；PageView 关闭即摘除）。 */
const docs = new Map<string, YjsEditor>();

let downlinkSubscribed = false;

function ensureDownlink(): void {
  if (downlinkSubscribed) {
    return;
  }
  downlinkSubscribed = true;
  window.septcats.collab.onUpdate((entries: CollabUpdateEntry[]) => {
    for (const entry of entries) {
      const editor = docs.get(entry.pageId);
      if (editor === undefined) {
        continue; // 未打开页忽略（内容在账本，attach 时播种）
      }
      editor.applyCrdtUpdate(entry);
    }
  });
}

/**
 * PageView 打开：接入协作层。`isCancelled` 供 unmount 竞态守卫（IPC 往返期间
 * 页面已关闭则放弃安装，防孤儿实例）。
 */
export async function attachCollab(
  pageId: string,
  editor: CollabEditor,
  isCancelled: () => boolean = (): boolean => false,
): Promise<void> {
  ensureDownlink();
  const result = await window.septcats.collab.attach({ pageId });
  if (isCancelled()) {
    return;
  }
  const stale = docs.get(pageId);
  if (stale !== undefined) {
    // 同页二次挂载（前次未走 detach 的防泄漏兜底）：冲掉防抖尾后重建
    stale.sync();
    stale.destroy();
    docs.delete(pageId);
  }
  const yjs = new YjsEditor(pageId, {
    crdtUpdates: result.entries.map(
      (entry): CrdtUpdateEntry => ({
        opId: entry.opId,
        target: { table: 'page', id: entry.pageId },
        pageId: entry.pageId,
        updateB64: entry.updateB64,
      }),
    ),
    onOp: (payload) => {
      const uplink: CollabUplinkInput =
        payload.svFromB64 === undefined
          ? { pageId: payload.pageId, updateB64: payload.updateB64 }
          : { pageId: payload.pageId, updateB64: payload.updateB64, svFromB64: payload.svFromB64 };
      void window.septcats.collab.apply(uplink).catch((error: unknown) => {
        console.error('[collab] 上行失败（增量在本地 Y.Doc，未入账）', error);
      });
    },
  });
  yjs.attach(editor);
  docs.set(pageId, yjs);
}

/** PageView 关闭：flush 上行 → 本地销毁 → 通知 main 释放 hub 实例。 */
export function detachCollab(pageId: string): void {
  const yjs = docs.get(pageId);
  if (yjs === undefined) {
    return;
  }
  docs.delete(pageId);
  yjs.sync();
  yjs.destroy();
  void window.septcats.collab.detach({ pageId }).catch((error: unknown) => {
    console.error('[collab] detach 失败（main 侧由 LRU 兜底回收）', error);
  });
}
