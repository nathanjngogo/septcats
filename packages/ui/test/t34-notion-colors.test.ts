/**
 * t34-notion-colors.test.ts —— TASK-T34-01 §2.1 色值断言（层测）。
 *
 * PM 对老板 Notion 截图（1315×859）逐像素采样的目标值必须原样落进 token 产物；
 * 本文件把它们钉死，防后续任务悄悄漂移：
 *  - 浅色：侧栏/顶栏 canvas #F9F8F7、行悬停 surface #F1F0EF、行选中
 *    surface-active #EEECEB、内容区 content #FFFFFF、主文字 ink #2C2C2B、
 *    次级 ink-secondary #5F5E59、图标弱化 icon-faint #8E8B86、hairline #EAE8E6；
 *  - 深色（Notion 深色同构）：canvas #202020、content #191919、ink #E9E9E9
 *    （= #FFFFFFE6 合成）、icon-faint #8B8B8B（= #FFFFFF7A 合成）、hairline #2F2F2F。
 * 消费端（CSS 侧栏/顶栏）一律 var(--sc-color-*)，由 no-magic / css-discipline 把关。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';
import { colors, colorsDark } from '../src/tokens';

describe('T34-01 Notion 采样色锚定（DESIGN.md ↔ tokens 产物）', () => {
  it('浅色：侧栏/顶栏/内容区/行三态/文字四档/发丝线 全部等于采样值', () => {
    expect(colors.canvas).toBe('#F9F8F7');
    expect(colors.surface).toBe('#F1F0EF');
    expect(colors['surface-active']).toBe('#EEECEB');
    expect(colors.content).toBe('#FFFFFF');
    expect(colors.ink).toBe('#2C2C2B');
    expect(colors['ink-secondary']).toBe('#5F5E59');
    expect(colors['icon-faint']).toBe('#8E8B86');
    expect(colors.hairline).toBe('#EAE8E6');
  });

  it('深色：Notion 深色同构值（alpha 采样值以合成 6-hex 落 token）', () => {
    expect(colorsDark.canvas).toBe('#202020');
    expect(colors.content).toBe('#FFFFFF');
    expect(colorsDark.content).toBe('#191919');
    expect(colorsDark.ink).toBe('#E9E9E9');
    expect(colorsDark['icon-faint']).toBe('#8B8B8B');
    expect(colorsDark.hairline).toBe('#2F2F2F');
  });

  it('顶栏与侧栏同色由同一 token 保证：AppShell.css 两规则都引用 --sc-color-canvas', () => {
    const css = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');
    const topbar = /(^|\n)\.sc-shell__topbar\s*\{([^}]*)\}/.exec(css);
    const sidebar = /(^|\n)\.sc-shell__sidebar\s*\{([^}]*)\}/.exec(css);
    const main = /(^|\n)\.sc-shell__main\s*\{([^}]*)\}/.exec(css);
    expect(topbar?.[2] ?? '').toContain('background: var(--sc-color-canvas)');
    expect(sidebar?.[2] ?? '').toContain('background: var(--sc-color-canvas)');
    expect(main?.[2] ?? '').toContain('background: var(--sc-color-content)');
  });
});
