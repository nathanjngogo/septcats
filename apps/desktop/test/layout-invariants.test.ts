/**
 * layout-invariants.test.ts —— T30-01 布局不变量门禁（对 CSS 源面做静态断言，
 * 与 ui-interaction-audit / no-magic 同范式；jsdom 不做真实布局，真机数值断言由
 * docs/mockups/cdp-audit-t30-after.mjs 的 CDP 脚本覆盖）。
 *
 * 不变量（TASK-T30-01 §2）：
 * ① 高度链闭合：html/body 定高（tokens.css 基线）+ #root 定高禁溢出（App.css）→
 *    窗口不得成为滚动容器，滚动只发生在内部滚动容器；
 * ② 主区是内部滚动容器：.sc-shell__main 保 min-height:0 + overflow:auto；
 * ③ 折叠 = 完全收起：.sc-shell--collapsed 侧栏 display:none、body 单列 1fr。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = join(here, '..', 'src', 'renderer', 'src');
const UI_SRC = join(here, '..', '..', '..', 'packages', 'ui', 'src');

const read = (path: string): string => readFileSync(path, 'utf8');

/** 取 `selector { ... }` 规则体（目标均为单选择器规则，无需完整 CSS 解析）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const appCss = read(join(RENDERER_SRC, 'App.css'));
const tokensCss = read(join(UI_SRC, 'tokens.css'));
const appShellCss = read(join(UI_SRC, 'AppShell.css'));

describe('T30-01 布局不变量：高度链闭合（窗口不滚动）', () => {
  it('tokens.css 基线：html/body 定高 100%', () => {
    expect(ruleBody(tokensCss, 'html, body')).toContain('height: 100%');
  });

  it('App.css：#root 定高 100% 且禁溢出（.sc-shell 的 height:100% 才有定高父级）', () => {
    const root = ruleBody(appCss, '#root');
    expect(root, '#root 缺 height:100%').toContain('height: 100%');
    expect(root, '#root 缺 overflow:hidden').toContain('overflow: hidden');
  });

  it('App.css：html/body 兜底禁溢出（窗口级滚动条不得出现）', () => {
    expect(ruleBody(appCss, 'html, body')).toContain('overflow: hidden');
  });
});

describe('T30-01 布局不变量：滚动只发生在内部容器', () => {
  it('.sc-shell__main 保 min-height:0 + overflow:auto（主区滚动容器）', () => {
    const main = ruleBody(appShellCss, '.sc-shell__main');
    expect(main).toContain('min-height: 0');
    expect(main).toContain('overflow: auto');
  });

  it('.sc-shell__body 保 min-height:0（1fr 行不把 shell 撑高）', () => {
    expect(ruleBody(appShellCss, '.sc-shell__body')).toContain('min-height: 0');
  });

  it('.sc-shell 定高 100%（高度链终端）', () => {
    expect(ruleBody(appShellCss, '.sc-shell')).toContain('height: 100%');
  });
});

describe('T30-01 布局不变量：折叠 = 完全收起', () => {
  it('折叠态侧栏宽度归零 + visibility:hidden（T95-01 弹簧开合；窄轨列早已退役）', () => {
    const sidebar = ruleBody(appShellCss, '.sc-shell--collapsed .sc-shell__sidebar');
    expect(sidebar, '折叠态侧栏必须退出 tab 序（visibility: hidden）').toContain('visibility: hidden');
    expect(sidebar, 'T95-01 起不再硬切（保留列结构做弹簧）').not.toContain('display: none');
    const body = ruleBody(appShellCss, '.sc-shell--collapsed .sc-shell__body');
    expect(body, '折叠 = 侧栏列宽归零').toMatch(/--sc-shell-sidebar-w:\s*0px/);
    expect(body).not.toContain('--sc-layout-sidebar-collapsed');
  });
});
