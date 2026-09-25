/**
 * dbgc.test.ts —— DB 面墓碑清除计划 planDbGc 全覆盖（T81-01）。
 *
 * 纯函数零 IO：只喂描述子、只断言 `{ deletable, held }`。
 *
 * 两条刻意的设计取向（报告 §5 有记）：
 * - 「历史 op 在场」不是扣留理由：op_ledger 不在判定面内（账本是真相层，删物化行不删账，
 *   重放仍能复现墓碑）→ 该行照常放行；账本逐字节不变由 desktop 侧执行路径断言；
 * - 「有收藏 / 有最近」也不是扣留理由：它们对墓碑不可见（列表均 `JOIN page … alive=1`）
 *   且无取消入口，扣留会让「彻底删除」永不完成 → 一律随页级联清除（desktop 侧断言）。
 */
import { describe, expect, it } from 'vitest';
import { planDbGc, type DbGcHoldReason, type DbGcTombstone } from '../src/gc';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const RETENTION = 30;

/** 墓碑描述子工厂：缺省 = purge 标记（彻底删除）、无子页、无锁。 */
function tomb(id: string, over: Partial<DbGcTombstone> = {}): DbGcTombstone {
  return {
    id,
    deletedAt: 0,
    tombstonedAt: NOW,
    childIds: [],
    locked: false,
    ...over,
  };
}

function plan(tombstones: readonly DbGcTombstone[], retentionDays = RETENTION) {
  return planDbGc(tombstones, NOW, { retentionDays });
}

function reasons(tombstones: readonly DbGcTombstone[]): Record<string, DbGcHoldReason> {
  const out: Record<string, DbGcHoldReason> = {};
  for (const held of plan(tombstones).held) {
    out[held.tombstone.id] = held.reason;
  }
  return out;
}

function ids(tombstones: readonly DbGcTombstone[], retentionDays = RETENTION): string[] {
  return plan(tombstones, retentionDays).deletable.map((t) => t.id);
}

describe('planDbGc 放行判据', () => {
  it('回收站软删未满 retentionDays → 扣留（retention），同批的 purge 标记照常放行', () => {
    const young = tomb('soft-young', { deletedAt: NOW - 10 * DAY, tombstonedAt: NOW - 10 * DAY });
    const purged = tomb('purged', { deletedAt: 0, tombstonedAt: NOW });
    expect(reasons([young, purged])).toEqual({ 'soft-young': 'retention' });
    expect(ids([young, purged])).toEqual(['purged']);
  });

  it('软删恰满 retentionDays（>= 语义）→ 放行', () => {
    const mature = tomb('soft-mature', { deletedAt: NOW - 30 * DAY, tombstonedAt: NOW - 30 * DAY });
    expect(ids([mature])).toEqual(['soft-mature']);
  });

  it('purge 墓碑（deletedAt=0）不受 retention 门约束：刚删即可清', () => {
    const justPurged = tomb('purge-now', { deletedAt: 0, tombstonedAt: NOW });
    expect(ids([justPurged])).toEqual(['purge-now']);
  });

  it('retentionDays=0 → 保留窗口不设限（软删恒视为满期）', () => {
    const young = tomb('soft-young', { deletedAt: NOW - 1, tombstonedAt: NOW - 1 });
    expect(ids([young], 0)).toEqual(['soft-young']);
  });

  it('deleted_at 无标记（旧 softDelete 残留）→ 扣留（unreachable，年龄不可判定）', () => {
    const legacy = tomb('legacy', { deletedAt: null, tombstonedAt: NOW - 90 * DAY });
    expect(reasons([legacy])).toEqual({ legacy: 'unreachable' });
  });

  it('有子页（活子页，非候选）→ 扣留（has-children），不留下悬空 parent_id', () => {
    const parent = tomb('parent', { childIds: ['live-child'] });
    expect(reasons([parent])).toEqual({ parent: 'has-children' });
  });

  it('父子同为墓碑且都过基础门 → 整棵一起放行', () => {
    const parent = tomb('parent', { childIds: ['child'] });
    const child = tomb('child');
    expect(ids([parent, child]).sort()).toEqual(['child', 'parent']);
  });

  it('子页被扣留（有锁）→ 父行连带扣留（has-children），子页报自身原因', () => {
    const parent = tomb('parent', { childIds: ['child'] });
    const child = tomb('child', { locked: true });
    expect(reasons([parent, child])).toEqual({ parent: 'has-children', child: 'locked' });
    expect(ids([parent, child])).toEqual([]);
  });

  it('有锁（page_lock / block_cipher 残留，异常态）→ 扣留（locked）', () => {
    expect(reasons([tomb('locked', { locked: true })])).toEqual({ locked: 'locked' });
  });

  it('判定优先级：unreachable > retention > locked > has-children', () => {
    // 同时命中 retention + locked → 报 retention
    const a = tomb('a', { deletedAt: NOW - 1, tombstonedAt: NOW - 1, locked: true });
    // 同时命中 locked + has-children → 报 locked
    const b = tomb('b', { locked: true, childIds: ['live'] });
    // 同时命中 unreachable + 其余 → 报 unreachable
    const c = tomb('c', { deletedAt: null, locked: true });
    expect(reasons([a, b, c])).toEqual({ a: 'retention', b: 'locked', c: 'unreachable' });
  });

  it('历史 op 在场（账本已有 delete op）→ 放行：op_ledger 不在判定面（删物化行不删账）', () => {
    // 该页的 purge delete op 早已进 op_ledger（真相层）；物化墓碑行是派生态，
    // 物理删除不丢真相（重放账本仍能复现「已删」语义），故不构成扣留理由。
    expect(ids([tomb('ledger-backed')])).toEqual(['ledger-backed']);
  });

  it('收藏 / 最近等本地派生态不在判定面 → 不影响放行（由执行侧级联清除）', () => {
    // planDbGc 的入参里没有 favorite/recent：它们对墓碑不可见（列表 join alive=1）
    // 且无取消入口，作扣留理由会让彻底删除永不完成，故一律随页级联删（见 desktop 用例）。
    expect(ids([tomb('favorited-tomb'), tomb('recent-tomb')])).toEqual(['favorited-tomb', 'recent-tomb']);
  });

  it('确定性与顺序保持：deletable / held 均按入参顺序', () => {
    const a = tomb('a');
    const b = tomb('b', { locked: true });
    const c = tomb('c');
    const result = plan([a, b, c]);
    expect(result.deletable.map((t) => t.id)).toEqual(['a', 'c']);
    expect(result.held.map((h) => h.tombstone.id)).toEqual(['b']);
  });

  it('空输入 → 空计划', () => {
    expect(plan([])).toEqual({ deletable: [], held: [] });
  });
});
