/**
 * t101-contrast-chrome.test.ts —— T101-01 全站对比度扫描的**静态护栏**。
 *
 * 背景：夜航仪表（instrument）档的 chrome = canvas + 12~14% ink-edge 的**淡化面**，
 * 比 surface 更接近 canvas ⇒ 落在它上面的 ink-faint 实测只有 **3.65:1 < AA 4.5**。
 * 政策：弱化面 × 弱字冲突时**提文字档**（ink-faint → ink-secondary），不改淡化强度。
 *
 * 本测试做**全仓 CSS 扫描**：凡选择器指向「直接铺在 chrome 上的容器」的规则，
 * 其 `color:` 一律不得是 ink-faint —— 这样以后新增面板漏提档会在这里红，而不是
 * 等到发版后才被真机扫描抓到。
 *
 * 动态真值由探针 `docs/mockups/cdp-e2e-t101-01.mjs`（DOM 全域扫描，dark/light 双主题）
 * 负责；本文件是廉价、必跑的静态兜底。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// SRC 按「测试文件自身位置」推导（不依赖 CWD）：根聚合跑 `pnpm test`（vitest run）时 CWD=仓库根，
// 相对 'src/renderer/src' 会扫不到任何 CSS → 护栏静默空跑（假绿）。
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');

/** 直接铺在 chrome（淡化面）上的容器：这些容器里的弱字必须 ≥ ink-secondary。 */
const CHROME_CONTAINERS = [
  'sc-shell__sidebar',
  'sc-shell__topbar',
  'sc-shell__rail',
  'sc-shell__readouts',
  'sc-sync-status__pill',
  'cal-side',
  'todo-side',
  'sc-readouts',
];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...cssFiles(full));
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

/** 抽出形如 `选择器 { 声明 }` 的规则（@media 等嵌套由正则自然跳过：body 不含花括号）。 */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/gu;
  let m = re.exec(css);
  while (m !== null) {
    // noUncheckedIndexedAccess：捕获组要显式兜底，否则 m[1] 是 string | undefined
    const selector = (m[1] ?? '').trim();
    if (!selector.startsWith('@')) {
      out.push({ selector, body: m[2] ?? '' });
    }
    m = re.exec(css);
  }
  return out;
}

/** 去掉注释，避免注释里提到 ink-faint 造成假红。 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '');

describe('T101-01 chrome 落点弱字（静态护栏：不得用 ink-faint）', () => {
  const files = cssFiles(SRC);

  it('扫描面非空（防止 glob 失效导致本护栏静默通过）', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('chrome 容器内的 color 声明一律不是 ink-faint', () => {
    const bad: string[] = [];
    for (const file of files) {
      const css = stripComments(readFileSync(file, 'utf8'));
      for (const { selector, body } of rules(css)) {
        const onChrome = CHROME_CONTAINERS.some((c) => selector.includes(`.${c}`));
        if (!onChrome) {
          continue;
        }
        for (const decl of body.split(';')) {
          const [prop, value] = decl.split(':');
          if (prop?.trim() === 'color' && value !== undefined && value.includes('ink-faint')) {
            bad.push(`${relative(SRC, file)} → ${selector} { color: ${value.trim()} }`);
          }
        }
      }
    }
    expect(bad, `chrome 落点的弱字须 ≥ ink-secondary（3.65:1 < AA 4.5）：\n${bad.join('\n')}`).toEqual([]);
  });

  it('本次修复的四个落点确实是 ink-secondary（防回退）', () => {
    const targets: [string, string][] = [
      ['calendar/CalendarSidePanel.css', '.cal-side-count'],
      ['calendar/CalendarSidePanel.css', '.cal-side-empty'],
      ['calendar/CalendarSidePanel.css', '.cal-side-when'],
      ['todo/TodoSidePanel.css', '.todo-side-head__count'],
      ['sync/SyncStatus.css', '.sc-sync-status__pill--idle'],
    ];
    for (const [rel, sel] of targets) {
      const css = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      const hit = rules(css).find((r) => r.selector === sel);
      expect(hit, `${rel} 缺 ${sel}`).toBeDefined();
      expect(hit?.body, `${sel} 必须是 ink-secondary`).toContain('var(--sc-color-ink-secondary)');
    }
  });
});