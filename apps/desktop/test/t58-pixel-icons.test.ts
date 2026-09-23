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
    // T66-01 显式豁免（PM 收口）：工作台两枚局部 glyph 住 workbench/pixelGlyph.tsx，
    // 是 16 网格像素画、画法逐格拷贝 makeGlyph（同族契约）；T65 合入后 PM 统一收编
    // 进 @septcats/ui 像素族并撤本豁免——撤豁免即红，不放行蔓延。
    // T65-01 追加：调色板入口钮的 PixelPaletteGlyph 同理住 theme/pixelGlyph.tsx（像素族
    // 无对应 glyph，主文件禁改，DEVIATION 待 PM 收编）。
    const T66_LOCAL_GLYPHS = new Set(['PixelHomeGlyph', 'PixelTodoGlyph', 'PixelPaletteGlyph']);
    const missing = unique.filter(
      (name) => typeof table[name] !== 'function' && !T66_LOCAL_GLYPHS.has(name),
    );
    expect(missing, `这些 icon={X} 在 @septcats/ui 里不是可渲染组件：${missing.join(', ')}`).toEqual([]);
    // 覆盖清单抽查（T58 前就在用的高频图标）
    for (const name of ['Plus', 'Trash', 'X', 'MagnifyingGlass', 'CaretDown', 'AiRobot', 'FileText']) {
      expect(unique, `${name} 的调用点消失（扫描面失灵或调用点被误改）`).toContain(name);
    }
  });

  it('业务代码零 phosphor 直接 import（换族后单出口纪律仍成立）', () => {
    const offenders = [...consumerFiles, ...walkFiles(UI_SRC)].filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /(?:from|import|require)\s*\(?\s*['"]@phosphor-icons/.test(text);
    });
    expect(offenders.map((f) => f.replace(REPO, ''))).toEqual([]);
  });

  it('AI 语义整体收口：消费目录里 Sparkle 零 import/JSX 用法、AiRobot 至少 3 处调用点', () => {
    const sparkle = consumerFiles.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /\bimport\b[^;]*\bSparkle\b/.test(text) || /icon=\{Sparkle\}|<Sparkle\b/.test(text);
    });
    expect(sparkle.map((f) => f.replace(REPO, ''))).toEqual([]);
    const aiRobotUses = [...source.matchAll(/icon=\{AiRobot\}/g)].length;
    expect(aiRobotUses).toBeGreaterThanOrEqual(3);
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

  it('像素表逐名有同名组件出口 + 两个旧权利名别名指向同一组件（调用点零改动的实现）', () => {
    const table = ui as unknown as Record<string, unknown>;
    for (const name of Object.keys(ui.PIXEL_GLYPHS)) {
      expect(typeof table[name], `${name} 无同名像素组件出口`).toBe('function');
    }
    expect(table['X']).toBe(table['Close']);
    expect(table['MagnifyingGlass']).toBe(table['Search']);
  });
});
