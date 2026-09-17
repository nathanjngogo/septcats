/**
 * shared/collab.ts —— 协作（CRDT）IPC 的线上契约（TASK-T19-05 §0）。
 *
 * 纯协议层：只描述形状，不 import electron / node / @septcats/*（照 shared/sync.ts 纪律）。
 * `pageId` / `updateB64` 与 core `CrdtUpdatePayload` 契约逐字段对齐（base64 文本不透明透传）；
 * `opId` 是去重键（审计可回溯 op_ledger.op_id）。
 */

/**
 * 一条 CRDT 增量条目（main → renderer 下行 / attach 播种共用）。
 * 结构上兼容 core.CrdtUpdateEntry 的消费面子集（renderer 只读 pageId/updateB64）。
 */
export interface CollabUpdateEntry {
  opId: string;
  pageId: string;
  updateB64: string;
}

/**
 * collab:attach 的回包：以「快照 crdtUpdates 全部 + 其后到账 op」重建 Y.Doc 的种子集。
 * `ledgerHasCrdt`：attach 时 op_ledger 是否已有该页的任何 crdt_update op（真相层口径，
 * 不含快照区段）。true = 本页已有协作历史（远端种子已入账或曾经上行过），renderer
 * 据此**跳过 PM→Y 初始种子**（种子只在「该页账本 crdt op 数=0」时上行，T19-05-1
 * 根治「双空同开各自种子 → 文本重复」的迟到种子端半边）。
 */
export interface CollabAttachResult {
  entries: CollabUpdateEntry[];
  ledgerHasCrdt: boolean;
}

/** collab:apply 的入参（renderer 上行；与 core.CrdtUpdatePayload 同形）。 */
export interface CollabUplinkInput {
  pageId: string;
  updateB64: string;
  svFromB64?: string | undefined;
}
