/**
 * a11y-signals.test.ts —— UI 评估（Apple 准则 §14 无障碍三信号）门禁。
 *
 * 背景：本仓此前只支持 `prefers-reduced-motion`（散在各组件）；另两个信号零支持：
 *   - `prefers-reduced-transparency: reduce` —— 用户明确「不要透明」时必须去磨砂、
 *     面回实心（而不是继续磨玻璃）；
 *   - `prefers-contrast: more` —— 面近实心 + 框线升实心 2px ink-edge。
 * 这两个媒体特性 jsdom 不实现、Chromium 亦无通用 emulate，故按本仓既有范式
 * （AppShell.test / pixel-borders.test）对 CSS **源面**做静态契约断言：
 * 在 looks.css 里必须存在这两段，且各自的关键声明在位。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';

const css = readFileSync(resolvePkgFile('src/looks.css'), 'utf8');

/** 取某个媒体块（从 @media 行到匹配收尾），粗粒度按下一个顶层 @media/文件尾切。 */
function mediaBlock(feature: string): string {
  const start = css.indexOf(`@media (${feature})`);
  expect(start, `looks.css 缺 @media (${feature})`).toBeGreaterThanOrEqual(0);
  const rest = css.slice(start + 1);
  const next = rest.indexOf('@media (');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('UI 评估 · 无障碍三信号（Apple §14）', () => {
  it('prefers-reduced-transparency：**不得**自动降级（防腐化负向契约）', () => {
    // 决策见 docs/UI-评估-四维.md §质感 + looks.css 决策记录：
    // Windows「透明效果」开关会映射本信号（本机默认命中）→ 照字面降级会把用户
    // 显式选中的 glass 档静默打回实心。材质选择权归应用内 look 档，故这里**禁止**
    // 出现该媒体块（要支持就走设置页开关，不要在 CSS 里静默改材质）。
    expect(css.includes('@media (prefers-reduced-transparency: reduce)'), '不得静默降级用户的材质选择').toBe(false);
  });

  it('prefers-contrast: more：框线升实心 2px ink-edge + 玻璃面回实心', () => {
    const blk = mediaBlock('prefers-contrast: more');
    expect(blk).toMatch(/--sc-border-edge:\s*2px solid var\(--sc-color-ink-edge\)/);
    expect(blk).toMatch(/--sc-border-edge-dashed:\s*2px dashed var\(--sc-color-ink-edge\)/);
    expect(blk).toContain('var(--sc-color-canvas)');
  });

  it('高对比段只动「面/线」，不碰文字色 token（对比度门禁口径不变）', () => {
    const blk = mediaBlock('prefers-contrast: more');
    expect(blk, 'prefers-contrast 段不得改 ink 族文字色').not.toMatch(/--sc-color-ink(?!-edge)/);
  });
});