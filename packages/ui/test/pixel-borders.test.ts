/**
 * pixel-borders.test.ts —— TASK-T62-01「全局像素黑框线」的 grep 型纪律层测。
 *
 * 老板 09-22：「整个程序的所有框的线条都做成像素风的黑线条」。本测试把口径钉成可回归的断言：
 *
 *  §1.1 外框轮廓 → `var(--sc-border-edge)`（T85-01 起；展开 = 2px solid ink-edge，pixel 态逐字等值）
 *  §1.2 内部网格/分隔线 → `1px solid var(--sc-color-ink-edge)`
 *  §1.3 focus/active → 黑线（恒 ink-edge），禁彩色光晕
 *  §1.4 装饰性虚线/点线 → 线型保留、色升 ink-edge、宽度归 2px 谱
 *  §1.5 `--sc-border` 系灰线在框轮廓语义处一律退役
 *
 * 实现法（任务书 §2.3 指定）：扫**产品 CSS**（排除 `packages/core/coverage/**` 生成物与
 * `docs/mockups/**` 演示页）里的每一条 `border*: <value>` 声明，逐条要求命中
 * `ink-edge`，否则必须落进**显式白名单**（复位值 / 透明占位 / 语义状态色 / 同色底衬 /
 * 旋转指示环的动段弱档）。每次运行打印扫描数与命中数。
 *
 * 口径同既有层测：CSS 不参与计算（vitest css:false），一律磁盘读规则文本；
 * 真机 computed style 由 docs/mockups/cdp-e2e-t62-01.mjs 覆盖。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 仓库根：从 cwd 向上找带 pnpm-workspace.yaml 的目录（两种拉起方式都成立）。 */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    try {
      if (statSync(join(dir, 'pnpm-workspace.yaml')).isFile()) return dir;
    } catch {
      /* 继续向上 */
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('未找到仓库根（pnpm-workspace.yaml）');
    dir = parent;
  }
}

const ROOT = repoRoot();

/** 产品 CSS 扫描面：受影响四个包的源 CSS（**不含** coverage 生成物 / mockups 演示页）。 */
const SCAN_DIRS = [
  'packages/ui/src',
  'packages/dbview/src',
  'packages/editor/src',
  'apps/desktop/src/renderer/src',
] as const;

/** 排除清单（任务书 §0「不动」）。 */
const EXCLUDE_DIR_PARTS = ['coverage', 'mockups', 'node_modules', 'dist', 'out'];

function collectCss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_PARTS.includes(entry.name)) continue;
      collectCss(full, out);
    } else if (entry.name.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

/** 去注释（`/* … *​/`）——否则文档注释里的「border-right:」字样会污染扫描。 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** 一条 `border*: value` 声明（含四边/颜色/宽度/样式变体，不含 border-radius/collapse）。 */
const DECL_RE =
  /(?:^|[;{\s])(border(?:-(?:top|right|bottom|left))?(?:-(?:color|width|style))?)\s*:\s*([^;}]+)/g;

/** T85-01：token 化后的边框值同样是合法落点（pixel 块展开 = 2px solid ink-edge）。 */
const BORDER_TOKEN_RE = /^\s*var\(--sc-border-edge(?:-dashed)?\)\s*$/;

type Decl = { file: string; prop: string; value: string };
type Verdict = { decl: Decl; reason: string };

/** 白名单：命中即放行，reason 进打印（报告可逐条引用）。 */
const ALLOW: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\s*(0|none)\s*$/, '复位（border: 0 / none）'],
  [/^\s*(1px|2px)\s+(solid|dashed|dotted)\s+transparent\s*$/, '透明占位（ghost 控件/无框变体）'],
  [/transparent\s*$/, '含 transparent 的占位边'],
  [/var\(--sc-color-danger(-soft)?\)/, '语义状态色：错误/危险态（DEVIATION-1）'],
  [/var\(--sc-color-accent-soft\)/, '同色底衬（标签 variant，视觉不可见）'],
  [/var\(--sc-color-hairline-strong\)/, '旋转指示环动段弱档（仅 Spinner，DEVIATION-2）'],
];

const scanned: Decl[] = [];
const violations: Array<Decl & { why: string }> = [];
const allowed: Verdict[] = [];
const inkEdge: Decl[] = [];

for (const rel of SCAN_DIRS) {
  const dir = join(ROOT, rel);
  let files: string[];
  try {
    files = collectCss(dir);
  } catch {
    continue; // 目录不存在则跳过（不掩盖：SCAN_DIRS 是产品包，缺目录本身就是异常，见下方计数断言）
  }
  for (const full of files) {
    const file = relative(ROOT, full).replace(/\\/g, '/');
    const text = stripComments(readFileSync(full, 'utf8'));
    for (const m of text.matchAll(DECL_RE)) {
      const prop = m[1];
      const rawValue = m[2];
      if (prop === undefined || rawValue === undefined) continue; // 正则两捕获组都是必配，防御性收窄
      const decl: Decl = { file, prop, value: rawValue.trim() };
      scanned.push(decl);
      if (decl.value.includes('ink-edge') || BORDER_TOKEN_RE.test(decl.value)) {
        inkEdge.push(decl);
        continue;
      }
      const hit = ALLOW.find(([re]) => re.test(decl.value));
      if (hit) allowed.push({ decl, reason: hit[1] });
      else violations.push({ ...decl, why: '既非 ink-edge，也不在白名单' });
    }
  }
}

/** `border-color` 单属性（无宽度）不参与宽度谱断言；有宽度者必须是 1px/2px。 */
const withWidth = inkEdge.filter((d) => /^\s*[\d.]+\s*px/.test(d.value));

console.log(
  `[T62-01 pixel-borders] 扫描 ${SCAN_DIRS.length} 个源目录 → ` +
    `border 声明 ${scanned.length} 条；ink-edge 命中 ${inkEdge.length} 条；` +
    `白名单放行 ${allowed.length} 条；越界 ${violations.length} 条`,
);
console.log(
  `[T62-01 pixel-borders] 白名单分档：` +
    Object.entries(
      allowed.reduce<Record<string, number>>((acc, a) => {
        acc[a.reason] = (acc[a.reason] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([k, v]) => `${k}×${v}`)
      .join(' ｜ '),
);
console.log(
  `[T62-01 pixel-borders] ink-edge 宽度谱：` +
    Object.entries(
      withWidth.reduce<Record<string, number>>((acc, d) => {
        const wm = /^(\s*[\d.]+px)/.exec(d.value);
        const w = wm?.[1]?.trim() ?? '?';
        acc[w] = (acc[w] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([k, v]) => `${k}×${v}`)
      .join(' ｜ '),
);

describe('T62-01 §1/§2.3 全局框线纪律（产品 CSS 全量扫描）', () => {
  it('扫描面非空（防线：路径写错时测试静默通过）', () => {
    expect(scanned.length, 'border 声明数异常，检查 SCAN_DIRS / 仓库根解析').toBeGreaterThan(120);
    expect(inkEdge.length, 'ink-edge 落点异常').toBeGreaterThan(100);
  });

  it('不存在「框轮廓语义仍用 --sc-border 系灰线」的残留（白名单外必须全吃 ink-edge）', () => {
    const dump = violations.map((v) => `${v.file} → ${v.prop}: ${v.value}（${v.why}）`).join('\n');
    expect(violations, `越界 border 声明：\n${dump}`).toEqual([]);
  });

  it('§1.1/§1.2 宽度谱：吃 ink-edge 的描边宽度只允许 1px（内网格）或 2px（外框）', () => {
    const offScale = withWidth.filter((d) => !/^\s*(1px|2px)\s/.test(d.value));
    expect(
      offScale.map((d) => `${d.file} → ${d.value}`),
      '出现 1.5px / 3px 等混谱宽度',
    ).toEqual([]);
  });

  it('§1.4 全仓零 1.5px 描边（T59「禁 1.5px 半吊子」口径延续）', () => {
    const halves = scanned.filter((d) => /1\.5px/.test(d.value));
    expect(halves.map((d) => `${d.file} → ${d.value}`)).toEqual([]);
  });

  it('§0「不动」兜底：coverage 生成物与 mockups 演示页不在扫描面内', () => {
    const leaked = scanned.filter((d) => /\/(coverage|mockups)\//.test(d.file));
    expect(leaked).toEqual([]);
  });
});

describe('T59-01 既有 17 处落点未被改回（回归护栏）', () => {
  /** T59-01 立下的「主区域边界 + 浮层」落点：文件 → 必须仍含的 2px ink-edge 声明。 */
  const T59_ANCHORS: ReadonlyArray<readonly [string, string]> = [
    ['packages/ui/src/AppShell.css', 'border-bottom: var(--sc-border-edge)'],
    ['packages/ui/src/AppShell.css', 'background: var(--sc-color-ink-edge)'],
    ['packages/ui/src/Dialog.css', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Menu.css', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Popover.css', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Tooltip.css', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Toast.css', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Select.css', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/App.css', 'border-top: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/ai/AiChatPanel.css', 'border-left: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/tabs/TabsBar.css', 'border-left: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/tabs/TabsBar.css', 'border-top: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/tabs/TabsBar.css', 'border-right: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/palette/CommandPalette.css', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/sync/SyncStatus.css', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/close/CloseAskDialog.css', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/layout/LayoutPicker.css', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/layout/ResizeHandle.css', 'background: var(--sc-color-ink-edge)'],
  ];

  it('逐条仍在（17 处 T59 成果不许被 T62 改回）', () => {
    const missing: string[] = [];
    for (const [rel, needle] of T59_ANCHORS) {
      const text = stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
      if (!text.includes(needle)) missing.push(`${rel} 缺「${needle}」`);
    }
    expect(missing).toEqual([]);
  });

  it('Spinner 动段弱档是唯一 hairline-strong 描边例外（白名单不许蔓延）', () => {
    const hairline = allowed.filter((a) => a.reason.includes('Spinner'));
    const files = [...new Set(hairline.map((a) => a.decl.file))];
    expect(files).toEqual(['packages/ui/src/Spinner.css']);
  });
});

describe('T62-01 §1.1/§1.2 代表落点逐条钉（按包装箱）', () => {
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    // packages/ui
    ['packages/ui/src/Input.css', '.sc-field__control', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Button.css', '.sc-btn--secondary', 'border-color: var(--sc-color-ink-edge)'],
    ['packages/ui/src/Checkbox.css', '.sc-cbx__box', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Tag.css', '.sc-tag', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Kbd.css', '.sc-kbd', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Switch.css', '.sc-switch', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/RadioGroup.css', '.sc-radio-group', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/ErrorPanel.css', '.sc-error', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/EmptyState.css', '.sc-empty__art', 'border: var(--sc-border-edge-dashed)'],
    ['packages/ui/src/Spinner.css', '.sc-spinner', 'border: var(--sc-border-edge)'],
    ['packages/ui/src/Select.css', '.sc-select__trigger', 'border: var(--sc-border-edge)'],
    // packages/dbview（仅 CSS）
    ['packages/dbview/src/react/DbView.css', '.sc-dbgrid__header', 'border: var(--sc-border-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbgrid__body', 'border: var(--sc-border-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbhead__cell', 'border-right: 1px solid var(--sc-color-ink-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbcell', 'border-right: 1px solid var(--sc-color-ink-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbc-input', 'border: var(--sc-border-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbtag--neutral', 'border: var(--sc-border-edge)'],
    ['packages/dbview/src/react/DbView.css', '.sc-dbc-picker', 'border: var(--sc-border-edge)'],
    // packages/editor（仅 CSS）
    ['packages/editor/src/react/editor.css', '.sc-block--code', 'border: var(--sc-border-edge)'],
    ['packages/editor/src/react/editor.css', '.sc-block--divider', 'border-top: 1px solid var(--sc-color-ink-edge)'],
    ['packages/editor/src/react/editor.css', '.sc-blockcontrol__menu', 'border: var(--sc-border-edge)'],
    ['packages/editor/src/react/editor.css', '.sc-slashmenu', 'border: var(--sc-border-edge)'],
    ['packages/editor/src/react/editor.css', '.sc-selectiontoolbar', 'border: var(--sc-border-edge)'],
    // apps/desktop
    ['apps/desktop/src/renderer/src/App.css', '.app-nav-input', 'border: var(--sc-border-edge)'],
    ['apps/desktop/src/renderer/src/App.css', '.app-side-foot', 'border-top: 1px solid var(--sc-color-ink-edge)'],
    [
      'apps/desktop/src/renderer/src/ai/AiChatPanel.css',
      '.ai-chat__input',
      'border: var(--sc-border-edge)',
    ],
    [
      'apps/desktop/src/renderer/src/pages/SettingsPage.css',
      '.settings-recovery-input',
      'border: var(--sc-border-edge)',
    ],
    [
      'apps/desktop/src/renderer/src/pages/ImportWizard.css',
      '.wiz-drop',
      'border: var(--sc-border-edge-dashed)',
    ],
    [
      'apps/desktop/src/renderer/src/manual/ManualView.css',
      '.manual-view__table th,',
      'border: 1px solid var(--sc-color-ink-edge)',
    ],
    [
      'apps/desktop/src/renderer/src/layout/LayoutEditorPage.css',
      '.layout-editor__card',
      'border: var(--sc-border-edge)',
    ],
  ];

  it('全部代表选择器命中', () => {
    const miss: string[] = [];
    for (const [rel, selector, needle] of CASES) {
      const text = stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
      const idx = text.indexOf(selector);
      if (idx < 0) {
        miss.push(`${rel} 找不到选择器 ${selector}`);
        continue;
      }
      const body = text.slice(idx, text.indexOf('}', idx));
      if (!body.includes(needle)) miss.push(`${rel} ${selector} 缺「${needle}」`);
    }
    expect(miss).toEqual([]);
  });
});
