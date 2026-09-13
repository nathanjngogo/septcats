/**
 * seq.ts —— 编辑轮次聚合器（任务书 §0.3 / 计划书 §8.1）。
 *
 * 一次「编辑轮次」= debounce 300ms（或显式 flush / blur）→ **一个 batch**：
 * `opLedger.insert × N + 物化 upsert/patch × M` 由 apps 层在同一事务里写。
 * 本类只负责「把连续 onDocChange 折叠成一次 commit(ops)」，不碰 fs/db/IPC。
 *
 * - coalesce：debounce 窗口内只保留最后一版文档，窗口结束后与**上次提交的文档**做差分，
 *   因此同字段连续改动天然只留最后一条 op；
 * - commit 可以是 async；错误**不吞**（先回调 onError 再向 flush() 冒泡 reject），
 *   且失败时不推进 baseline，保证下次 flush 重试不会丢轮次。
 */
import type { ActorId, Lamport, Op } from '@septcats/core';
import { diffBlocks } from './diff';
import type { BlockDoc } from './model';

export const DEFAULT_DEBOUNCE_MS = 300;

export interface EditSessionOptions {
  actor: ActorId;
  commit: (ops: Op[]) => void | Promise<void>;
  debounceMs?: number;
  now: () => number;
  /** 提交失败回调（不吞错：调用后仍向 flush() 冒泡）。 */
  onError?: (error: unknown) => void;
  /** 初始文档（页面已有内容时必传，否则首轮会把整页当新增）。 */
  initial?: BlockDoc;
  /** 可选：注入 core.LamportClock.tick 覆写 lamport.c（默认用物化版本+1，见 diff.ts）。 */
  clock?: () => Lamport;
}

export class EditSession {
  private readonly actor: ActorId;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly commitFn: (ops: Op[]) => void | Promise<void>;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly clock: (() => Lamport) | undefined;

  private baseline: BlockDoc;
  private pending: BlockDoc | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastError: unknown = null;

  constructor(opts: EditSessionOptions) {
    this.actor = opts.actor;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = opts.now;
    this.commitFn = opts.commit;
    this.onError = opts.onError;
    this.clock = opts.clock;
    this.baseline = opts.initial ?? { pageId: '', blocks: [] };
  }

  /** 编辑器每次投影变化都调这里；窗口内自动 coalesce。 */
  onDocChange(doc: BlockDoc): void {
    this.pending = doc;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    if (this.debounceMs <= 0) {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** 立即提交待发差分（blur / Ctrl+S / 卸载前调用）。 */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.chain.then(() => this.runOnce());
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** 最近一次提交错误（诊断用；错误同时会冒泡给 flush 调用方）。 */
  get error(): unknown {
    return this.lastError;
  }

  /** 当前 baseline（最近一次成功提交后的文档）。 */
  get committed(): BlockDoc {
    return this.baseline;
  }

  /** 取消挂起的 debounce（不提交）。 */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private async runOnce(): Promise<void> {
    const pending = this.pending;
    if (pending === null) {
      return;
    }
    this.pending = null;
    const ops = this.stampClock(diffBlocks(this.baseline, pending, { actor: this.actor, now: this.now() }));
    if (ops.length === 0) {
      this.baseline = pending;
      return;
    }
    try {
      await this.commitFn(ops);
      this.baseline = pending;
      this.lastError = null;
    } catch (error) {
      this.lastError = error;
      this.pending = pending;
      this.onError?.(error);
      throw error;
    }
  }

  /** 注入 clock 时覆写 lamport.c（同轮次内逐个 tick，保证严格递增）。 */
  private stampClock(ops: Op[]): Op[] {
    const clock = this.clock;
    if (clock === undefined) {
      return ops;
    }
    return ops.map((op) => {
      const lamport = clock();
      return { ...op, lamport: { c: lamport.c, d: lamport.d } };
    });
  }
}
