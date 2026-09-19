/**
 * anchor.test.ts —— T36-01 纯几何层用例（jsdom 无布局，几何断言在纯函数层做数值化）。
 *
 * §2.1① 手柄对齐：簇 centerY = 首行行框 centerY（≤1px），多行块必须按首行。
 * §2.1②/2.2 换块型锚定：对全部 7 块型两两组合（段落/标题1/2/3/列表/引用/代码块），
 * 用**独立实现的布局模型**（块堆叠 + CSS margin 坍缩）验证补偿后首行行框中心位移 ≤1px。
 * 模型常数 = editor.css + Chromium UA 的实际值（UA margin 不在 CSS 里，此处显式钉住）。
 */
import { describe, expect, it } from 'vitest';
import {
  firstLineAnchorCompensation,
  firstLineRectOf,
  handleTopForFirstLine,
} from '../src/react/anchor';

/** 块型几何表：lineH = DESIGN 字阶 × 行高；pt/pb/mt/mb = editor.css + UA 实际值。 */
interface BlockGeo {
  lineH: number;
  pt: number;
  pb: number;
  mt: number;
  mb: number;
}

const GEO: Record<string, BlockGeo> = {
  paragraph: { lineH: 28, pt: 4, pb: 4, mt: 16, mb: 16 }, // mt/mb：UA 1em(16px)
  heading1: { lineH: 36.4, pt: 4, pb: 2, mt: 12, mb: 0 },
  heading2: { lineH: 29.7, pt: 4, pb: 2, mt: 12, mb: 0 },
  heading3: { lineH: 25.2, pt: 4, pb: 2, mt: 8, mb: 0 },
  list: { lineH: 28, pt: 0, pb: 0, mt: 0, mb: 0 },
  quote: { lineH: 28, pt: 0, pb: 0, mt: 0, mb: 0 },
  code: { lineH: 22.4, pt: 12, pb: 12, mt: 14, mb: 14 }, // mt/mb：UA 1em(14px)
};

/** CSS 邻接 margin 坍缩（正取 max、负相加；CSS2 §8.3.1）——测试侧独立实现。 */
function collapsed(mb: number, mt: number): number {
  return mt < 0 || mb < 0 ? mb + mt : Math.max(mb, mt);
}

/** 两块页面布局模型：prev 块（已含自身 padding/行框）+ 当前块，返回当前块首行行框中心。 */
function centerOfSecond(prev: BlockGeo, cur: BlockGeo): number {
  const prevBottom = prev.pt + prev.lineH + prev.pb;
  const top = prevBottom + collapsed(prev.mb, cur.mt);
  return top + cur.pt + cur.lineH / 2;
}

describe('手柄簇与首行行框垂直居中（T36-01 §1.1）', () => {
  const CLUSTER = 28; // --sc-size-control-sm：＋/⋮⋮ 各 28
  const BODY_TOP = 40;

  it('单行各块型（段落/标题/列表/引用/代码）：簇中心 = 首行行框中心，偏差 0（≤1px）', () => {
    for (const geo of Object.values(GEO)) {
      const line = { top: 100, bottom: 100 + geo.lineH };
      const top = handleTopForFirstLine(line, CLUSTER, BODY_TOP);
      const clusterCenter = top + BODY_TOP + CLUSTER / 2;
      expect(Math.abs(clusterCenter - (line.top + line.bottom) / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('多行块按首行对齐：3 行段落（块盒 h=84）的簇中心钉在首行中心，绝不用「块高/2」', () => {
    const firstLine = { top: 100, bottom: 128 };
    const top = handleTopForFirstLine(firstLine, CLUSTER, BODY_TOP);
    const clusterCenter = top + BODY_TOP + CLUSTER / 2;
    expect(Math.abs(clusterCenter - 114)).toBeLessThanOrEqual(1); // 首行中心
    // 若错按整块居中（块盒 {100,184} 中心 142），簇中心会差 28px——钉死不复现
    expect(Math.abs(clusterCenter - 142)).toBeGreaterThan(1);
  });

  it('亚像素行框（文本盒 21px vs 行框 28px 同心）：对齐偏差仍 ≤1px', () => {
    // coordsAtPos 光标盒与文本节点盒同心（半-leading 对称），盒高不同不影响中心
    const line = { top: 75, bottom: 96 };
    const top = handleTopForFirstLine(line, CLUSTER, BODY_TOP);
    const clusterCenter = top + BODY_TOP + CLUSTER / 2;
    expect(Math.abs(clusterCenter - 85.5)).toBeLessThanOrEqual(1);
  });
});

describe('换块型首行锚定补偿（T36-01 §1.2，全 7 块型两两组合）', () => {
  const names = Object.keys(GEO);

  it('中段块（前邻=段落，mb=16）：换型后首行行框中心位移 ≤1px（≥2 块型，实际 42 组合）', () => {
    for (const aName of names) {
      for (const bName of names) {
        if (aName === bName) {
          continue;
        }
        const a = GEO[aName]!;
        const b = GEO[bName]!;
        const before = centerOfSecond(a, a);
        const after = centerOfSecond(a, b);
        const comp = firstLineAnchorCompensation({
          centerBefore: before,
          centerAfter: after,
          paddingTopAfter: b.pt,
          marginTopAfter: b.mt,
          marginBottomPrev: a.mb,
        });
        const final = centerOfSecond(a, { ...b, pt: comp.paddingTop, mt: comp.marginTop });
        expect(Math.abs(final - before), `${aName}→${bName} 残差 ${final - before}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('前邻=标题/列表/代码（mb=0/14）等任意前邻：残差同样 ≤1px', () => {
    for (const prevName of names) {
      const prev = GEO[prevName]!;
      for (const bName of names) {
        const b = GEO[bName]!;
        const before = centerOfSecond(prev, prev);
        const after = centerOfSecond(prev, b);
        const comp = firstLineAnchorCompensation({
          centerBefore: before,
          centerAfter: after,
          paddingTopAfter: b.pt,
          marginTopAfter: b.mt,
          marginBottomPrev: prev.mb,
        });
        const final = centerOfSecond(prev, { ...b, pt: comp.paddingTop, mt: comp.marginTop });
        expect(Math.abs(final - before), `${prevName}前邻 ${bName} 残差 ${final - before}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('首块（margin 与父级坍缩传播，mb 记 0）：quote→H1 等 padding 截断场景残差 ≤1px', () => {
    for (const aName of names) {
      for (const bName of names) {
        if (aName === bName) {
          continue;
        }
        const a = GEO[aName]!;
        const b = GEO[bName]!;
        // 首块模型：固定参考线 R=0，坍缩值 = collapse(0, mt)（父 margin=0，正负同式=mt）
        const centerOfFirst = (g: BlockGeo): number => collapsed(0, g.mt) + g.pt + g.lineH / 2;
        const before = centerOfFirst(a);
        const after = centerOfFirst(b);
        const comp = firstLineAnchorCompensation({
          centerBefore: before,
          centerAfter: after,
          paddingTopAfter: b.pt,
          marginTopAfter: b.mt,
          marginBottomPrev: 0,
        });
        const final = centerOfFirst({ ...b, pt: comp.paddingTop, mt: comp.marginTop });
        expect(Math.abs(final - before), `${aName}→${bName} 残差 ${final - before}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('位移在亚像素阈内时不产出补偿（不落无谓 inline style）', () => {
    const comp = firstLineAnchorCompensation({
      centerBefore: 100,
      centerAfter: 100.2,
      paddingTopAfter: 4,
      marginTopAfter: 12,
      marginBottomPrev: 16,
    });
    expect(comp).toEqual({ paddingTop: 4, marginTop: 12 });
  });
});

describe('firstLineRectOf 量测（T36-01 §1.1）', () => {
  const view = (impl: (pos: number) => { top: number; bottom: number }) => ({ coordsAtPos: impl });

  it('非叶子块取 pos+1 的行框盒（首行）', () => {
    const seen: number[] = [];
    const rect = firstLineRectOf(
      view((pos) => {
        seen.push(pos);
        return { top: 10, bottom: 38 };
      }),
      { isLeaf: false },
      7,
    );
    expect(rect).toEqual({ top: 10, bottom: 38 });
    expect(seen).toEqual([8]);
  });

  it('叶子块不量测（divider/image 无内容行框）', () => {
    const rect = firstLineRectOf(
      view(() => {
        throw new Error('不应调用');
      }),
      { isLeaf: true },
      7,
    );
    expect(rect).toBeNull();
  });

  it('coordsAtPos 抛错 / 返回非有限值 → null（调用方退化整块盒）', () => {
    expect(
      firstLineRectOf(
        view(() => {
          throw new Error('pos out of bounds');
        }),
        { isLeaf: false },
        7,
      ),
    ).toBeNull();
    expect(
      firstLineRectOf(view(() => ({ top: Number.NaN, bottom: 0 })), { isLeaf: false }, 7),
    ).toBeNull();
  });
});
