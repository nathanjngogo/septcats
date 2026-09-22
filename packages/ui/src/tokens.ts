/*
 * 本文件由 tokens/build-tokens.mjs 从仓库根 DESIGN.md 生成，请勿手工编辑。
 * 重新生成：node tokens/build-tokens.mjs --write ｜ 一致性门禁：node tokens/build-tokens.mjs --check
 */

export const colors = {
  canvas: "#F5F5F5",
  surface: "#EDEDED",
  "surface-raised": "#FFFFFF",
  content: "#FFFFFF",
  "surface-active": "#DFDFDF",
  ink: "#1A1A1A",
  "ink-secondary": "#595959",
  "ink-faint": "#6B6B6B",
  "icon-faint": "#9A9A9A",
  hairline: "#DDDDDD",
  "hairline-strong": "#C4C4C4",
  accent: "#333333",
  "accent-soft": "#E6E6E6",
  "on-accent": "#FFFFFF",
  danger: "#8A2B1C",
  "danger-soft": "#F5E5E1",
  success: "#3F6B34",
  "focus-ring": "#1A1A1A",
  selection: "#D4D4D4",
  "bevel-hi": "#FFFFFF",
  "bevel-lo": "#A9A9A9",
  "shadow-pixel": "#C6C6C6",
  "ink-edge": "#1A1A1A"
} as const;

export const colorsDark = {
  canvas: "#141414",
  surface: "#1E1E1E",
  "surface-raised": "#262626",
  content: "#0A0A0A",
  "surface-active": "#2A2A2A",
  ink: "#EDEDED",
  "ink-secondary": "#A8A8A8",
  "ink-faint": "#909090",
  "icon-faint": "#6E6E6E",
  hairline: "#2E2E2E",
  "hairline-strong": "#3F3F3F",
  accent: "#D4D4D4",
  "accent-soft": "#333333",
  "on-accent": "#141414",
  danger: "#F2B8AD",
  "danger-soft": "#3A1E1A",
  success: "#9CCB8F",
  "focus-ring": "#EDEDED",
  selection: "#3A3A3A",
  "bevel-hi": "#565656",
  "bevel-lo": "#0A0A0A",
  "shadow-pixel": "#050505",
  "ink-edge": "#EDEDED"
} as const;

export const typography = {
  "font-ui": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
  },
  "font-serif-note": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
  },
  "font-mono": {
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace"
  },
  "editor-body": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "16px",
    fontWeight: 400,
    lineHeight: 1.75,
    letterSpacing: "0.01em"
  },
  h1: {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "28px",
    fontWeight: 650,
    lineHeight: 1.3,
    letterSpacing: "-0.01em"
  },
  h2: {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "22px",
    fontWeight: 620,
    lineHeight: 1.35,
    letterSpacing: "-0.005em"
  },
  h3: {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "18px",
    fontWeight: 600,
    lineHeight: 1.4
  },
  "ui-sm": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: 1.5
  },
  "ui-md": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "14px",
    fontWeight: 450,
    lineHeight: 1.5
  },
  "ui-xs": {
    fontFamily: "Noto Sans SC, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    fontSize: "12px",
    fontWeight: 450,
    lineHeight: 1.5
  },
  code: {
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace",
    fontSize: "14px",
    fontWeight: 400,
    lineHeight: 1.6
  }
} as const;

export const rounded = {
  xs: "2px",
  sm: "2px",
  md: "4px",
  lg: "6px",
  xl: "8px",
  full: "999px"
} as const;

export const spacing = {
  xxs: "2px",
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
  gutter: "40px",
  "block-gap": "6px",
  "editor-measure": "720px"
} as const;

export const elevation = {
  "shadow-popover": "0 8px 24px -12px rgba(28,30,33,0.18), 0 2px 6px rgba(28,30,33,0.06)",
  "shadow-modal": "0 24px 64px -16px rgba(28,30,33,0.28), 0 4px 12px rgba(28,30,33,0.08)",
  "shadow-tinted-light": "0 1px 2px rgba(28,30,33,0.05)",
  "bevel-out": "inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)",
  "bevel-in": "inset 2px 2px 0 0 var(--sc-color-bevel-lo), inset -2px -2px 0 0 var(--sc-color-bevel-hi)",
  "pixel-out": "2px 2px 0 0 var(--sc-color-shadow-pixel), inset 2px 2px 0 0 var(--sc-color-bevel-hi), inset -2px -2px 0 0 var(--sc-color-bevel-lo)",
  "pixel-flat": "2px 2px 0 0 var(--sc-color-shadow-pixel)"
} as const;

export const motion = {
  fast: "120ms",
  base: "200ms",
  "spring-stiffness": 100,
  "spring-damping": 20
} as const;

export const layout = {
  topbar: "40px",
  sidebar: "240px",
  "sidebar-collapsed": "48px",
  "row-h": "36px",
  "head-h": "32px"
} as const;

export const zIndex = {
  dropdown: 20,
  "sticky-bar": 30,
  dialog: 40,
  toast: 50,
  "drop-indicator": 60
} as const;

export const easeOut = 'cubic-bezier(0.16,1,0.3,1)';

export const COLOR_NAMES = ['canvas', 'surface', 'surface-raised', 'content', 'surface-active', 'ink', 'ink-secondary', 'ink-faint', 'icon-faint', 'hairline', 'hairline-strong', 'accent', 'accent-soft', 'on-accent', 'danger', 'danger-soft', 'success', 'focus-ring', 'selection', 'bevel-hi', 'bevel-lo', 'shadow-pixel', 'ink-edge'] as const;

export const TOKEN_PREFIX = '--sc-';

export const DESIGN_SOURCE = '../../DESIGN.md';

export type ThemeName = 'light' | 'dark';

export type ColorName = (typeof COLOR_NAMES)[number];

export function colorVar(name: ColorName): string {
  return `var(--sc-color-${name})`;
}
