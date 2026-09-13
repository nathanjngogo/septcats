import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, colors, colorsDark, layout, spacing, zIndex } from './tokens';

const tokensCss = readFileSync('src/tokens.css', 'utf8');

describe('token 管线产物（DESIGN.md 的投影）', () => {
  it('每个颜色 token 双值，且浅深不同（§16.3）', () => {
    expect(COLOR_NAMES.length).toBeGreaterThan(0);
    for (const name of COLOR_NAMES) {
      expect(colors[name]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(colorsDark[name]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(colorsDark[name]).not.toBe(colors[name]);
    }
  });

  it('tokens.css 含深色块，且两张色板的每个 token 都落到 CSS 变量', () => {
    expect(tokensCss).toContain('[data-theme="dark"]');
    for (const name of COLOR_NAMES) {
      expect(tokensCss).toContain(`--sc-color-${name}: ${colors[name]};`);
      expect(tokensCss).toContain(`--sc-color-${name}: ${colorsDark[name]};`);
    }
  });

  it('prose 派生的 layout / z-index 刻度与 §16 一致', () => {
    expect(layout.topbar).toBe('40px');
    expect(layout.sidebar).toBe('240px');
    expect(layout['sidebar-collapsed']).toBe('48px');
    expect(layout['row-h']).toBe('36px');
    expect(layout['head-h']).toBe('32px');
    expect(spacing['editor-measure']).toBe('720px');
    expect(zIndex.dropdown).toBe(20);
    expect(zIndex['drop-indicator']).toBe(60);
  });
});
