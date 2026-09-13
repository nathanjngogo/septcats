/**
 * history.ts —— Op 级撤销栈（任务书 §0.3 / schema-v1 §5.3）。
 *
 * **撤销不直接回滚 PM 事务**：UI 栈记录的是「逆 op」（同 target、payload 取前值快照），
 * 逆 op 是正常的新事件（可同步）。本类内部维持一份 core.Projection，用 core.replay
 * 应用事件，从「应用前的实体状态」现场计算逆 op —— 因此 upsert→反向 patch、
 * delete→upsert 复活、reorder→反向 sort_key，全部有据可依。
 *
 * 逆 op（以及 redo 的正向 op）在**每次执行时重新盖 lamport/op_id**，保证
 * `c` 严格大于实体当前版本（否则 core.replay 会按 LWW 丢弃，撤销就 silent 失败）。
 */
import { Projection, replay, ulid } from '@septcats/core';
import type { ActorId, Entity, Op, OpKind } from '@septcats/core';
import { cloneJson } from './model';

export const MAX_UNDO_DEPTH = 100;

interface StackEntry {
  forward: Op[];
  inverse: Op[];
}

function cloneOps(ops: readonly Op[]): Op[] {
  return ops.map((op) => ({ ...op, payload: cloneJson(op.payload) }));
}

export class OpUndoStack {
  private readonly state = new Projection();
  private past: StackEntry[] = [];
  private future: StackEntry[] = [];
  private actor: ActorId | null = null;
  private at = 0;
  private counter = 0;

  constructor(private readonly depth: number = MAX_UNDO_DEPTH) {}

  /** 记录一批已提交 op（forward），并计算其逆 op 入栈；清空 redo 栈。 */
  apply(ops: Op[]): void {
    if (ops.length === 0) {
      return;
    }
    this.observe(ops);
    const inverse: Op[] = [];
    for (const op of ops) {
      const inv = this.invertOne(op);
      if (inv !== null) {
        inverse.push(inv);
      }
      this.execute([op]);
    }
    this.past.push({ forward: cloneOps(ops), inverse });
    while (this.past.length > this.depth) {
      this.past.shift();
    }
    this.future = [];
  }

  /** 返回逆 op（可外发）；栈空返回 null。 */
  undo(): Op[] | null {
    const entry = this.past.pop();
    if (entry === undefined) {
      return null;
    }
    const restore = this.restamp(entry.inverse);
    this.execute(restore);
    this.future.push({ forward: cloneOps(entry.forward), inverse: restore });
    return restore;
  }

  /** 返回重做的正 op（重新盖章）；redo 栈空返回 null。 */
  redo(): Op[] | null {
    const entry = this.future.pop();
    if (entry === undefined) {
      return null;
    }
    const forward = this.restamp(entry.forward);
    const inverse = this.invertAll(forward);
    this.execute(forward);
    this.past.push({ forward: cloneOps(forward), inverse });
    while (this.past.length > this.depth) {
      this.past.shift();
    }
    return forward;
  }

  /** 当前投影快照（测试/诊断用）。 */
  entities(): Entity[] {
    return this.state.entities();
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private observe(ops: readonly Op[]): void {
    const first = ops[0];
    if (this.actor === null && first !== undefined) {
      this.actor = first.actor;
    }
    for (const op of ops) {
      this.at = Math.max(this.at, op.at);
      this.counter = Math.max(this.counter, op.lamport.c);
    }
  }

  private nextCounter(): number {
    this.counter += 1;
    return this.counter;
  }

  private execute(ops: readonly Op[]): void {
    if (ops.length === 0) {
      return;
    }
    replay(ops, this.state);
    for (const op of ops) {
      this.counter = Math.max(this.counter, op.lamport.c);
    }
  }

  private buildOp(
    template: Op,
    kind: OpKind,
    payload: Record<string, unknown>,
    base?: number,
  ): Op {
    const actor = this.actor ?? template.actor;
    const op: Op = {
      op_id: ulid(this.at),
      lamport: { c: this.nextCounter(), d: actor },
      at: this.at,
      actor,
      target: { table: template.target.table, id: template.target.id },
      kind,
      payload,
    };
    if (base !== undefined) {
      op.base = base;
    }
    return op;
  }

  /** 逆 op 规则：upsert→反向 patch 旧字段快照；delete→upsert 复活；其余→字段快照 patch。 */
  private invertOne(op: Op): Op | null {
    const entity = this.state.get(op.target.table, op.target.id);
    switch (op.kind) {
      case 'upsert': {
        if (entity === null) {
          return this.buildOp(op, 'delete', {});
        }
        return this.buildOp(op, 'patch', cloneJson(entity.data), entity.version);
      }
      case 'delete': {
        if (entity === null) {
          return null;
        }
        // 应用前已是死（冗余删除：实体此前已被删过，本 op 是无变化事件）：
        // 撤销它绝不能把实体复活。
        if (entity.alive === 0) {
          return null;
        }
        // 复活：必须把 alive 显式拉回 1（entity.data 里此刻是 0）
        const payload = cloneJson(entity.data);
        payload['alive'] = 1;
        return this.buildOp(op, 'upsert', payload);
      }
      case 'patch':
      case 'move':
      case 'reorder': {
        if (entity === null) {
          return null;
        }
        const payload: Record<string, unknown> = {};
        for (const key of Object.keys(op.payload)) {
          if (key in entity.data) {
            payload[key] = cloneJson(entity.data[key]);
          }
        }
        if (Object.keys(payload).length === 0) {
          return null;
        }
        return this.buildOp(op, 'patch', payload, entity.version);
      }
      default: {
        const exhaustive: never = op.kind;
        throw new Error(`OpUndoStack：不支持的 op.kind ${String(exhaustive)}`);
      }
    }
  }

  private invertAll(ops: readonly Op[]): Op[] {
    const out: Op[] = [];
    for (const op of ops) {
      const inv = this.invertOne(op);
      if (inv !== null) {
        out.push(inv);
      }
    }
    return out;
  }

  /** 重新盖 lamport/op_id（撤销/重做都必须以「当前状态」为基准，弱判据会丢事件）。 */
  private restamp(ops: readonly Op[]): Op[] {
    const out: Op[] = [];
    for (const op of ops) {
      const entity = this.state.get(op.target.table, op.target.id);
      const isDelta = op.kind === 'patch' || op.kind === 'move' || op.kind === 'reorder';
      const base = isDelta && entity !== null ? entity.version : undefined;
      out.push(this.buildOp(op, op.kind, cloneJson(op.payload), base));
    }
    return out;
  }
}
