import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

/**
 * 组件 CSS 的 token 纪律断言（§16.1），与 tokens/no-magic.mjs 同规则：
 * ① 零字面 hex；② 零重复裸 px（同文件内 ≥2 次的非 0/1px 值必须提为 token）。
 * 一次性组件专有几何（如 Switch 宽 36px、Dialog 宽 460px）允许字面：
 * 它们不携带跨组件语义，塞进 DESIGN.md 反而稀释 token 表。
 *
 * 入参是组件 CSS 相对 packages/ui 根的路径（如 'src/Button.css'）。
 * 不用 `?raw` 导入——vitest 在 css:false 下把 CSS 导入 stub 成空串（探针实测），
 * 故直接磁盘读（vitest cwd = 包根）。
 */
export function expectTokenOnlyCssFile(relPath: string): void {
  const css = readFileSync(relPath, 'utf8');

  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  expect(hex, `${relPath} 含字面 hex`).toEqual([]);

  const counts = new Map<string, number>();
  for (const m of css.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
    const value = Math.abs(Number(m[1]));
    if (value === 0 || value === 1) continue;
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).map(([value]) => `${value}px`);
  expect(repeated, `${relPath} 存在重复裸 px（应提为 token）`).toEqual([]);
}
