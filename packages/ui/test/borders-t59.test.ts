/**
 * borders-t59.test.ts —— TASK-T59-01 §1.1/§1.2/§1.4 的 ui 侧层测。
 *
 * 覆盖：
 *  - §1.1 新 token `ink-edge`：双主题值锚定（浅 #1A1A1A / 深 #EDEDED）、
 *    tokens.ts / tokens.css 双落位、与 `ink` 同值但**独立成 token**（语义分离）；
 *  - §1.2 AppShell 两处主区域边界（顶栏下沿 / 侧栏右缘）= `2px solid ink-edge`；
 *  - §1.4 浮层族统一：Dialog / Menu / Popover / Tooltip / Select 下拉 / Toast 六个
 *    `packages/ui` 浮层外轮廓一律 2px ink-edge（原 1px hairline / hairline-strong 退役）；
 *  - §1.5 不动清单：控件文件（Button / Input / Checkbox / Switch）不得出现 ink-edge
 *    （控件已有 bevel 立体语法，再叠黑边会糊）。
 *    —— **T62-01 已反超该条**：老板 09-22 点名「整个程序的所有框」都要黑线，
 *    控件外框自 T62-01 起一律 2px ink-edge，故本节断言改写为「控件框线已统一」
 *    （细则见 test/pixel-borders.test.ts）。
 *  - token 纪律：本单改动的每个 ui CSS 仍过 css-discipline（零字面 hex + 零重复裸 px）。
 *
 * 口径同既有组件层测：CSS 不参与计算（vitest css:false），一律磁盘读规则文本断言；
 * 真机 computed style 数值由 docs/mockups/cdp-e2e-t59-01.mjs 覆盖。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';
import { expectTokenOnlyCssFile } from './css-discipline';
import { COLOR_NAMES, colors, colorsDark } from '../src/tokens';

const read = (rel: string): string => readFileSync(resolvePkgFile(rel), 'utf8');

/** 取 `selector { ... }` 规则体（单选择器规则；与 layout-fusion-t52 同范式）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const tokensCss = read('src/tokens.css');
const appShellCss = read('src/AppShell.css');
/** 浮层族（ui 侧全部）：选择器 → 文件。 */
const FLOATING: ReadonlyArray<readonly [string, string]> = [
  ['.sc-dialog', 'src/Dialog.css'],
  ['.sc-menu', 'src/Menu.css'],
  ['.sc-popover__panel', 'src/Popover.css'],
  ['.sc-tooltip__bubble', 'src/Tooltip.css'],
  ['.sc-select__listbox', 'src/Select.css'],
  ['.sc-toast__item', 'src/Toast.css'],
];
/** §1.5 不动清单（**T62-01 已反超**）：控件文件的框轮廓自 T62 起亦吃 ink-edge。 */
const CONTROL_FILES = ['src/Button.css', 'src/Input.css', 'src/Checkbox.css', 'src/Switch.css'] as const;

describe('T59-01 §1.1 token：ink-edge 双主题锚定', () => {
  it('浅色 = #1A1A1A（老板点名的黑色边框）；深色 = #EDEDED（近黑底上的亮边）', () => {
    expect(colors['ink-edge']).toBe('#1A1A1A');
    expect(colorsDark['ink-edge']).toBe('#EDEDED');
  });

  it('两个主题都落在 tokens.css，且与 tokens.ts 逐值一致（存在性 + 值正确）', () => {
    expect(tokensCss).toContain(`--sc-color-ink-edge: ${colors['ink-edge']};`);
    expect(tokensCss).toContain(`--sc-color-ink-edge: ${colorsDark['ink-edge']};`);
    // 两值必须不同（§16.3 双值要求：浅深不得同值）
    expect(colorsDark['ink-edge']).not.toBe(colors['ink-edge']);
  });

  it('与 ink 同值但语义独立：COLOR_NAMES 同时收录 ink 与 ink-edge（未来可独立微调）', () => {
    expect(COLOR_NAMES).toContain('ink');
    expect(COLOR_NAMES).toContain('ink-edge');
    expect(colors['ink-edge']).toBe(colors.ink);
    // 深色同理（结构反转：两主题都保持了「与 ink 同值」的巧合关系）
    expect(colorsDark['ink-edge']).toBe(colorsDark.ink);
  });
});

describe('T59-01 §1.2 主区域边界（AppShell.css）', () => {
  it('顶栏下沿 = border-bottom 2px ink-edge（原 1px hairline 退役）', () => {
    const topbar = ruleBody(appShellCss, '.sc-shell__topbar');
    expect(topbar).toContain('border-bottom: var(--sc-border-edge)');
    expect(topbar).not.toContain('border-bottom: 1px solid var(--sc-color-hairline)');
  });

  it('侧栏右缘 = 2px ink-edge 接缝条（定位条口径：零盒影响，内层 .app-side 仍 240）', () => {
    const sidebar = ruleBody(appShellCss, '.sc-shell__sidebar');
    expect(sidebar, '侧栏不得用 border-right 画接缝（会把内层压窄 2px）').not.toMatch(/border-right:\s*[1-9]/);
    const bar = ruleBody(appShellCss, '.sc-shell__sidebar::after');
    expect(bar, '侧栏缺右缘接缝条').toContain('background: var(--sc-color-ink-edge)');
    expect(bar).toContain('width: 2px');
    expect(bar, '接缝条须右贴边、通高、不抢命中').toContain('right: 0');
    expect(bar).toContain('pointer-events: none');
  });

  it('§1.5 不动清单：AppShell 只加这两条结构描边，控件面（同文件无 ink-edge 其它落点）', () => {
    // T85-01 token 化后口径：顶栏边框吃 var(--sc-border-edge)（pixel 展开 = 2px solid ink-edge，
    // 语义等价）；字面 --sc-color-ink-edge 仅剩侧栏接缝条 background 一处。断言改为
    // 「结构描边落点仍恰为两处」：border-edge 引用 + 接缝条字面各一。
    const edgeToken = appShellCss.match(/var\(--sc-border-edge\)/g) ?? [];
    const literal = appShellCss.match(/--sc-color-ink-edge/g) ?? [];
    expect(edgeToken.length, 'AppShell 顶栏边框应恰一处吃 --sc-border-edge').toBe(1);
    expect(literal.length, 'AppShell 字面 ink-edge 只应剩侧栏接缝条 background 一处').toBe(1);
  });
});

describe('T59-01 §1.4 浮层族统一（ui 侧六个浮层）', () => {
  it('全部浮层外轮廓 = 2px solid ink-edge', () => {
    const wrong: string[] = [];
    for (const [selector, rel] of FLOATING) {
      const body = ruleBody(read(rel), selector);
      const border = /border:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '<缺 border>';
      if (border !== 'var(--sc-border-edge)') wrong.push(`${rel} ${selector} → ${border}`);
    }
    expect(wrong, '浮层族未统一为 2px ink-edge').toEqual([]);
  });

  it('原 1px hairline / 2px hairline-strong 的浮层描边已无残留', () => {
    const stale = FLOATING.map(([, rel]) => rel).filter((rel) =>
      /border:\s*(1px solid var\(--sc-color-hairline\)|2px solid var\(--sc-color-hairline-strong\))/.test(
        read(rel),
      ),
    );
    expect(stale, '仍有浮层停留在旧描边').toEqual([]);
  });

  it('T62-01 反超 §1.5：控件文件（Button/Input/Checkbox/Switch）的框轮廓已统一吃 ink-edge', () => {
    for (const rel of CONTROL_FILES) {
      // T85-01：框线统一为边框 token（pixel 展开 = 2px solid ink-edge，语义等价）
      const src = read(rel);
      expect(
        src.includes('--sc-border-edge') || src.includes('--sc-color-ink-edge'),
        `${rel} 自 T62-01 起框线应统一为 ink-edge（T85-01 起经 --sc-border-edge token）`,
      ).toBe(true);
    }
  });
});

describe('T59-01 token 纪律（css-discipline 口径：零字面 hex + 零重复裸 px）', () => {
  it('本单改动的每个 ui CSS 仍过纪律门禁', () => {
    for (const rel of ['src/AppShell.css', ...FLOATING.map(([, rel]) => rel)]) {
      expectTokenOnlyCssFile(rel);
    }
  });

  it('描边宽度谱统一：浮层族里不出现 1.5px / 3px 等混谱值', () => {
    const offScale = FLOATING.map(([, rel]) => rel).filter((rel) => /border:\s*(1\.5px|3px)/.test(read(rel)));
    expect(offScale).toEqual([]);
  });
});
