/**
 * looks-t85.test.ts —— T85-01/T86-02 质感派系层的静态锚（老板 09-28：「质感风格没有实质性的改变」）。
 *
 * CSS 不参与计算（vitest css:false），一律磁盘读 looks.css / AppShell.css 文本断言。
 * T86-02 起口径从「有没有声明」升级为「**差得够不够明显**」（旧版只断言存在性，主界面像素差
 * 实测仅 1.86~1.97% 却全绿，正是老板打回那一条）：
 *  L1 looks.css 恰有 pixel/linear/glass 三块 + :root 默认块，且画廊选择器零残留（T86-01 已删画廊）；
 *  L2 任何 look 块不得覆写 --sc-color-*（色板归 themes.css，质感层只碰质感）；
 *  L3 边框谱：pixel 2px 实墨；linear/glass 1px 且**必须半透明墨**（color-mix 占比 ≤45%）；
 *  L4 圆角三档**严格递增**：pixel 全 0 < linear [4,14] < glass [8,20]，且 glass max > linear max；
 *  L5 glass 特征：chrome+浮层都上 backdrop-filter 且 blur ≥20px，**且外壳铺环境光背景图**
 *     （「背后无光可磨」= 旧版毛玻璃无效的根因，本条钉死防复发）；
 *  L6 pixel 档：网格纸底（repeating-linear-gradient）+ 弹层**硬位移影**（0 模糊半径）= 像素招牌；
 *  L7 linear 档：主区有极浅面渐变，且**不得**出现 backdrop-filter（与 glass 判别）；
 *  L8 :root 默认块 = pixel = tokens.css ink-edge 现状（2px solid）→ 零回归；
 *  L9 AppShell 侧栏接缝条 ::after width: 2px 原样（像素态）且 looks 提供 1px 收细。
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
    const sel = m[1] ?? '';
    out.push({ sel: sel.trim().replace(/\s+/g, ' '), body: m[2] ?? '' });
  }
  return out;
}

const ALL = rules(css);
const lookBlock = (id: string): string =>
  ALL.filter((r) => r.sel === `[data-look='${id}']`).map((r) => r.body).join('\n');
const lookRules = (id: string) => ALL.filter((r) => r.sel.includes(`[data-look='${id}']`));
const radii = (id: string): number[] =>
  [...lookBlock(id).matchAll(/--sc-radius-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));

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

  it('画廊已删（T86-01）：looks.css 不得再引用 .theme-gallery', () => {
    expect(css).not.toContain('theme-gallery');
  });
});

describe('T85-01 L2-L5 质感口径', () => {
  it('L2 任何规则块不覆写 --sc-color-*（只许引用色板；覆写=作为声明左侧出现，色板归 themes.css）', () => {
    const offenders = ALL.flatMap((r) =>
      [...r.body.matchAll(/(?:^|;)\s*(--sc-color-[a-z-]+)\s*:/g)].map((m) => `${r.sel} → ${m[1]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('L3 边框谱：pixel 2px 实墨；linear/glass 1px 半透明墨（占比 ≤45%）', () => {
    expect(lookBlock('pixel')).toMatch(/--sc-border-edge:\s*2px solid var\(--sc-color-ink-edge\)/);
    for (const id of ['linear', 'glass']) {
      const m = new RegExp(`--sc-border-edge:\\s*1px solid color-mix\\(in srgb, var\\(--sc-color-ink-edge\\) (\\d+)%, transparent\\)`).exec(lookBlock(id));
      expect(m, `${id} 的 --sc-border-edge 未收为「1px 半透明墨」`).not.toBeNull();
      expect(Number(m?.[1]), `${id} 边线不够淡（>45% 即接近实墨）`).toBeLessThanOrEqual(45);
    }
  });

  it('L4 圆角三档严格递增：pixel 全 0 < linear [4,14] < glass [8,20]', () => {
    expect(radii('pixel').filter((n) => n !== 0)).toEqual([]);
    const lin = radii('linear');
    const gl = radii('glass');
    expect(Math.min(...lin), 'linear 圆角下限').toBeGreaterThanOrEqual(4);
    expect(Math.max(...lin), 'linear 圆角上限').toBeLessThanOrEqual(14);
    expect(Math.max(...gl), 'glass 圆角上限').toBeGreaterThanOrEqual(20);
    expect(Math.max(...gl) > Math.max(...lin), 'glass 圆角必须大于 linear（三档可分辨）').toBe(true);
  });

  it('L5 glass 特征：chrome/浮层磨砂 blur ≥20px + 外壳环境光背景图（背后无光=磨砂无效）', () => {
    const frost = lookRules('glass').filter((r) => r.body.includes('backdrop-filter'));
    expect(frost.length, '缺 glass 磨砂块').toBeGreaterThan(0);
    const joinedSel = frost.map((r) => r.sel).join(' ');
    for (const cls of ['.sc-dialog', '.sc-menu', '.palette', '.sc-shell__topbar', '.sc-shell__sidebar']) {
      expect(joinedSel, `glass 磨砂名单缺 ${cls}`).toContain(cls);
    }
    // T95-02 起模糊量走 token（blur = token × 注册数 --sc-materialize，换档时从 0 长到目标），
    // 故半径锚在 token 定义上；同时钉住「磨砂块必须吃这两个 token」（防有人改回裸 px 丢掉落成形）。
    const literal = frost.flatMap((r) => [...r.body.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g)].map((m) => Number(m[1])));
    const tokenRadii = [...css.matchAll(/--sc-glass-blur-(?:chrome|overlay):\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(literal.length + tokenRadii.length, 'glass 磨砂半径未声明（裸 px 或 token 皆无）').toBeGreaterThan(0);
    expect(tokenRadii.length, 'T95-02 起玻璃模糊应走 --sc-glass-blur-* token（材质成形的插值前提）').toBeGreaterThan(0);
    expect(Math.min(...tokenRadii), '磨砂半径过小（<20px 肉眼几乎无感）').toBeGreaterThanOrEqual(20);
    const usesTokens = frost.filter((r) => r.body.includes('var(--sc-glass-blur-') && r.body.includes('var(--sc-materialize)'));
    expect(usesTokens.length, 'glass 磨砂块应同时吃模糊 token 与 --sc-materialize').toBeGreaterThan(0);
    // 环境光底：外壳必须铺渐变，chrome 才「有东西可磨」
    const ambient = lookRules('glass').filter((r) => r.sel.includes('.sc-shell') && !r.sel.includes('__') && r.body.includes('background-image'));
    expect(ambient.length, 'glass 缺外壳环境光背景图（旧版无效磨砂根因）').toBeGreaterThan(0);
    const ambientBody = ambient.map((r) => r.body).join(' ');
    expect(ambientBody, '环境光底必须是渐变').toContain('radial-gradient');
    // T88 通透锚（老板 09-28「做不到背景通透」）：光斑必须含**彩光**（danger/success 派生），
    // 纯灰度光斑磨出来没有通透感（chroma 实测 0.6 → 8.5 的差距来源）。
    expect(ambientBody, 'glass 环境光缺彩光斑（danger/success 派生）').toMatch(/--sc-color-(danger|success)\)/);
    // chrome 面板透明度锚：canvas 混色占比 ≤30%（>40% 就回到「磨了像没磨」的不透档）
    const chrome = lookRules('glass').find((r) => r.sel.includes('.sc-shell__topbar'));
    expect(chrome, 'glass 缺 chrome 半透块').toBeDefined();
    const mix = /background:\s*color-mix\(in srgb,\s*var\(--sc-color-canvas\)\s+(\d+)%/.exec(chrome?.body ?? '');
    expect(mix, 'chrome 底必须是 canvas color-mix 半透').not.toBeNull();
    expect(Number(mix?.[1]), 'chrome 面板混色占比过高（>30% = 不透）').toBeLessThanOrEqual(30);
    // 饱和提升锚：saturate ≥2.2（1.8 档实测彩光发闷）
    // T95-02 起饱和度也走 token（saturate = 1 + (token-1) × --sc-materialize），锚到 token 定义。
    const satLiterals = frost.flatMap((r) => [...r.body.matchAll(/saturate\(([\d.]+)\)/g)].map((m) => Number(m[1])));
    const satTokens = [...css.matchAll(/--sc-glass-sat-(?:chrome|overlay):\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...satLiterals, ...satTokens), 'glass 饱和提升不足（<2.2 彩光透不出）').toBeGreaterThanOrEqual(2.2);
    expect(satTokens.length, 'T95-02 起玻璃饱和度应走 --sc-glass-sat-* token').toBeGreaterThan(0);
  });

  it('L6 pixel 档特征：网格纸底 + 弹层硬位移影（0 模糊半径）', () => {
    const grid = lookRules('pixel').filter((r) => r.sel.includes('.sc-shell') && r.body.includes('repeating-linear-gradient'));
    expect(grid.length, 'pixel 缺网格纸底').toBeGreaterThan(0);
    expect(lookBlock('pixel'), 'pixel 弹层影必须是硬位移（0 模糊）').toMatch(/--sc-shadow-modal:\s*\d+px \d+px 0 0/);
    expect(lookBlock('pixel'), 'pixel 凸起影必须是硬位移（0 模糊）').toMatch(/--sc-pixel-out:\s*\d+px \d+px 0 0/);
  });

  it('L7 linear 档特征：主区极浅面渐变，且不得出现 backdrop-filter', () => {
    const grad = lookRules('linear').filter((r) => r.sel.includes('.sc-shell__main') && r.body.includes('linear-gradient'));
    expect(grad.length, 'linear 缺主区面渐变').toBeGreaterThan(0);
    const frost = lookRules('linear').filter((r) => r.body.includes('backdrop-filter'));
    expect(frost.map((r) => r.sel), 'linear 不得有磨砂（与 glass 判别）').toEqual([]);
  });
});

describe('T85-01 L8/L9 零回归锚', () => {
  it('L8 :root 默认块与 [data-look=pixel] 同值 = tokens.css 的 ink-edge 现状（2px solid）', () => {
    const root = ALL.find((r) => r.sel === ':root')?.body ?? '';
    expect(root).toContain('--sc-border-edge: 2px solid var(--sc-color-ink-edge);');
    expect(root).toContain('--sc-border-edge-dashed: 2px dashed var(--sc-color-ink-edge);');
    // tokens.css 侧 ink-edge 色板原样（浅 #1A1A1A / 深 #EDEDED）
    expect(tokensCss).toContain('--sc-color-ink-edge: #1A1A1A;');
    expect(tokensCss).toContain('--sc-color-ink-edge: #EDEDED;');
  });

  it('L9 AppShell 侧栏接缝条保持 2px；looks 提供 linear/glass 1px 收细', () => {
    expect(appShellCss).toMatch(/\.sc-shell__sidebar::after\s*\{[^}]*width:\s*2px/);
    const thin = ALL.filter((r) => r.sel.includes('::after') && r.body.includes('width: 1px'));
    expect(thin.length, 'looks.css 缺接缝条 1px 收细块').toBeGreaterThan(0);
    const sels = thin.map((r) => r.sel).join(' ');
    expect(sels).toContain("[data-look='linear']");
    expect(sels).toContain("[data-look='glass']");
  });
});