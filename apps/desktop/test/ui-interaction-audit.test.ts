/**
 * ui-interaction-audit.test.ts —— S4 批次 3 交互态/空态巡检门禁（TASK-T27-01 §0.B）。
 *
 * 对 renderer/src 下的 CSS 源面做静态断言（与 no-magic 门禁同范式）：
 * 1) 过渡纪律：renderer CSS 的 transition 时长一律走 var(--sc-motion-*)（禁字面 ms）；
 *    且只允许 --sc-motion-fast（120ms ≤ 150ms），禁 --sc-motion-base（200ms 超上限）；
 * 2) reduced-motion 兜底：凡引入 transition 的文件必须有 @media (prefers-reduced-motion)
 *    块（全局 tokens.css 兜底之外每文件自查）；
 * 3) 交互态覆盖：巡检清单选择器的 hover/active 规则齐备（focus-visible 由全局
 *    tokens.css :focus-visible 环兜底，此处断言其存在）；
 * 4) 空态一致性：.pv-empty/.trash-empty/.search-empty（页面级）与 .tpl-empty/
 *    .app-nav-empty/.palette-empty（行内/面板级）的 font/color 一律
 *    var(--sc-text-ui-sm) + var(--sc-color-ink-faint)（间距按容器语境，见报告 §发现）；
 * 5) 双主题：tokens.css 有 [data-theme="dark"] 且四态所依赖 token 全量映射；
 * 6) 禁字面 hex：renderer CSS 只走 var(--sc-*)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = join(here, '..', 'src', 'renderer', 'src');
const TOKENS_CSS = join(here, '..', '..', '..', 'packages', 'ui', 'src', 'tokens.css');

function walkCss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkCss(full));
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

const cssFiles = walkCss(RENDERER_SRC).map((path) => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  css: readFileSync(path, 'utf8'),
}));

/** 取 `.cls { ... }` 规则体（巡检目标类都是单选择器规则，无需完整 CSS 解析）。 */
function ruleBody(css: string, cls: string): string {
  const match = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? '';
}

function hasRule(css: string, selector: string): boolean {
  // 选择器后接 `{`（单规则）或 `,`（组选择器首项）即算命中
  return new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\{|,)`).test(css);
}

const fileOf = (name: string): string => {
  const file = cssFiles.find((entry) => entry.name === name);
  expect(file, `找不到样式文件 ${name}`).toBeDefined();
  return file?.css ?? '';
};

describe('S4 批次 3 巡检：过渡纪律（T27-01 §0.B.2）', () => {
  it('renderer CSS 的 transition 一律走 var(--sc-motion-fast)，无字面 ms、无超 150ms 的 motion-base', () => {
    const withTransition = cssFiles.filter((file) => /transition\s*:/.test(file.css));
    expect(withTransition.length, '存在引入过渡的文件').toBeGreaterThan(0);
    for (const file of cssFiles) {
      // 兜底块里的 `transition: none` 合法，不参与 token 检查
      const transitions =
        file.css.match(/transition\s*:[^;]+;/g)?.filter((declaration) => !/:\s*none/.test(declaration)) ?? [];
      for (const declaration of transitions) {
        expect(declaration, `${file.name} 过渡必须走 --sc-motion-fast token`).toContain(
          'var(--sc-motion-fast)',
        );
        expect(declaration, `${file.name} 过渡禁字面时长`).not.toMatch(/\d+m?s\b/);
        expect(declaration, `${file.name} 禁用超 150ms 的 motion-base`).not.toContain(
          '--sc-motion-base',
        );
      }
    }
    // tokens 单源：--sc-motion-fast 本身 ≤150ms
    const tokens = readFileSync(TOKENS_CSS, 'utf8');
    const fast = /--sc-motion-fast:\s*(\d+)ms/.exec(tokens);
    expect(fast).not.toBeNull();
    expect(Number(fast?.[1])).toBeLessThanOrEqual(150);
  });

  it('凡引入 transition 的文件都带 prefers-reduced-motion 兜底块', () => {
    for (const file of cssFiles) {
      if (!/transition\s*:/.test(file.css)) continue;
      expect(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(file.css),
        `${file.name} 缺 prefers-reduced-motion 兜底`,
      ).toBe(true);
    }
  });
});

describe('S4 批次 3 巡检：交互态覆盖（T27-01 §0.B.1）', () => {
  /** [文件, hover 选择器, active 选择器]（active 为 null = 该元素无按压语义，报告说明） */
  const checklist: Array<[string, string, string | null]> = [
    ['App.css', '.app-nav-row:hover', '.app-nav-row:active'],
    ['App.css', '.app-side-foot:hover', '.app-side-foot:active'],
    ['App.css', '.app-nav-suffix:hover', '.app-nav-suffix:active'],
    ['TrashList.css', '.trash-row:hover', '.trash-row:active'],
    ['SearchPage.css', '.search-res:hover', '.search-res:active'],
    ['SearchPage.css', '.search-chip:hover', '.search-chip:active'],
    ['SearchPage.css', '.search-qchip:hover .search-qchip-x', '.search-qchip:active'],
    ['CommandPalette.css', '.palette-row:hover', '.palette-row:active'],
    ['ImportWizard.css', '.wiz-drop:hover', '.wiz-drop:active'],
    ['SyncStatus.css', '.sc-sync-status__pill:hover', '.sc-sync-status__pill:active'],
    ['SyncStatus.css', '.sc-sync-status__button:hover:not(:disabled)', null],
  ];

  it('巡检清单的 hover/active 规则齐备', () => {
    for (const [file, hover, active] of checklist) {
      const css = fileOf(file);
      expect(hasRule(css, hover), `${file} 缺 ${hover}`).toBe(true);
      if (active !== null) {
        expect(hasRule(css, active), `${file} 缺 ${active}`).toBe(true);
      }
    }
  });

  it('按压态一律走 token 色（accent-soft / on-accent），无字面色', () => {
    expect(ruleBody(fileOf('App.css'), 'app-nav-row:active')).toContain('var(--sc-color-accent-soft)');
    expect(ruleBody(fileOf('TrashList.css'), 'trash-row:active')).toContain('var(--sc-color-accent-soft)');
    expect(ruleBody(fileOf('SearchPage.css'), 'search-res:active')).toContain('var(--sc-color-accent-soft)');
    expect(ruleBody(fileOf('CommandPalette.css'), 'palette-row:active')).toContain('var(--sc-color-accent-soft)');
    expect(ruleBody(fileOf('SyncStatus.css'), 'sc-sync-status__pill:active')).toContain('var(--sc-color-accent-soft)');
  });

  it('disabled / focus-visible 态齐备（focus 环由全局 tokens.css 兜底）', () => {
    expect(ruleBody(fileOf('SyncStatus.css'), 'sc-sync-status__button:disabled')).toContain('opacity');
    const tokens = readFileSync(TOKENS_CSS, 'utf8');
    expect(tokens).toMatch(/:focus-visible\s*\{[^}]*--sc-color-focus-ring/);
  });
});

describe('S4 批次 3 巡检：空态一致性（T27-01 §0.B.3）', () => {
  const EMPTY_FONT = 'font: var(--sc-text-ui-sm)';
  const EMPTY_COLOR = 'color: var(--sc-color-ink-faint)';

  /** [文件, 类名, 语境]：页面级空态居中留白，行内/面板级只对齐字色 token */
  const emptyStates: Array<[string, string, 'page' | 'inline']> = [
    ['PageView.css', 'pv-empty', 'page'],
    ['TrashList.css', 'trash-empty', 'page'],
    ['SearchPage.css', 'search-empty', 'page'],
    ['templates.css', 'tpl-empty', 'inline'],
    ['App.css', 'app-nav-empty', 'inline'],
    ['CommandPalette.css', 'palette-empty', 'inline'],
  ];

  it('六个空态类的 font/color 同一 token 组合（ui-sm + ink-faint）', () => {
    for (const [file, cls] of emptyStates) {
      const body = ruleBody(fileOf(file), cls);
      expect(body, `${cls} 缺 font token`).toContain(EMPTY_FONT);
      expect(body, `${cls} 缺 color token`).toContain(EMPTY_COLOR);
    }
  });

  it('页面级空态（pv/trash/search）居中 + 同款留白（--sc-space-xxl）', () => {
    for (const [file, cls] of emptyStates.filter(([, , kind]) => kind === 'page')) {
      const body = ruleBody(fileOf(file), cls);
      expect(body, `${cls} 应 text-align: center`).toContain('text-align: center');
      expect(body, `${cls} 留白应走 --sc-space-xxl`).toContain('var(--sc-space-xxl)');
    }
  });
});

describe('S4 批次 3 巡检：双主题与 token 纪律（T27-01 §0.B.4）', () => {
  it('tokens.css 深色主题映射四态依赖的核心 token', () => {
    const tokens = readFileSync(TOKENS_CSS, 'utf8');
    const dark = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tokens);
    expect(dark, '缺深色主题块').not.toBeNull();
    const darkBody = dark?.[1] ?? '';
    for (const token of [
      '--sc-color-surface',
      '--sc-color-accent-soft',
      '--sc-color-accent',
      '--sc-color-on-accent',
      '--sc-color-ink-faint',
      '--sc-color-focus-ring',
    ]) {
      expect(darkBody, `深色主题缺 ${token}`).toContain(token);
    }
  });

  it('renderer CSS 无字面 hex（只走 var(--sc-*)）', () => {
    for (const file of cssFiles) {
      const stripped = file.css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped, `${file.name} 出现字面 hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
