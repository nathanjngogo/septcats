#!/usr/bin/env node
/**
 * build-tokens.mjs —— DESIGN.md → src/tokens.css / src/tokens.ts 的唯一翻译层（§16.1）。
 *
 * 用法：
 *   node tokens/build-tokens.mjs --write                       # 生成产物并写入 src/
 *   node tokens/build-tokens.mjs --check                       # 与已提交产物比对，漂移 exit 1（CI 门禁）
 *   node tokens/build-tokens.mjs --check --source=<path>       # 指定 DESIGN.md（默认仓库根 ../../DESIGN.md）
 *
 * 纪律：
 * - 唯一输入是仓库根 DESIGN.md（相对本包参数化，本目录不放副本）。
 * - 浅色 token 来自 YAML front matter；深色 token 来自「深色主题映射」markdown 表。
 * - 表里出现 front matter 没有的颜色 token → 直接报错（防两套真相）。
 * - front matter 有颜色但表里缺失 → 只允许「跟随浅色同值的另一个 token」；否则报错（§16.3 双值要求）。
 * - 不引 js-yaml：front matter 是规整子集，下面的解析器 200 行内覆盖全量。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(HERE, '..');
const DEFAULT_SOURCE = resolve(UI_ROOT, '..', '..', 'DESIGN.md');
const CSS_OUT = resolve(UI_ROOT, 'src', 'tokens.css');
const TS_OUT = resolve(UI_ROOT, 'src', 'tokens.ts');

// --- front matter -----------------------------------------------------------

function extractFrontMatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  if (m === null) throw new Error('DESIGN.md 缺少 YAML front matter');
  return m[1];
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    if (end < 0) throw new Error(`未闭合的双引号：${raw}`);
    return v.slice(1, end);
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    if (end < 0) throw new Error(`未闭合的单引号：${raw}`);
    return v.slice(1, end);
  }
  let bare = v;
  const hash = bare.indexOf(' #');
  if (hash >= 0) bare = bare.slice(0, hash).trim();
  if (/^-?\d+$/.test(bare)) return Number.parseInt(bare, 10);
  if (/^-?\d+\.\d+$/.test(bare)) return Number.parseFloat(bare);
  return bare;
}

function parseYaml(src) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const line of src.split(/\r?\n/)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    const ci = content.indexOf(':');
    if (ci < 0) throw new Error(`无法解析的 YAML 行：${line}`);
    const key = content.slice(0, ci).trim();
    const rest = content.slice(ci + 1);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (rest.trim() === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}

// --- prose 解析（深色映射表 / 布局 / z-index / 缓动） -------------------------

function extractDarkTable(md) {
  const heading = md.indexOf('### 深色主题映射');
  if (heading < 0) throw new Error('DESIGN.md 缺少「深色主题映射」小节');
  const rows = [];
  for (const line of md.slice(heading).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells[0] === 'token') continue;
    rows.push({ token: cells[0], light: cells[1], dark: cells[2], note: cells[3] });
  }
  if (rows.length === 0) throw new Error('「深色主题映射」表为空');
  return rows;
}

function requireNumber(re, md, label) {
  const m = re.exec(md);
  if (m === null) throw new Error(`无法从 DESIGN.md 解析「${label}」（prose 结构变化请同步更新构建脚本）`);
  return Number(m[1]);
}

function extractProse(md) {
  const ease = /cubic-bezier\(\s*[0-9.,\s]+\)/.exec(md);
  if (ease === null) throw new Error('未找到唯一近似缓动 cubic-bezier(...)');
  const easeOut = ease[0].replace(/\s+/g, '');

  const layout = {
    topbar: requireNumber(/顶栏\s*(\d+)\s*px/, md, '顶栏高度'),
    sidebar: requireNumber(/侧栏\s*(\d+)\s*px/, md, '侧栏宽度'),
    collapsed: requireNumber(/折叠至\s*(\d+)\s*px/, md, '侧栏折叠宽度'),
    rowH: requireNumber(/行高\s*(\d+)\s*px/, md, '表格行高'),
    headH: requireNumber(/表头\s*(\d+)\s*px/, md, '表头高度'),
  };

  const zLine = /z-index\s*刻度：([^\n]+)/.exec(md);
  if (zLine === null) throw new Error('未找到 z-index 刻度行');
  const zScale = [...zLine[1].matchAll(/([a-z][a-z-]*)\s+(\d+)/g)].map((m) => [m[1], Number(m[2])]);
  if (zScale.length === 0) throw new Error('z-index 刻度解析为空');

  return { easeOut, layout, zScale };
}

// --- 颜色模型 ---------------------------------------------------------------

const SHADOW_FAMILY = 'shadow 族';

function resolveColors(fm, rows) {
  const colors = fm.colors;
  if (colors === undefined || typeof colors !== 'object') throw new Error('front matter 缺少 colors');

  const darkFromTable = new Map();
  for (const row of rows) {
    if (row.token === SHADOW_FAMILY) continue;
    if (!Object.prototype.hasOwnProperty.call(colors, row.token)) {
      throw new Error(`深色映射表出现未知 token「${row.token}」：front matter 没有对应颜色（防两套真相）`);
    }
    darkFromTable.set(row.token, row.dark);
  }

  const names = Object.keys(colors);
  const light = {};
  const dark = {};
  for (const name of names) {
    const value = String(colors[name]);
    light[name] = value;
    const direct = darkFromTable.get(name);
    if (direct !== undefined) {
      dark[name] = direct;
      continue;
    }
    const twin = names.find(
      (other) => other !== name && String(colors[other]) === value && darkFromTable.has(other),
    );
    if (twin === undefined) {
      throw new Error(`颜色 token「${name}」在深色映射表中缺失，且无同值 token 可跟随（§16.3 要求双值）`);
    }
    dark[name] = darkFromTable.get(twin);
  }
  return { names, light, dark };
}

function resolveDarkShadows(fm, rows) {
  const row = rows.find((r) => r.token === SHADOW_FAMILY);
  if (row === undefined) return null;
  const l = /(\d+)\s*[–—-]\s*(\d+)/.exec(row.light);
  const d = /(\d+)\s*[–—-]\s*(\d+)/.exec(row.dark);
  if (l === null || d === null) throw new Error('「shadow 族」行缺少百分比区间，无法派生深色阴影');
  const lightMid = (Number(l[1]) + Number(l[2])) / 2;
  const darkMid = (Number(d[1]) + Number(d[2])) / 2;
  const factor = darkMid / lightMid;
  const out = {};
  for (const [key, value] of Object.entries(fm.elevation)) {
    out[key] = String(value).replace(
      /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/g,
      (_m, r, g, b, a) => `rgba(${r},${g},${b},${round3(Number(a) * factor)})`,
    );
  }
  return out;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// --- 渲染：typography -------------------------------------------------------

const FONT_GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-monospace',
]);

function quoteFontList(value) {
  return value
    .split(',')
    .map((part) => {
      const name = part.trim();
      if (name === '') return '';
      if (FONT_GENERIC.has(name.toLowerCase())) return name;
      if (/\s/.test(name) && !/^["']/.test(name)) return `"${name}"`;
      return name;
    })
    .join(', ');
}

function isFamilyOnly(item) {
  return item !== null && typeof item === 'object' && item.fontSize === undefined;
}

function renderTypographyLines(fm) {
  const spec = fm.typography;
  const familyVar = new Map();
  for (const [key, item] of Object.entries(spec)) {
    if (isFamilyOnly(item) && !familyVar.has(item.fontFamily)) {
      familyVar.set(item.fontFamily, `--sc-font-${key.replace(/^font-/, '')}`);
    }
  }
  const out = [];
  for (const [key, item] of Object.entries(spec)) {
    if (isFamilyOnly(item)) {
      out.push(`--sc-font-${key.replace(/^font-/, '')}: ${quoteFontList(String(item.fontFamily))};`);
      continue;
    }
    const token = familyVar.get(item.fontFamily);
    const family = token === undefined ? quoteFontList(String(item.fontFamily)) : `var(${token})`;
    const weight = item.fontWeight === undefined ? 400 : item.fontWeight;
    out.push(`--sc-text-${key}: ${weight} ${item.fontSize}/${item.lineHeight} ${family};`);
    if (item.letterSpacing !== undefined) {
      out.push(`--sc-tracking-${key}: ${item.letterSpacing};`);
    }
  }
  return out;
}

// --- 渲染：CSS --------------------------------------------------------------

const CSS_HEADER = [
  '/* 本文件由 tokens/build-tokens.mjs 从仓库根 DESIGN.md 生成，请勿手工编辑。 */',
  '/* 重新生成：node tokens/build-tokens.mjs --write ｜ 一致性门禁：node tokens/build-tokens.mjs --check */',
];

function renderCss(fm, colorModel, shadowsDark, prose) {
  const L = [];
  L.push(...CSS_HEADER);
  L.push('');
  L.push(':root {');
  L.push('  /* colors：浅色主题语义色（DESIGN.md front matter） */');
  for (const name of colorModel.names) L.push(`  --sc-color-${name}: ${colorModel.light[name]};`);
  L.push('');
  L.push('  /* typography：字体族 + 复合字阶（font shorthand，含中文系统栈） */');
  for (const line of renderTypographyLines(fm)) L.push(`  ${line}`);
  L.push('');
  L.push('  /* rounded */');
  for (const [k, v] of Object.entries(fm.rounded)) L.push(`  --sc-radius-${k}: ${v};`);
  L.push('');
  L.push('  /* spacing */');
  for (const [k, v] of Object.entries(fm.spacing)) L.push(`  --sc-space-${k}: ${v};`);
  L.push('');
  L.push('  /* elevation（仅 popover/menu 与 modal 两处阴影） */');
  for (const [k, v] of Object.entries(fm.elevation)) L.push(`  --sc-${k}: ${v};`);
  L.push('');
  L.push("  /* motion：时长与唯一弹簧参数；ease-out 解析自「Do's and Don'ts」 */");
  for (const [k, v] of Object.entries(fm.motion)) L.push(`  --sc-motion-${k}: ${v};`);
  L.push(`  --sc-ease-out: ${prose.easeOut};`);
  L.push('');
  L.push('  /* layout（解析自 DESIGN.md「Layout」章节） */');
  L.push(`  --sc-layout-topbar: ${prose.layout.topbar}px;`);
  L.push(`  --sc-layout-sidebar: ${prose.layout.sidebar}px;`);
  L.push(`  --sc-layout-sidebar-collapsed: ${prose.layout.collapsed}px;`);
  L.push(`  --sc-layout-row-h: ${prose.layout.rowH}px;`);
  L.push(`  --sc-layout-head-h: ${prose.layout.headH}px;`);
  L.push('');
  L.push('  /* z-index（解析自 DESIGN.md「Elevation & Depth」章节） */');
  for (const [name, value] of prose.zScale) L.push(`  --sc-z-${name}: ${value};`);
  L.push('');
  L.push('  /* derived：无独立 DESIGN token，由既有 token 派生 */');
  L.push('  --sc-size-control-md: var(--sc-space-xxl);');
  L.push('  --sc-size-control-sm: calc(var(--sc-space-xxl) - var(--sc-space-xs));');
  L.push('  --sc-color-overlay: color-mix(in srgb, var(--sc-color-ink) 32%, transparent);');
  L.push('}');
  L.push('');
  L.push('[data-theme="dark"] {');
  L.push('  /* colors：DESIGN.md「深色主题映射」表（focus-ring 跟随同值 token accent） */');
  for (const name of colorModel.names) L.push(`  --sc-color-${name}: ${colorModel.dark[name]};`);
  L.push('');
  L.push('  /* elevation：表「shadow 族」——几何与基色不变，透明度按 40–60% 提深 */');
  for (const [k, v] of Object.entries(shadowsDark ?? {})) L.push(`  --sc-${k}: ${v};`);
  L.push('');
  L.push('  /* derived：深色遮罩 */');
  L.push('  --sc-color-overlay: rgb(0 0 0 / 0.6);');
  L.push('}');
  L.push('');
  L.push('/* base reset：全局基线，仅引用 token 变量（本文件为生成产物，no-magic 扫描豁免） */');
  L.push('*, *::before, *::after { box-sizing: border-box; }');
  L.push('html, body { margin: 0; height: 100%; }');
  L.push('body {');
  L.push('  font: var(--sc-text-ui-sm);');
  L.push('  color: var(--sc-color-ink);');
  L.push('  background: var(--sc-color-canvas);');
  L.push('  -webkit-font-smoothing: antialiased;');
  L.push('  text-rendering: optimizeLegibility;');
  L.push('}');
  L.push('button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }');
  L.push('input, textarea, select { font: inherit; color: inherit; }');
  L.push('a { color: inherit; }');
  L.push('::selection { background: var(--sc-color-selection); }');
  L.push(
    ':focus-visible { outline: 2px solid var(--sc-color-focus-ring); outline-offset: 2px; border-radius: var(--sc-radius-xs); }',
  );
  L.push('@media (prefers-reduced-motion: reduce) {');
  L.push('  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }');
  L.push('}');
  return `${L.join('\n')}\n`;
}

// --- 渲染：TS ---------------------------------------------------------------

const TS_HEADER = [
  '/*',
  ' * 本文件由 tokens/build-tokens.mjs 从仓库根 DESIGN.md 生成，请勿手工编辑。',
  ' * 重新生成：node tokens/build-tokens.mjs --write ｜ 一致性门禁：node tokens/build-tokens.mjs --check',
  ' */',
];

function tsObject(value) {
  const json = JSON.stringify(value, null, 2);
  return json.replace(/^(\s*)"([A-Za-z_$][A-Za-z0-9_$]*)":/gm, '$1$2:');
}

function tsStringArray(items) {
  return `[${items.map((i) => `'${i}'`).join(', ')}]`;
}

function renderTs(fm, colorModel, prose) {
  const light = {};
  const dark = {};
  for (const name of colorModel.names) {
    light[name] = colorModel.light[name];
    dark[name] = colorModel.dark[name];
  }
  const layout = {
    topbar: `${prose.layout.topbar}px`,
    sidebar: `${prose.layout.sidebar}px`,
    'sidebar-collapsed': `${prose.layout.collapsed}px`,
    'row-h': `${prose.layout.rowH}px`,
    'head-h': `${prose.layout.headH}px`,
  };
  const zIndex = Object.fromEntries(prose.zScale);

  const L = [];
  L.push(...TS_HEADER);
  L.push('');
  L.push(`export const colors = ${tsObject(light)} as const;`);
  L.push('');
  L.push(`export const colorsDark = ${tsObject(dark)} as const;`);
  L.push('');
  L.push(`export const typography = ${tsObject(fm.typography)} as const;`);
  L.push('');
  L.push(`export const rounded = ${tsObject(fm.rounded)} as const;`);
  L.push('');
  L.push(`export const spacing = ${tsObject(fm.spacing)} as const;`);
  L.push('');
  L.push(`export const elevation = ${tsObject(fm.elevation)} as const;`);
  L.push('');
  L.push(`export const motion = ${tsObject(fm.motion)} as const;`);
  L.push('');
  L.push(`export const layout = ${tsObject(layout)} as const;`);
  L.push('');
  L.push(`export const zIndex = ${tsObject(zIndex)} as const;`);
  L.push('');
  L.push(`export const easeOut = '${prose.easeOut}';`);
  L.push('');
  L.push(`export const COLOR_NAMES = ${tsStringArray(colorModel.names)} as const;`);
  L.push('');
  L.push("export const TOKEN_PREFIX = '--sc-';");
  L.push('');
  L.push("export const DESIGN_SOURCE = '../../DESIGN.md';");
  L.push('');
  L.push("export type ThemeName = 'light' | 'dark';");
  L.push('');
  L.push('export type ColorName = (typeof COLOR_NAMES)[number];');
  L.push('');
  L.push('export function colorVar(name: ColorName): string {');
  L.push('  return `var(--sc-color-${name})`;');
  L.push('}');
  return `${L.join('\n')}\n`;
}

// --- 主流程 -----------------------------------------------------------------

function build(sourcePath) {
  const md = readFileSync(sourcePath, 'utf8');
  const fm = parseYaml(extractFrontMatter(md));
  const rows = extractDarkTable(md);
  const prose = extractProse(md);
  const colorModel = resolveColors(fm, rows);
  const shadowsDark = resolveDarkShadows(fm, rows);
  return {
    css: renderCss(fm, colorModel, shadowsDark, prose),
    ts: renderTs(fm, colorModel, prose),
  };
}

function rel(path) {
  return relative(UI_ROOT, path).split('\\').join('/');
}

/** 行尾归一：产物统一 LF，但比对时容忍 Windows 检出造成的 CRLF，避免假红。 */
function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

function printDiff(label, expected, actualRaw) {
  const actual = normalize(actualRaw);
  const e = expected.split('\n');
  const a = actual.split('\n');
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i += 1) {
    if (e[i] !== a[i]) {
      console.error(`✗ ${label} 第 ${i + 1} 行不一致`);
      console.error(`  期望: ${e[i] ?? '<EOF>'}`);
      console.error(`  实际: ${a[i] ?? '<EOF>'}`);
      return;
    }
  }
  console.error(`✗ ${label} 内容不一致（行尾换行或编码差异）`);
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--write') ? 'write' : 'check';
  const sourceArg = args.find((a) => a.startsWith('--source='));
  const sourcePath =
    sourceArg === undefined ? DEFAULT_SOURCE : resolve(process.cwd(), sourceArg.slice('--source='.length));

  if (!existsSync(sourcePath)) {
    console.error(`✗ 找不到 DESIGN 源文件：${sourcePath}`);
    process.exit(1);
  }

  let produced;
  try {
    produced = build(sourcePath);
  } catch (error) {
    console.error(`✗ token 构建失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (mode === 'write') {
    writeFileSync(CSS_OUT, produced.css, 'utf8');
    writeFileSync(TS_OUT, produced.ts, 'utf8');
    console.log(`✓ 已写入 ${rel(CSS_OUT)} 与 ${rel(TS_OUT)}（源：${rel(sourcePath)}）`);
    return;
  }

  let ok = true;
  const targets = [
    ['src/tokens.css', CSS_OUT, produced.css],
    ['src/tokens.ts', TS_OUT, produced.ts],
  ];
  for (const [label, out, expected] of targets) {
    const actual = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (normalize(actual) !== normalize(expected)) {
      printDiff(label, expected, actual);
      ok = false;
    }
  }
  if (!ok) {
    console.error('✗ token 产物与 DESIGN.md 漂移：运行 node tokens/build-tokens.mjs --write 后提交');
    process.exit(1);
  }
  console.log('✓ token 产物与 DESIGN.md 一致');
}

main();
