/**
 * contrast.test.ts —— 对比度红线真门禁（TASK-T20-01 §1）。
 *
 * 背景：DESIGN.md 曾自称「对比度红线（CI lint 验证）」但仓库里并不存在该
 * lint（PM 实测发现）。本文件把这条红线变成真的：
 *  - 真源：仓库根 DESIGN.md（front matter 浅色 + 「深色主题映射」表深色）；
 *  - 产物：packages/ui/src/tokens.css（先断言与 DESIGN.md 逐 token 一致，防手改产物）；
 *  - 断言（两主题）：ink / ink-secondary / ink-faint 对 canvas / surface /
 *    surface-raised 全 ≥4.5；on-accent 对 accent、accent / danger / success
 *    对 canvas 全 ≥4.5；失败信息打印「token 对 + 实测比值 + 阈值」；
 *  - ink-faint ≠ ink-secondary（防两档灰合并，层次塌陷）。
 * WCAG 相对亮度公式与 tokens/build-tokens.mjs 的提取口径一致：hex → sRGB →
 * 线性化 → L = 0.2126R + 0.7152G + 0.0722B；比值 = (亮 + 0.05) / (暗 + 0.05)。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';

const THRESHOLD = 4.5;

// --- WCAG -------------------------------------------------------------------

function hexToRgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  expect(m, `非法颜色值：${hex}`).not.toBeNull();
  const int = Number.parseInt(m![1]!, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(fg: string, bg: string): number {
  const lf = luminance(fg);
  const lb = luminance(bg);
  const [hi, lo] = lf >= lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

// --- DESIGN.md / tokens.css 解析 ---------------------------------------------

interface ThemeColors {
  readonly [name: string]: string;
}

function parseFrontMatterColors(md: string): ThemeColors {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  expect(m, 'DESIGN.md 缺少 front matter').not.toBeNull();
  const colors: Record<string, string> = {};
  let inColors = false;
  for (const line of m![1]!.split(/\r?\n/)) {
    if (/^colors:\s*(#.*)?$/.test(line)) {
      inColors = true;
      continue;
    }
    if (inColors) {
      // 子层级（2 空格缩进）才算 colors 键；回到顶格即结束
      if (/^\S/.test(line)) break;
      const kv = /^\s{2}([a-z-]+):\s*"#([0-9a-fA-F]{6})"\s*(?:#.*)?$/.exec(line);
      if (kv !== null) colors[kv[1]!] = `#${kv[2]}`;
    }
  }
  return colors;
}

/** 「深色主题映射」表：{ token → dark 值 }。 */
function parseDarkTable(md: string): ThemeColors {
  const heading = md.indexOf('### 深色主题映射');
  expect(heading, 'DESIGN.md 缺少「深色主题映射」小节').toBeGreaterThanOrEqual(0);
  const dark: Record<string, string> = {};
  for (const line of md.slice(heading).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) {
      if (Object.keys(dark).length > 0) break;
      continue;
    }
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 3 || cells[0] === 'token') continue;
    if (/^#([0-9a-fA-F]{6})$/.test(cells[2] ?? '')) dark[cells[0]!] = cells[2]!;
  }
  return dark;
}

/** tokens.css：:root（浅色）与 [data-theme="dark"]（深色）两个块里的 --sc-color-*。 */
function parseTokensCss(css: string): { light: ThemeColors; dark: ThemeColors } {
  function blockOf(selector: string): string {
    const idx = css.indexOf(selector);
    expect(idx, `tokens.css 缺少 ${selector} 块`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }
  function colorsOf(block: string): ThemeColors {
    const colors: Record<string, string> = {};
    for (const m of block.matchAll(/--sc-color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      colors[m[1]!] = m[2]!;
    }
    return colors;
  }
  return { light: colorsOf(blockOf(':root')), dark: colorsOf(blockOf('[data-theme="dark"]')) };
}

// --- 断言 ---------------------------------------------------------------------

const TEXT_TOKENS = ['ink', 'ink-secondary', 'ink-faint'] as const;
// T34-01：content（内容区背景 #FFFFFF/#191919）纳入门禁平面——采样表的文字色必须在其真实落点上达标
const BACKDROPS = ['canvas', 'surface', 'surface-raised', 'content'] as const;
const STATUS_ON_CANVAS = ['accent', 'danger', 'success'] as const;

describe('对比度红线（DESIGN.md ↔ tokens.css ↔ WCAG AA）', () => {
  const md = readFileSync(resolvePkgFile('../../DESIGN.md'), 'utf8');
  const lightFromMd = parseFrontMatterColors(md);
  const darkFromMd = parseDarkTable(md);
  const fromCss = parseTokensCss(readFileSync(resolvePkgFile('src/tokens.css'), 'utf8'));

  const themes = {
    light: { fromMd: lightFromMd, fromCss: fromCss.light },
    dark: { fromMd: darkFromMd, fromCss: fromCss.dark },
  } as const;

  function ratio(theme: 'light' | 'dark', fg: string, bg: string): number {
    return contrastRatio(themes[theme].fromCss[fg]!, themes[theme].fromCss[bg]!);
  }

  function assertAa(theme: 'light' | 'dark', fg: string, bg: string): void {
    const actual = ratio(theme, fg, bg);
    expect(
      actual,
      `${theme}：${fg}(${themes[theme].fromCss[fg]}) 对 ${bg}(${themes[theme].fromCss[bg]}) 实测 ${actual.toFixed(2)} < 阈值 ${THRESHOLD}`,
    ).toBeGreaterThanOrEqual(THRESHOLD);
  }

  it('tokens.css 两主题与 DESIGN.md 逐 token 一致（防手改产物 / 漏跑 build-tokens）', () => {
    for (const [theme, { fromMd, fromCss }] of Object.entries(themes)) {
      const mdNames = Object.keys(fromMd);
      expect(mdNames.length, `${theme}：DESIGN.md 颜色 token 数为 0（解析失败）`).toBeGreaterThan(0);
      for (const name of mdNames) {
        expect(fromCss[name], `${theme} 的 ${name}`).toBeDefined();
        expect(fromCss[name], `${theme} 的 ${name}：tokens.css 与 DESIGN.md 不一致`).toBe(fromMd[name]);
      }
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}：ink 三档 × 三级平面全 ≥${THRESHOLD}`, () => {
      for (const fg of TEXT_TOKENS) {
        for (const bg of BACKDROPS) {
          assertAa(theme, fg, bg);
        }
      }
    });

    it(`${theme}：on-accent 对 accent、状态色对 canvas 全 ≥${THRESHOLD}`, () => {
      assertAa(theme, 'on-accent', 'accent');
      for (const fg of STATUS_ON_CANVAS) {
        assertAa(theme, fg, 'canvas');
      }
    });

    it(`${theme}：ink-faint ≠ ink-secondary（三档层次不得合并）`, () => {
      expect(themes[theme].fromCss['ink-faint']).not.toBe(themes[theme].fromCss['ink-secondary']);
    });
  }

  it('本轮裁决值锚定：ink-faint 浅色 #6B6964 / 深色 #9C9A94（T34-01 Notion 对齐，防回归到旧值）', () => {
    expect(fromCss.light['ink-faint']).toBe('#6B6964');
    expect(fromCss.dark['ink-faint']).toBe('#9C9A94');
  });

  it('报告口径：文字 token 两主题 × 四平面的实测比值（打进测试输出供报告引用）', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const fg of TEXT_TOKENS) {
        for (const bg of BACKDROPS) {
          // eslint-disable-next-line no-console -- 报告引用数据
          console.log(`  ${theme} ${fg}/${bg} = ${ratio(theme, fg, bg).toFixed(2)}`);
        }
      }
    }
  });
});
