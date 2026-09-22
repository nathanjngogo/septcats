/**
 * pixel-icon-contrast.test.ts —— 像素图标族的「非文字 ≥3:1」门禁（TASK-T58-01 §1.6）。
 *
 * 口径：
 *  - 像素 glyph 的色值只有 currentColor + opacity 档。落在图标上的前景 token 是
 *    IconButton/AppShell 的 `--sc-color-ink-secondary`（悬停升 `ink`），背景是 T53
 *    五级平面里的 canvas / surface / surface-raised / content；
 *  - 一格里实际看到的颜色 = 前景 token 与背景按 tone 档在 sRGB 通道上线性混合
 *    （与浏览器合成同法），故**每一档**都要独立过门禁，而不是只测主色；
 *  - 阈值 3:1 = WCAG 非文字图形件（graphical objects）档，沿用 T53 灰阶色板。
 *
 * T34-01 裁决的 `icon-faint`（浅色对 canvas 2.58:1）不参与本门禁：它是「仅图标/非文字
 * 弱化」专用档，本单未把任何像素 glyph 落在该 token 上；若后续要落，须先过这里的门禁。
 */
import { describe, expect, it } from 'vitest';
import { TONE_OPACITY, FAINTEST_TONE_OPACITY } from '../src/pixelIcons';
import { colors, colorsDark } from '../src/tokens';

const THRESHOLD = 3;

function hexToRgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  expect(m, `非法颜色值：${hex}`).not.toBeNull();
  const int = Number.parseInt(m![1]!, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** 前景按 opacity 档压到背景上（sRGB 通道线性混合，与浏览器同法）。 */
function composite(fg: string, bg: string, alpha: number): readonly [number, number, number] {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return [0, 1, 2].map((i) => Math.round(f[i]! * alpha + b[i]! * (1 - alpha))) as unknown as readonly [number, number, number];
}

function contrast(fg: string, bg: string, alpha: number): number {
  const lf = luminance(composite(fg, bg, alpha));
  const lb = luminance(hexToRgb(bg));
  const [hi, lo] = lf >= lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: { colors, iconFg: ['ink-secondary', 'ink'], backdrops: ['canvas', 'surface', 'surface-raised', 'content'] },
  dark: { colors: colorsDark, iconFg: ['ink-secondary', 'ink'], backdrops: ['canvas', 'surface', 'surface-raised', 'content'] },
} as const;

const TONES = Object.values(TONE_OPACITY);

describe('T58-01 像素图标对比度门禁（非文字 ≥3:1，T53 灰阶色板）', () => {
  it('两主题 × 4 平面 × 每档 tone：像素格实测全部 ≥3:1', () => {
    const failures: string[] = [];
    for (const [themeName, theme] of Object.entries(THEMES)) {
      for (const fgName of theme.iconFg) {
        for (const bgName of theme.backdrops) {
          for (const tone of TONES) {
            const fg = theme.colors[fgName as keyof typeof colors]!;
            const bg = theme.colors[bgName as keyof typeof colors]!;
            const actual = contrast(fg, bg, tone);
            if (actual < THRESHOLD) {
              failures.push(`${themeName} ${fgName}(${fg})/${bgName}(${bg}) tone=${String(tone)} 实测 ${actual.toFixed(2)}`);
            }
          }
        }
      }
    }
    expect(failures, failures.join(' | ')).toEqual([]);
  });

  it('明暗档是单调递减且相互可分（亮 > 中 > 淡，不得塌成一档）', () => {
    expect(TONES.length).toBeGreaterThanOrEqual(2);
    const sorted = [...TONES].sort((a, b) => b - a);
    expect(sorted).toEqual([...TONES].sort((a, b) => b - a));
    expect(new Set(TONES).size).toBe(TONES.length);
    expect(sorted[0]).toBe(1);
    expect(sorted[sorted.length - 1]).toBe(FAINTEST_TONE_OPACITY);
  });

  it('报告口径：48 组实测比值打进测试输出（供 T58-01 报告引用）', () => {
    for (const [themeName, theme] of Object.entries(THEMES)) {
      for (const fgName of theme.iconFg) {
        for (const bgName of theme.backdrops) {
          const fg = theme.colors[fgName as keyof typeof colors]!;
          const bg = theme.colors[bgName as keyof typeof colors]!;
          const row = TONES.map((tone) => `t${String(tone)}=${contrast(fg, bg, tone).toFixed(2)}`).join(' ');
          // eslint-disable-next-line no-console -- 报告引用数据
          console.log(`  ${themeName} ${fgName}/${bgName} ${row}`);
        }
      }
    }
  });

  it('关态（眼灭 0.35 / 天线 0.55）是刻意降档的状态修饰，非静止态：记录其比值且必须仍可辨（>1.1）', () => {
    for (const [themeName, theme] of Object.entries(THEMES)) {
      const fg = theme.colors['ink-secondary'];
      const bg = theme.colors.canvas;
      const eyeOff = contrast(fg, bg, 0.35);
      const antennaOff = contrast(fg, bg, 0.55);
      // eslint-disable-next-line no-console -- 报告引用数据
      console.log(`  ${themeName} 关态 eye=0.35→${eyeOff.toFixed(2)} antenna=0.55→${antennaOff.toFixed(2)}（静止态 tone 档 ≥${String(THRESHOLD)}）`);
      expect(eyeOff, `${themeName} 关态眼必须仍可见（不是消失）`).toBeGreaterThan(1.1);
      expect(antennaOff, `${themeName} 关态天线必须仍可见`).toBeGreaterThan(1.1);
    }
  });
});
