/*
 * 本文件由 tokens/build-tokens.mjs 从仓库根 DESIGN.md 生成，请勿手工编辑。
 * 重新生成：node tokens/build-tokens.mjs --write ｜ 一致性门禁：node tokens/build-tokens.mjs --check
 */

export const colors = {
  canvas: "#FBFBFA",
  surface: "#F4F4F2",
  "surface-raised": "#FFFFFF",
  ink: "#1C1E21",
  "ink-secondary": "#5B6068",
  "ink-faint": "#8A8F98",
  hairline: "#E6E6E2",
  "hairline-strong": "#D2D2CC",
  accent: "#A16207",
  "accent-soft": "#F6EEDD",
  "on-accent": "#FFFFFF",
  danger: "#8A2B1C",
  "danger-soft": "#FBEFEC",
  success: "#3F6B34",
  "focus-ring": "#A16207",
  selection: "#E8DDBC"
} as const;

export const colorsDark = {
  canvas: "#16181B",
  surface: "#1E2124",
  "surface-raised": "#26292D",
  ink: "#E9E9E6",
  "ink-secondary": "#A3A8AF",
  "ink-faint": "#6E737B",
  hairline: "#2C2F34",
  "hairline-strong": "#3B3F45",
  accent: "#D9A441",
  "accent-soft": "#33290F",
  "on-accent": "#1C1E21",
  danger: "#F2B8AD",
  "danger-soft": "#3A1E1A",
  success: "#9CCB8F",
  "focus-ring": "#D9A441",
  selection: "#42381C"
} as const;

export const typography = {
  "font-ui": {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
  },
  "font-serif-note": {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
  },
  "font-mono": {
    fontFamily: "Geist Mono, Sarasa Mono SC, Microsoft YaHei Mono, Consolas, monospace"
  },
  "editor-body": {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    fontSize: "16px",
    fontWeight: 400,
    lineHeight: 1.75,
    letterSpacing: "0.01em"
  },
  h1: {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    fontSize: "28px",
    fontWeight: 650,
    lineHeight: 1.3,
    letterSpacing: "-0.01em"
  },
  h2: {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    fontSize: "22px",
    fontWeight: 620,
    lineHeight: 1.35,
    letterSpacing: "-0.005em"
  },
  h3: {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    fontSize: "18px",
    fontWeight: 600,
    lineHeight: 1.4
  },
  "ui-sm": {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: 1.5
  },
  "ui-xs": {
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
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
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
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
  "shadow-tinted-light": "0 1px 2px rgba(28,30,33,0.05)"
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

export const COLOR_NAMES = ['canvas', 'surface', 'surface-raised', 'ink', 'ink-secondary', 'ink-faint', 'hairline', 'hairline-strong', 'accent', 'accent-soft', 'on-accent', 'danger', 'danger-soft', 'success', 'focus-ring', 'selection'] as const;

export const TOKEN_PREFIX = '--sc-';

export const DESIGN_SOURCE = '../../DESIGN.md';

export type ThemeName = 'light' | 'dark';

export type ColorName = (typeof COLOR_NAMES)[number];

export function colorVar(name: ColorName): string {
  return `var(--sc-color-${name})`;
}
