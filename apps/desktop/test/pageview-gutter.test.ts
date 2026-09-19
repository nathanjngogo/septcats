/**
 * pageview-gutter.test.ts —— TASK-T33-01 装订线几何门禁（对 CSS 源面做 token 算术断言，
 * 与 layout-invariants / ui-interaction-audit 同范式）。
 *
 * 背景：块手柄簇（＋ + ⋮⋮，整簇 58px）旧实现挂在 .pv-body 左缘外 40px 的 24px 窄轨上，
 * 簇溢出窄轨压进行首文字（PM 探针实测 gutter = −18，重叠 18×21px）。修法（§1.5 口径 A
 * 「编辑器内容容器左内边距」）：.pv-body padding-left 预留「簇宽 + gutter(12)」，.pv-handle
 * 以 left:0 / width:max-content 锚进装订线，簇右缘 = 簇宽，确定性落在文本左缘（padding-left）
 * 之外。jsdom 不做真实布局，真机矩形量测由 PM 复跑 docs/mockups/probe-text-overlap.mjs。
 *
 * 不变量（TASK-T33-01 §1/§2）：
 * ① gutter = padding-left − 簇宽 ≥ 8（实际 = --sc-space-md = 12，落在建议区间 12–16）；
 * ② 手柄命中区 ≥ 24×24（--sc-size-control-sm = 28，未靠改窄手柄糊弄）；
 * ③ 窗口宽 640–1600 全区间：簇完整落在 .pv-body 内（无外溢裁剪）、正文列宽为正、
 *    手柄右缘 < 文本左缘（overlap = 0）、hover 热区不覆盖文本；
 * ④ 缩进块（列表 padding-left = --sc-space-xl / 引用 = --sc-space-md）gutter 只增不减。
 * 所有数值从 tokens.css / PageView.css / editor.css 现场解析求值，token 改值即测试跟随；
 * CSS 结构改坏（如 padding-left 表达式丢项、.pv-handle 锚点回退）直接红。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = join(here, '..', 'src', 'renderer', 'src');
const EDITOR_SRC = join(here, '..', '..', '..', 'packages', 'editor', 'src', 'react');
const UI_SRC = join(here, '..', '..', '..', 'packages', 'ui', 'src');

const read = (path: string): string => readFileSync(path, 'utf8');

const pageViewCss = read(join(RENDERER_SRC, 'pages', 'PageView.css'));
const editorCss = read(join(EDITOR_SRC, 'editor.css'));
const tokensCss = read(join(UI_SRC, 'tokens.css'));

/** 取 `selector { ... }` 规则体（layout-invariants.test.ts 同款；选择器内空白归一为 \s+，
 *  兼容组合选择器换行，如 `.sc-blockcontrol__handle,\n.sc-blockcontrol__add`）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

/** tokens.css 的 `--sc-x: value;` → Map（只取 :root 段即可，spacing/layout 无深色分值）。 */
function parseTokens(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of css.matchAll(/--sc-([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined && !map.has(name)) map.set(name, value.trim());
  }
  return map;
}

const tokens = parseTokens(tokensCss);

/** token 值求值：px 字面量 / calc(嵌套 var 表达式) → 数字（px）。只支持本仓 calc 的 + - 场景。 */
function resolveToken(name: string, seen = new Set<string>()): number {
  const raw = tokens.get(name);
  expect(raw, `tokens.css 缺少 --sc-${name}`).toBeDefined();
  return evalExpr(raw as string, seen);
}

/**
 * 安全算术求值（无 eval）：先把 var(--x) 引用整体替换为数值（var 名含连字符，
 * 必须先替换再分项），再按 + / − 拆 px 项求和。
 */
function evalExpr(expr: string, seen: Set<string>): number {
  let flat = expr.replace(/\s+/g, ' ').trim();
  const calcWrap = /^calc\((.*)\)$/.exec(flat);
  if (calcWrap !== null) {
    flat = calcWrap[1] ?? flat;
  }
  const substituted = flat.replace(/var\(--sc-([a-z0-9-]+)\)/g, (_m, name: string) => {
    expect(seen.has(name), `token 循环引用：--sc-${name}`).toBe(false);
    seen.add(name);
    const value = resolveToken(name, seen);
    seen.delete(name);
    return `${value}px`;
  });
  const terms = substituted.match(/[+-]?\s*\d+(?:\.\d+)?px/g) ?? [];
  expect(terms.length, `无法求值的表达式「${expr}」→「${substituted}」`).toBeGreaterThan(0);
  let sum = 0;
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    sum += sign * Number(term.replace(/^[+-]?\s*/, '').replace(/px$/, ''));
  }
  return sum;
}

/** 从规则体取 `prop: <值>`（var / calc 均可，可跨行）并求值。 */
function calcProp(body: string, prop: string): number {
  const m = new RegExp(`${prop}:\\s*([^;]+);`).exec(body);
  expect(m, `规则体缺少 ${prop}`).not.toBeNull();
  return evalExpr(m?.[1] as string, new Set());
}

// —— ① 装订线与簇宽（全部从源面解析） ——————————————————————————

const pvBodyRule = ruleBody(pageViewCss, '.pv-body');
const pvHandleRule = ruleBody(pageViewCss, '.pv-handle');
const controlRule = ruleBody(editorCss, '.sc-blockcontrol__handle, .sc-blockcontrol__add');
const clusterRule = ruleBody(editorCss, '.sc-blockcontrol');

const PAD = calcProp(pvBodyRule, 'padding-left');
// ＋ 与 ⋮⋮ 同一规则体、同一尺寸 token（--sc-size-control-sm），无各自 width 覆写
const CONTROL_W = calcProp(controlRule, 'width');
const GAP = calcProp(clusterRule, 'gap'); // --sc-space-xxs
const CLUSTER = CONTROL_W + GAP + CONTROL_W; // ＋ + 间距 + ⋮⋮（28+2+28 = 58）
const GUTTER = PAD - CLUSTER;

const MEASURE = resolveToken('space-editor-measure');
const SIDEBAR = resolveToken('layout-sidebar');
const PV_ROOT_PAD = resolveToken('space-gutter'); // .pv-root 水平内边距（两侧）
const LIST_INDENT = resolveToken('space-xl');
const QUOTE_INDENT = resolveToken('space-md');

describe('T33-01 装订线几何：CSS 结构锚点', () => {
  it('.pv-body 以 padding-left 预留「簇 + gutter」（实现口径 = 内容容器左内边距）', () => {
    expect(pvBodyRule).toContain('padding-left');
    expect(pvBodyRule).toContain('calc(');
  });

  it('.pv-handle 锚进装订线：left:0 + width:max-content（簇右缘 = 簇宽，确定性在文本外）', () => {
    expect(pvHandleRule).toContain('left: 0');
    expect(pvHandleRule).toContain('width: max-content');
    // 旧悬挂实现不得回归：窄轨 + 负偏移会把簇溢出压回文本上
    expect(pvHandleRule).not.toContain('--sc-space-gutter');
  });

  it('手柄命中区 ≥ 24×24（a11y，未靠改窄手柄糊弄）', () => {
    expect(CONTROL_W).toBeGreaterThanOrEqual(24);
    const h = /height:\s*var\(--sc-size-control-sm\)/.exec(controlRule);
    expect(h, '手柄/新增按钮 height 须为 --sc-size-control-sm').not.toBeNull();
  });

  it('gutter = padding-left − 簇宽 ≥ 8（建议区间 12–16）', () => {
    expect(CLUSTER).toBeGreaterThan(0);
    expect(GUTTER).toBeGreaterThanOrEqual(8);
    expect(GUTTER).toBeGreaterThanOrEqual(12);
    expect(GUTTER).toBeLessThanOrEqual(16);
  });
});

describe('T33-01 装订线几何：窗口宽 640–1600 全区间（最坏口径：侧栏展开）', () => {
  // 布局模型（与 .pv-root/.pv-body 现规则一致）：主区可用宽 = W − 侧栏 − 2×pv-root 水平
  // padding；.pv-body 取 min(measure, 可用宽)，border-box（tokens reset box-sizing）。
  // 以 .pv-body 左缘为原点：簇 [0, CLUSTER]，文本左缘 = PAD。侧栏折叠只会更宽（保守）。
  const WIDTHS = [640, 900, 1280, 1600];

  for (const W of WIDTHS) {
    it(`winW=${W}：簇在列内、文本列宽为正、overlap=false、热区不盖文本`, () => {
      const available = W - SIDEBAR - 2 * PV_ROOT_PAD;
      const bodyW = Math.min(MEASURE, available);
      expect(bodyW, '窗内放不下 .pv-body（模型前提失效）').toBeGreaterThan(CLUSTER);

      const textWidth = bodyW - PAD;
      expect(textWidth, '装订线吃掉整个正文列').toBeGreaterThan(0);

      // 手柄矩形 [0, CLUSTER] × 文本矩形 [PAD, bodyW]
      const overlapX = Math.max(0, Math.min(CLUSTER, bodyW) - Math.max(0, PAD));
      expect(overlapX).toBe(0);
      expect(PAD - CLUSTER).toBeGreaterThanOrEqual(8); // gutter ≥ 8

      // hover 热区 = 簇矩形本身（width:max-content，无溢出），右缘不得触达文本
      expect(CLUSTER).toBeLessThan(PAD);
    });
  }
});

describe('T33-01 装订线几何：缩进块（§2.②）', () => {
  it('列表/引用缩进把文本推得更右，gutter 只增不减（≥ 基线 12）', () => {
    const gutterList = PAD + LIST_INDENT - CLUSTER;
    const gutterQuote = PAD + QUOTE_INDENT - CLUSTER;
    expect(gutterList).toBeGreaterThanOrEqual(GUTTER);
    expect(gutterQuote).toBeGreaterThanOrEqual(GUTTER);
    expect(gutterQuote).toBeGreaterThanOrEqual(8);
  });
});
