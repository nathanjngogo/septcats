/**
 * t58-pixel-icons.test.ts —— TASK-T58-01 全仓图标像素化的**桌面侧审计**（源码面 + 产物面）。
 *
 * 与 packages/ui 的层测分工：ui 侧钉「glyph 矩阵 / 出口 / 两态 CSS / 对比度」，
 * 这里钉「桌面与应用消费面」：
 *  ① 三处消费目录（renderer / editor / dbview）的 `icon={X}` 每一个名字都能在
 *     @septcats/ui 的像素族出口里落地（一个不漏），且 Sparkle 零残留；
 *  ② 业务代码零 phosphor 直接 import（§16.6 单出口纪律在换族后依然成立）；
 *  ③ 门禁产物入盘：28 枚 × {16,24}px × {浅,深} 共 112 张 + 拼版总览 1 张；
 *  ④ 依赖面不扩张（像素族零新依赖）+ 尺寸档契约未动。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ui from '@septcats/ui';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..'); // apps/desktop/test → 仓库根
const UI_SRC = join(REPO, 'packages', 'ui', 'src');
const PNG_DIR = join(REPO, 'assets', 'icons', 'png');

/** 三个消费目录（与 packages/ui/tokens/no-magic.mjs 的扫描面同口径）。 */
const CONSUMER_DIRS = [
  join(REPO, 'apps', 'desktop', 'src', 'renderer'),
  join(REPO, 'packages', 'editor', 'src'),
  join(REPO, 'packages', 'dbview', 'src'),
];

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const consumerFiles = CONSUMER_DIRS.flatMap((dir) => walkFiles(dir));
const readAll = (files: readonly string[]): string =>
  files.map((file) => readFileSync(file, 'utf8')).join('\n/* --- */\n');

describe('T58-01 桌面侧 · icon={X} 调用点全量落在像素族', () => {
  const source = readAll(consumerFiles);

  it('每个 icon={X} 的名字都是 @septcats/ui 的导出（且是函数组件）——「一个不漏」', () => {
    // 只收组件名（首字母大写）；icon={icon} 这类透传变量不算调用点
    const names = [...source.matchAll(/icon=\{([A-Z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]!);
    // 防零扫描空转：真存在一批调用点
    expect(names.length).toBeGreaterThan(15);
    const unique = [...new Set(names)];
    const table = ui as unknown as Record<string, unknown>;
    // T66-01 / T65-01 的历史豁免名单（工作台房子·待办·店铺 + 调色板四枚局部 glyph）
    // 已于 T74-01（2026-09-24）**清零**：四枚全部迁进 @septcats/ui（`src/icons.tsx`，
    // 复用 pixelIcons 的 createPixelGlyph 同一渲染管线），应用层两份局部实现已删除。
    // 本集合自此为空——再出现任何名字落不进 ui 出口即红，豁免不放行蔓延。
    const T66_LOCAL_GLYPHS = new Set<string>([]);
    expect(T66_LOCAL_GLYPHS.size, 'T74-01 收口后豁免名单必须为空（glyph 一律住 @septcats/ui）').toBe(0);
    const missing = unique.filter(
      (name) => typeof table[name] !== 'function' && !T66_LOCAL_GLYPHS.has(name),
    );
    expect(missing, `这些 icon={X} 在 @septcats/ui 里不是可渲染组件：${missing.join(', ')}`).toEqual([]);
    // 覆盖清单抽查（T58 前就在用的高频图标）
    for (const name of ['Plus', 'Trash', 'X', 'MagnifyingGlass', 'CaretDown', 'AiRobot', 'FileText']) {
      expect(unique, `${name} 的调用点消失（扫描面失灵或调用点被误改）`).toContain(name);
    }
  });

  it('T74-01 收口：四枚原局部 glyph 已是 @septcats/ui 出口，应用层零局部实现残留', () => {
    const table = ui as unknown as Record<string, unknown>;
    for (const name of ['PixelHomeGlyph', 'PixelTodoGlyph', 'PixelShopGlyph', 'PixelPaletteGlyph']) {
      expect(typeof table[name], `${name} 未从 @septcats/ui 出口`).toBe('function');
    }
    // 反蔓延：消费目录内不许再出现局部 glyph 工厂（画法拷贝是本单要还的债）
    const leftovers = consumerFiles.filter((file) =>
      /makeLocalGlyph|LocalGlyphProps/.test(readFileSync(file, 'utf8')),
    );
    expect(leftovers.map((f) => f.replace(REPO, ''))).toEqual([]);
    for (const rel of ['workbench', 'theme']) {
      expect(
        existsSync(join(REPO, 'apps', 'desktop', 'src', 'renderer', 'src', rel, 'pixelGlyph.tsx')),
        `${rel}/pixelGlyph.tsx 应已删除（T74-01 收编）`,
      ).toBe(false);
    }
  });

  it('业务代码零 phosphor 直接 import（换族后单出口纪律仍成立）', () => {
    const offenders = [...consumerFiles, ...walkFiles(UI_SRC)].filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /(?:from|import|require)\s*\(?\s*['"]@phosphor-icons/.test(text);
    });
    expect(offenders.map((f) => f.replace(REPO, ''))).toEqual([]);
  });

  it('AI 语义整体收口：消费目录里 Sparkle 零 import/JSX 用法、AiRobot 仍有调用点且不在顶栏', () => {
    const sparkle = consumerFiles.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /\bimport\b[^;]*\bSparkle\b/.test(text) || /icon=\{Sparkle\}|<Sparkle\b/.test(text);
    });
    expect(sparkle.map((f) => f.replace(REPO, ''))).toEqual([]);
    // 09-29 老板令「顶栏按键…全部换成中文按键」→「图标去掉」：AiRobot 从顶栏撤出，
    // 现由 AI 面板标题栏承载（AiChatPanel 的 <Icon icon={AiRobot}>）。契约从
    // 「≥3 处按钮调用点」改为「消费面仍有调用点 + 顶栏文字钮组件零图标」。
    const aiRobotIconUses = [...source.matchAll(/icon=\{AiRobot\}/g)].length;
    expect(aiRobotIconUses).toBeGreaterThanOrEqual(1);
    const topBarSrc = readFileSync(
      join(REPO, 'apps', 'desktop', 'src', 'renderer', 'src', 'layout', 'TopBarButton.tsx'),
      'utf8',
    );
    expect(/\bicon\b\s*[:=]/.test(topBarSrc), '顶栏文字钮组件不得再出现 icon 属性').toBe(false);
    expect(/<svg|IconGlyph|from '@septcats\/ui'/.test(topBarSrc), '顶栏文字钮组件不得再引图标族').toBe(false);
  });
});

describe('T58-01 桌面侧 · 门禁产物与依赖面', () => {
  it('视觉质检产物入盘：28 枚 × {16,24}px × {浅,深} = 112 张 + 拼版总览 1 张，且都不是空文件', () => {
    const glyphs = Object.keys(ui.PIXEL_GLYPHS);
    expect(glyphs.length).toBe(28);
    const missing: string[] = [];
    const empty: string[] = [];
    for (const name of glyphs) {
      for (const suffix of ['16', '16-dark', '24', '24-dark']) {
        const file = join(PNG_DIR, `${name}-${suffix}.png`);
        if (!existsSync(file)) missing.push(`${name}-${suffix}.png`);
        else if (statSync(file).size === 0) empty.push(`${name}-${suffix}.png`);
      }
    }
    expect(missing, `缺 PNG：${missing.join(', ')}`).toEqual([]);
    expect(empty, `空 PNG：${empty.join(', ')}`).toEqual([]);
    expect(existsSync(join(PNG_DIR, 'glyph-sheet-overview.png'))).toBe(true);
  });

  it('像素族零新依赖：@septcats/ui 的 dependencies 仍是 {clsx, @phosphor-icons/react}（后者仅 fallback）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'packages', 'ui', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@phosphor-icons/react', 'clsx']);
  });

  it('尺寸档契约未动：ICON_SIZES = {sm:16, md:20, lg:24}、resolveIconSize 仍接档位与显式数字、legacy 线宽出口保留', () => {
    expect(ui.ICON_SIZES).toEqual({ sm: 16, md: 20, lg: 24 });
    expect(ui.resolveIconSize('sm')).toBe(16);
    expect(ui.resolveIconSize()).toBe(20);
    expect(ui.resolveIconSize(40)).toBe(40);
    expect(ui.ICON_STROKE_WIDTH).toBe(1.5);
  });

  it('T105-02 换装口径：应用面名字一律指向线族；像素族只作基线（族内几何 + 零消费冷名）', () => {
    const table = ui as unknown as Record<string, unknown>;
    /** 应用面（沿用旧名）→ 一律线族（老板 10-06「取消像素风」）。 */
    const APP_FACING = [
      'AiRobot', 'ArrowClockwise', 'BookOpen', 'CaretDown', 'CaretRight', 'CaretUp', 'Check',
      'CheckCircle', 'Circle', 'Clock', 'Copy', 'DotsThree', 'FileText', 'FolderSimple', 'GearSix',
      'Layout', 'MagnifyingGlass', 'Note', 'Plus', 'SidebarSimple', 'Star', 'Trash',
      'WarningCircle', 'WarningOctagon', 'X',
    ];
    for (const name of APP_FACING) {
      const comp = table[name] as { displayName?: string } | undefined;
      expect(typeof comp, `${name} 无出口`).toBe('function');
      expect(
        comp?.displayName?.startsWith('Line'),
        `${name} 仍指向像素族（displayName=${String(comp?.displayName)}）`,
      ).toBe(true);
    }
    // 像素族几何本体仍在（层测/质检走 ./pixelIcons 直取，不经应用出口）
    expect(Object.keys(ui.PIXEL_GLYPHS)).toHaveLength(28);
    // 零消费冷名暂留像素族（旧观感对照）；一旦有调用点，先补线族几何再加别名
    for (const cold of ['ArrowsClockwise', 'Close', 'Info', 'PencilSimple', 'Search']) {
      const comp = table[cold] as { displayName?: string } | undefined;
      expect(typeof comp, `${cold} 冷名出口丢失`).toBe('function');
      expect(comp?.displayName?.startsWith('Pixel'), `${cold} 应为像素族冷名`).toBe(true);
    }
  });

  it('应用源码零像素族 import（换装完成后的防回退护栏）', () => {
    const offenders = consumerFiles.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /import[^;]*\b(?:Pixel\w+Glyph|pixelIcons|PixelGlyphName)\b[^;]*from/.test(text);
    });
    expect(offenders.map((f) => f.replace(REPO, ''))).toEqual([]);
  });
});
