#!/usr/bin/env node
/**
 * no-magic.mjs —— packages/ui/src 下组件 CSS 的魔法值门禁（§16.1）。
 *
 * 规则：
 *  ① 出现字面 hex 颜色 → 违规（颜色必须 var(--sc-color-*)）。
 *  ② 非 1px / 0 的裸 px 在同一文件内重复出现 ≥2 次 → 违规（应提为 token 或只出现一次）。
 * 豁免：src/tokens.css 是 DESIGN.md 的生成产物，其值天然是字面量。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(HERE, '..');
const SRC = resolve(UI_ROOT, 'src');
const EXEMPT_FILES = new Set(['tokens.css']);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const PX_RE = /(-?\d+(?:\.\d+)?)px/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.css') && !EXEMPT_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const violations = [];

for (const file of walk(SRC)) {
  const css = readFileSync(file, 'utf8');
  const rel = relative(UI_ROOT, file).split('\\').join('/');

  for (const m of css.matchAll(HEX_RE)) {
    violations.push(`${rel}:${lineOf(css, m.index)} 字面 hex「${m[0]}」`);
  }

  const counts = new Map();
  for (const m of css.matchAll(PX_RE)) {
    const value = Math.abs(Number(m[1]));
    if (value === 0 || value === 1) continue;
    const key = String(value);
    const entry = counts.get(key) ?? { count: 0, first: m.index };
    entry.count += 1;
    counts.set(key, entry);
  }
  for (const [value, info] of counts) {
    if (info.count >= 2) {
      violations.push(`${rel}:${lineOf(css, info.first)} 裸 px「${value}px」重复 ${info.count} 次`);
    }
  }
}

if (violations.length > 0) {
  console.error('✗ 组件 CSS 出现魔法值（一律用 var(--sc-*)）：');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px');
