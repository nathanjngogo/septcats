/**
 * assetGc.test.ts —— 附件孤儿回收纯逻辑（T83-02）。
 *
 * `planAssetGc` 零 IO：引用集与磁盘列举都由调用方传入，这里只钉判定与顺序。
 * 覆盖：有引用 / 无引用 / 保护期 / 扩展名变体引用 / 空目录 / 非内容寻址名 / 引用面失明。
 */
import { describe, expect, it } from 'vitest';
import { planAssetGc, type AssetDiskFile } from '../src/gc';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

/** 构造 64 位小写 hex（确定性，避免手写长串出错）。 */
function hash(seed: string): string {
  const table = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 64; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i * 7;
    out += table[code % 16] ?? '0';
  }
  return out;
}

/** 磁盘条目（mtime 缺省=远早于保护期，故不受保护期门约束）。 */
function file(name: string, mtimeMs = NOW - 400 * DAY, bytes = 10): AssetDiskFile {
  return { name, bytes, mtimeMs };
}

const REFERENCED = hash('referenced');
const ORPHAN = hash('orphan');
const RECENT = hash('recent');
const VARIANT = hash('variant');

describe('planAssetGc 判定（T83-02）', () => {
  it('无引用（孤儿）→ 放行；有引用 → 扣留 referenced', () => {
    const plan = planAssetGc(new Set([REFERENCED]), [file(REFERENCED), file(ORPHAN)], NOW, {
      retentionDays: 30,
    });
    expect(plan.deletable.map((f) => f.name)).toEqual([ORPHAN]);
    expect(plan.held).toEqual([{ file: file(REFERENCED), reason: 'referenced' }]);
  });

  it('扩展名变体引用：`<hash>.png` 命中 DB 里的纯哈希引用 → 同归一个哈希，全部扣留', () => {
    // DB 里存的是 file_id = 纯哈希；盘上是内容寻址的带扩展名变体（findHashFile 的前缀口径）
    const plan = planAssetGc(
      new Set([VARIANT]),
      [file(`${VARIANT}.png`), file(VARIANT), file(`${VARIANT}.jpg`)],
      NOW,
      { retentionDays: 30 },
    );
    expect(plan.deletable).toEqual([]);
    expect(plan.held.map((h) => h.reason)).toEqual(['referenced', 'referenced', 'referenced']);
  });

  it('保护期：mtime 距今未满 retentionDays → 扣留 recent（即便无引用）', () => {
    const plan = planAssetGc(new Set(), [file(RECENT, NOW - 1 * DAY), file(ORPHAN, NOW - 31 * DAY)], NOW, {
      retentionDays: 30,
    });
    expect(plan.deletable.map((f) => f.name)).toEqual([ORPHAN]);
    expect(plan.held).toEqual([{ file: file(RECENT, NOW - 1 * DAY), reason: 'recent' }]);
  });

  it('保护期 = 0 时不过滤 mtime；mtime 在未来（时钟回拨）仍扣留', () => {
    const future = file(RECENT, NOW + 10 * DAY);
    const noGate = planAssetGc(new Set(), [future], NOW, { retentionDays: 0 });
    expect(noGate.deletable.map((f) => f.name)).toEqual([RECENT]);

    const gated = planAssetGc(new Set(), [future], NOW, { retentionDays: 30 });
    expect(gated.held[0]?.reason).toBe('recent');
  });

  it('边界：mtime 恰好等于保护期下沿 → 放行（>= 语义）', () => {
    const plan = planAssetGc(new Set(), [file(ORPHAN, NOW - 30 * DAY)], NOW, { retentionDays: 30 });
    expect(plan.deletable.map((f) => f.name)).toEqual([ORPHAN]);
  });

  it('空目录 → 两边都空', () => {
    const plan = planAssetGc(new Set(), [], NOW, { retentionDays: 30 });
    expect(plan.deletable).toEqual([]);
    expect(plan.held).toEqual([]);
  });

  it('非内容寻址名（无法判归属）→ 扣留 unknown，绝不删', () => {
    const plan = planAssetGc(new Set(), [file('readme.txt'), file('a'.repeat(63)), file(`${'a'.repeat(65)}`)], NOW, {
      retentionDays: 30,
    });
    expect(plan.deletable).toEqual([]);
    expect(plan.held.map((h) => h.reason)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('引用面失明（有锁页密文）→ 未命中引用的文件一律扣留 blind；已引用者仍报 referenced', () => {
    const plan = planAssetGc(new Set([REFERENCED]), [file(REFERENCED), file(ORPHAN), file('readme.txt')], NOW, {
      retentionDays: 30,
      referencesComplete: false,
    });
    expect(plan.deletable).toEqual([]);
    expect(plan.held.map((h) => h.reason)).toEqual(['referenced', 'blind', 'blind']);
  });

  it('确定性：两侧都保持入参顺序', () => {
    const input = [file(ORPHAN), file(REFERENCED), file(hash('c')), file(RECENT, NOW - 1 * DAY)];
    const plan = planAssetGc(new Set([REFERENCED]), input, NOW, { retentionDays: 30 });
    expect(plan.deletable.map((f) => f.name)).toEqual([ORPHAN, hash('c')]);
    expect(plan.held.map((h) => h.file.name)).toEqual([REFERENCED, RECENT]);
  });

  it('大小写敏感（与 findHashFile/url.host 同口径）：大写名解析不出哈希 → unknown 扣留', () => {
    const plan = planAssetGc(new Set([REFERENCED]), [file(REFERENCED.toUpperCase())], NOW, {
      retentionDays: 30,
    });
    expect(plan.deletable).toEqual([]);
    expect(plan.held[0]?.reason).toBe('unknown');
  });
});
