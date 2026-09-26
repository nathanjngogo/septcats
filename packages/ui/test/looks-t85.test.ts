/**
 * looks-t85.test.ts —— T85-01 质感派系层的静态锚（老板 09-26 令：Linear + 毛玻璃入主题市场）。
 *
 * CSS 不参与计算（vitest css:false），一律磁盘读 looks.css / AppShell.css 文本断言：
 *  L1 looks.css 恰有 pixel/linear/glass 三块 + :root 默认块（缺属性 = pixel 兜底）；
 *  L2 任何 look 块不得覆写 --sc-color-*（色板归 themes.css，质感层只碰质感）；
 *  L3 边框宽度谱：linear/glass 的 --sc-border-edge 必须 1px（与 pixel 2px 判别）；
 *  L4 圆角阶：pixel 恒 0；linear max ≤8；glass max ≥12（三档质感可分辨）；
 *  L5 glass 块含 backdrop-filter（毛玻璃定义特征）且浮层选择器在列；
 *  L6 pixel 块与 tokens.css 现状逐字等值（border token 展开 = 2px solid ink-edge）→ 零回归；
 *  L7 looks.css 不写任何 border*: / outline*: 直声明（pixel-borders 扫描面零命中前提）；
 *  L8 AppShell 侧栏接缝条 ::after width: 2px 原样（像素态）且 looks 提供 1px 收细。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePkgFile } from './pkg-root';

const css = readFileSync(resolvePkgFile('src/looks.css'), 'utf8');
const tokensCss = readFileSync(resolvePkgFile('src/tokens.css'), 'utf8');
const appShellCss = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');

/** 去块注释后按 `selector {` 拆规则（顶层选择器 → 规则体）。 */
function rules(text: string): Array<{ sel: string; body: string }> {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: Array<{ sel: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(stripped); m !== null; m = re.exec(stripped)) {
    out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

const ALL = rules(css);
const lookBlock = (id: string): string =>
  ALL.filter((r) => r.sel === `[data-look='${id}']`).map((r) => r.body).join('\n');

describe('T85-01 L1/L7 looks.css 结构', () => {
  it('三 look 块 + :root 默认块齐备', () => {
    for (const id of ['pixel', 'linear', 'glass']) {
      expect(lookBlock(id), `缺 [data-look='${id}'] 块`).not.toBe('');
    }
    expect(ALL.some((r) => r.sel === ':root'), '缺 :root 默认兜底块').toBe(true);
  });

  it('文件不使用 @layer（全仓无 layer 体系，入 layer 必输裸选择器）', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('@layer');
  });

  it('L7 零 border*:/outline*: 直声明（边框宽度全走 token，pixel-borders 扫描面零命中）', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const decls = [...stripped.matchAll(/(?:^|[;{\s])(border(?:-(?:width|color|style))?|outline(?:-(?:width|color|style))?)\s*:/g)];
    expect(decls.map((m) => m[1])).toEqual([]);
  });
});

describe('T85-01 L2-L5 质感口径', () => {
  it('L2 任何规则块不覆写 --sc-color-*（只许引用色板；覆写=作为声明左侧出现，色板归 themes.css）', () => {
    const offenders = ALL.flatMap((r) =>
      [...r.body.matchAll(/(?:^|;)\s*(--sc-color-[a-z-]+)\s*:/g)].map((m) => `${r.sel} → ${m[1]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('L3 pixel = 2px 边；linear/glass = 1px 边', () => {
    expect(lookBlock('pixel')).toMatch(/--sc-border-edge:\s*2px solid var\(--sc-color-ink-edge\)/);
    expect(lookBlock('linear')).toMatch(/--sc-border-edge:\s*1px solid var\(--sc-color-ink-edge\)/);
    expect(lookBlock('glass')).toMatch(/--sc-border-edge:\s*1px solid var\(--sc-color-ink-edge\)/);
  });

  it('L4 圆角三档：pixel=0 / linear≤8 / glass≥12', () => {
    const radii = (id: string): number[] =>
      [...lookBlock(id).matchAll(/--sc-radius-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(radii('pixel').filter((n) => n !== 0)).toEqual([]);
    expect(radii('glass').length).toBeGreaterThan(0);
    const lin = [...lookBlock('linear').matchAll(/--sc-radius-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.max(...lin)).toBeLessThanOrEqual(8);
    expect(Math.max(...radii('glass'))).toBeGreaterThanOrEqual(12);
  });

  it('L5 glass 定义特征 = backdrop-filter 磨砂，且浮层/画廊在玻璃名单内', () => {
    const glassSel = ALL.filter((r) => r.sel.includes("[data-look='glass']") && r.body.includes('backdrop-filter'));
    expect(glassSel.length, '缺 glass 磨砂块').toBeGreaterThan(0);
    const joined = glassSel.map((r) => r.sel).join(' ');
    for (const cls of ['.sc-dialog', '.sc-menu', '.palette', '.theme-gallery']) {
      expect(joined, `glass 磨砂名单缺 ${cls}`).toContain(cls);
    }
  });
});

describe('T85-01 L6/L8 零回归锚', () => {
  it('L6 :root 默认块与 [data-look=pixel] 同值 = tokens.css 的 ink-edge 现状（2px solid）', () => {
    const root = ALL.find((r) => r.sel === ':root')?.body ?? '';
    expect(root).toContain('--sc-border-edge: 2px solid var(--sc-color-ink-edge);');
    expect(root).toContain('--sc-border-edge-dashed: 2px dashed var(--sc-color-ink-edge);');
    // tokens.css 侧 ink-edge 色板原样（浅 #1A1A1A / 深 #EDEDED）
    expect(tokensCss).toContain('--sc-color-ink-edge: #1A1A1A;');
    expect(tokensCss).toContain('--sc-color-ink-edge: #EDEDED;');
  });

  it('L8 AppShell 侧栏接缝条保持 2px；looks 提供 linear/glass 1px 收细', () => {
    expect(appShellCss).toMatch(/\.sc-shell__sidebar::after\s*\{[^}]*width:\s*2px/);
    const thin = ALL.filter((r) => r.sel.includes('::after') && r.body.includes('width: 1px'));
    expect(thin.length, 'looks.css 缺接缝条 1px 收细块').toBeGreaterThan(0);
    const sels = thin.map((r) => r.sel).join(' ');
    expect(sels).toContain("[data-look='linear']");
    expect(sels).toContain("[data-look='glass']");
  });
});
