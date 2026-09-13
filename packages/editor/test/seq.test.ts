import { afterEach, describe, expect, it, vi } from 'vitest';
import { LamportClock } from '@septcats/core';
import type { Op } from '@septcats/core';
import { inlineDoc, text, type Block, type BlockDoc } from '../src/model';
import { EditSession } from '../src/seq';
import { FIXTURE_NOW, FIXTURE_PAGE_ID } from './fixtures/blocks';

const ACTOR = 'aaaa0001';
const BLOCK_ID = 'blkseqtest00000000000001';

function docWith(value: string, version = 1): BlockDoc {
  const block: Block = {
    id: BLOCK_ID,
    page_id: FIXTURE_PAGE_ID,
    type: 'paragraph',
    props: {},
    content: inlineDoc([text(value)]),
    parent_id: null,
    sort_key: 'A00000000',
    alive: 1,
    version,
    last_edited: FIXTURE_NOW,
  };
  return { pageId: FIXTURE_PAGE_ID, blocks: [block] };
}

function contentOf(op: Op | undefined): unknown {
  return op?.payload['content'];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('EditSession：一轮编辑 = 一次 batch', () => {
  it('flush 出的 ops 与 diffBlocks 完全一致（含 lamport/base）', async () => {
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      now: () => FIXTURE_NOW,
      initial: docWith('a', 3),
    });
    session.onDocChange(docWith('ab', 3));
    await session.flush();

    expect(commits).toHaveLength(1);
    const ops = commits[0] ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('patch');
    expect(contentOf(ops[0])).toEqual(inlineDoc([text('ab')]));
    expect(ops[0]?.lamport).toEqual({ c: 4, d: ACTOR });
    expect(ops[0]?.base).toBe(3);
    expect(session.committed).toEqual(docWith('ab', 3));
  });

  it('debounce 窗口内 coalesce：3 次改动只提交 1 次，且只留最后一版', async () => {
    vi.useFakeTimers();
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      debounceMs: 300,
      now: () => FIXTURE_NOW,
      initial: docWith('a'),
    });
    session.onDocChange(docWith('ab'));
    session.onDocChange(docWith('abc'));
    session.onDocChange(docWith('abcd'));
    expect(commits).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(commits).toHaveLength(1);
    expect(contentOf(commits[0]?.[0])).toEqual(inlineDoc([text('abcd')]));
  });

  it('不同轮次各发一次 batch（第 2 轮相对第 1 轮做差）', async () => {
    vi.useFakeTimers();
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      debounceMs: 300,
      now: () => FIXTURE_NOW,
      initial: docWith('a'),
    });
    session.onDocChange(docWith('ab'));
    await vi.advanceTimersByTimeAsync(300);
    session.onDocChange(docWith('abc'));
    await vi.advanceTimersByTimeAsync(300);

    expect(commits).toHaveLength(2);
    expect(contentOf(commits[0]?.[0])).toEqual(inlineDoc([text('ab')]));
    expect(contentOf(commits[1]?.[0])).toEqual(inlineDoc([text('abc')]));
    expect(commits[1]?.[0]?.base).toBe(1);
    expect(commits[1]?.[0]?.lamport.c).toBe(2);
  });

  it('无变化 → 0 op、不 commit', async () => {
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      now: () => FIXTURE_NOW,
      initial: docWith('same'),
    });
    session.onDocChange(docWith('same'));
    await session.flush();
    expect(commits).toHaveLength(0);
  });

  it('commit reject → onError 回调 + flush 冒泡，且不推进 baseline（重试能补发）', async () => {
    const errors: unknown[] = [];
    let attempts = 0;
    const session = new EditSession({
      actor: ACTOR,
      commit: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('db 事务失败');
        }
      },
      now: () => FIXTURE_NOW,
      initial: docWith('a'),
      onError: (error) => {
        errors.push(error);
      },
    });
    session.onDocChange(docWith('ab'));
    await expect(session.flush()).rejects.toThrow('db 事务失败');
    expect(errors).toHaveLength(1);
    expect(session.committed).toEqual(docWith('a'));
    expect(session.error).toBeInstanceOf(Error);

    await session.flush();
    expect(attempts).toBe(2);
    expect(session.committed).toEqual(docWith('ab'));
    expect(session.error).toBeNull();
  });

  it('注入 clock 时覆写 lamport.c（同轮次严格递增）', async () => {
    const lamport = new LamportClock(ACTOR, 40);
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      now: () => FIXTURE_NOW,
      initial: { pageId: FIXTURE_PAGE_ID, blocks: [] },
      clock: () => lamport.tick(),
    });
    session.onDocChange(docWith('x', 1));
    await session.flush();
    const ops = commits[0] ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]?.lamport.c).toBe(41);
  });

  it('cancel 丢弃挂起轮次', async () => {
    const commits: Op[][] = [];
    const session = new EditSession({
      actor: ACTOR,
      commit: (ops) => {
        commits.push(ops);
      },
      debounceMs: 300,
      now: () => FIXTURE_NOW,
      initial: docWith('a'),
    });
    session.onDocChange(docWith('ab'));
    session.cancel();
    await session.flush();
    expect(commits).toHaveLength(0);
  });
});
