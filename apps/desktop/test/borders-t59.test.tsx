// @vitest-environment jsdom
/**
 * borders-t59.test.tsx —— TASK-T59-01 §1.2/§1.3/§1.4/§1.7 的 desktop 侧层测。
 *
 * 覆盖（真机数值由 docs/mockups/cdp-e2e-t59-01.mjs 覆盖）：
 *  - §1.2 主区域边界三处：编辑区顶边（`.app-editor-col .pv-root`）、AI 面板左缘
 *    （`.ai-chat`）、AI 面板置底时的横向接缝（`.app-main-row--ai-bottom .ai-chat`）；
 *  - §1.2 相邻边只画一次：标签条行宿主 / 标签条自身不得有下描边（该接缝归 `.pv-root` 独占）；
 *    编辑列不补左/右描边（归侧栏 / AI 面板）；
 *  - §1.3 T52 骑缝融合的几何契约：探出带（`.tabsbar` 高度 + padding）+ 活动标签下沉
 *    与 ∏ 形轮廓 + 提层；非活动标签只吃左描边（相邻两枚不得叠成 4px）；
 *  - §1.4 浮层（apps 侧）：CloseAskDialog / LayoutPicker = 2px ink-edge；
 *  - §1.5 不动清单：控件面（多选数据卡、侧栏重命名输入框）保持 1px hairline + bevel。
 *    —— **T62-01 已反超该条**：两处框线自 T62-01 起统一为 2px ink-edge（详见 pixel-borders 纪律测试）。
 *
 * 口径：jsdom 下 CSS 不参与计算（vitest css:false，CSS 导入被 stub），故边框断言一律
 * 磁盘读规则文本（与 css-discipline 同口径）；DOM 用例只钉「骑缝两元素同列相邻」的结构契约。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { TabsBar } from '../src/renderer/src/tabs/TabsBar';
import { pagesStore } from '../src/renderer/src/state/pages';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = join(here, '..', 'src', 'renderer', 'src');
const read = (path: string): string => readFileSync(path, 'utf8');

/**
 * 取 `selector { ... }` 规则体。
 * 选择器允许是「逗号分组」（如 `.tabsbar-tab--active, .tabsbar-tab--active:hover`），
 * 故用 `[^{}]*` 吃掉分组；`(?![\w-])` 防 `.sc-dialog` 误配 `.sc-dialog__overlay`。
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}(?![\\w-])\\s*[^{}]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const appCss = read(join(RENDERER_SRC, 'App.css'));
const tabsCss = read(join(RENDERER_SRC, 'tabs', 'TabsBar.css'));
const aiCss = read(join(RENDERER_SRC, 'ai', 'AiChatPanel.css'));
const closeAskCss = read(join(RENDERER_SRC, 'close', 'CloseAskDialog.css'));
const pickerCss = read(join(RENDERER_SRC, 'layout', 'LayoutPicker.css'));

const WS_ID = 'ws-t59-test';

function pageNode(id: string, title: string): PageNode {
  return {
    id,
    title,
    icon: null,
    cover: null,
    workspaceId: WS_ID,
    parentId: null,
    sortKey: 'A00000000',
    version: 1,
    alive: 1,
    deletedAt: null,
    childIds: [],
    depth: 0,
  };
}

beforeEach(() => {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: [pageNode('pg-1', '研究'), pageNode('pg-2', '笔记')],
    expanded: new Set<string>(),
    selectedId: 'pg-1',
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    tabs: ['pg-1', 'pg-2'],
  }));
});

afterEach(() => {
  cleanup();
});

describe('T59-01 §1.2 主区域边界（apps 侧三处）', () => {
  it('编辑区顶边 = .app-editor-col .pv-root 的 border-top 2px ink-edge', () => {
    const pvRoot = ruleBody(appCss, '.app-editor-col .pv-root');
    expect(pvRoot, '编辑区顶边缺 2px ink-edge').toContain('border-top: 2px solid var(--sc-color-ink-edge)');
  });

  it('编辑列不补左/右描边（接缝归属：左归 .sc-shell__sidebar、右归 .ai-chat，只画一次）', () => {
    const pvRoot = ruleBody(appCss, '.app-editor-col .pv-root');
    expect(pvRoot, '编辑区不得自画左右描边（会与侧栏/AI 面板叠成 4px）').not.toMatch(/border-(left|right):/);
    expect(/border:\s*\d/.test(pvRoot), '编辑区不得用 border 简写（会四边齐画）').toBe(false);
  });

  it('AI 面板左缘 = .ai-chat 的 border-left 2px ink-edge（原 1px hairline 退役）', () => {
    const ai = ruleBody(aiCss, '.ai-chat');
    expect(ai).toContain('border-left: 2px solid var(--sc-color-ink-edge)');
    expect(ai).not.toContain('border-left: 1px solid var(--sc-color-hairline)');
  });

  it('AI 面板置底：同一处接缝转为 border-top 2px ink-edge，且纵向描边归零（互斥）', () => {
    const bottom = ruleBody(appCss, '.app-main-row--ai-bottom .ai-chat');
    expect(bottom).toContain('border-top: 2px solid var(--sc-color-ink-edge)');
    expect(bottom).toContain('border-left: 0');
  });

  it('相邻边只画一次：标签条行宿主与标签条自身都不得有下描边（接缝归 .pv-root 独占）', () => {
    expect(ruleBody(tabsCss, '.app-tabrow'), '行宿主出现了下描边 → 与 .pv-root 顶边叠成 4px').not.toContain(
      'border-bottom',
    );
    expect(ruleBody(tabsCss, '.tabsbar'), '标签条出现下描边 → 破 T52「无整行分隔线」').not.toContain('border-bottom');
  });

  it('接缝只画一次：编辑列两处接缝均为「单边 border-top」显式声明（不用 border 简写 → 不四边齐画）', () => {
    // T62-01 起 App.css 另有非接缝的框线（.app-nav-input / .app-side-foot），
    // 故不再按「全文件 ink-edge 计数」断言，改为逐接缝元素断言（语义等价且更精确）。
    const seams = [
      ['.app-editor-col .pv-root', ruleBody(appCss, '.app-editor-col .pv-root')],
      ['.app-main-row--ai-bottom .ai-chat', ruleBody(appCss, '.app-main-row--ai-bottom .ai-chat')],
    ] as const;
    for (const [name, body] of seams) {
      expect(body, `${name} 缺 2px ink-edge 接缝`).toContain('border-top: 2px solid var(--sc-color-ink-edge)');
      expect(body, `${name} 不得用 border 简写（会四边齐画、与邻面叠成 4px）`).not.toMatch(
        /border:\s*2px solid var\(--sc-color-ink-edge\)/,
      );
    }
  });
});

describe('T59-01 §1.3 T52 骑缝融合几何（标签条 ↔ 正文）', () => {
  it('标签条盒探出本行 2px（高度 +2px 与 padding-bottom 同值）——压缝的几何前提', () => {
    const tabsbar = ruleBody(tabsCss, '.tabsbar');
    expect(tabsbar).toContain('height: calc(100% + var(--sc-space-xxs))');
    expect(tabsbar, '探出的 2px 必须是裁剪安全带（否则活动标签下沉被 overflow 剪掉）').toContain(
      'padding-bottom: var(--sc-space-xxs)',
    );
  });

  it('活动标签下沉 2px（负下外边距）+ ∏ 形轮廓（顶/右描边 + 基类左描边），下缘不设边', () => {
    const active = ruleBody(tabsCss, '.tabsbar-tab--active');
    expect(active).toContain('margin-bottom: calc(var(--sc-space-xxs) * -1)');
    expect(active).toContain('border-top: 2px solid var(--sc-color-ink-edge)');
    expect(active).toContain('border-right: 2px solid var(--sc-color-ink-edge)');
    expect(active, '活动标签下缘必须留空（下缘无缝）').not.toContain('border-bottom');
    expect(active).toContain('background: var(--sc-color-content)');
  });

  it('活动标签提层（position: relative + z-index > 0）——否则 .pv-root 的顶边会盖住标签底色', () => {
    const active = ruleBody(tabsCss, '.tabsbar-tab--active');
    expect(active).toContain('position: relative');
    const z = /z-index:\s*(\d+)/.exec(active)?.[1];
    expect(Number(z), '活动标签 z-index 必须是正整数才压得住 .pv-root 的描边').toBeGreaterThan(0);
  });

  it('非活动标签只吃左描边（无右描边 → 相邻两枚之间恰好 2px，不叠成 4px）', () => {
    const tab = ruleBody(tabsCss, '.tabsbar-tab');
    expect(tab).toContain('border-left: 2px solid var(--sc-color-ink-edge)');
    expect(tab).not.toMatch(/border-right:\s*[1-9]/);
    expect(tab, '不得用 border 简写（会四边齐画）').not.toMatch(/border:\s*\d/);
  });

  it('骑缝两元素同列相邻：.app-tabrow 直接子元素是 .tabsbar，活动标签在其内标 --active', () => {
    const { container } = render(<TabsBar />);
    const row = container.querySelector('.app-tabrow');
    const bar = row?.querySelector(':scope > .tabsbar');
    expect(row).not.toBeNull();
    expect(bar, '标签条必须是行宿主的直接子元素（探出带才落在 .pv-root 顶边上）').not.toBeNull();
    const active = bar?.querySelector('.tabsbar-tab--active');
    expect(active, '缺活动标签 → 骑缝断言无从谈起').not.toBeNull();
    expect(bar?.lastElementChild, '活动标签须在标签序列内（底色才与正文连通）').toBeTruthy();
  });
});

describe('T59-01 §1.4/§1.5 浮层（apps 侧）与不动清单', () => {
  it('CloseAskDialog / LayoutPicker 模态轮廓 = 2px ink-edge（原 2px hairline-strong 退役）', () => {
    for (const [css, selector] of [
      [closeAskCss, '.close-ask'],
      [pickerCss, '.layout-picker'],
    ] as const) {
      const body = ruleBody(css, selector);
      expect(body).toContain('border: 2px solid var(--sc-color-ink-edge)');
      expect(body).not.toContain('border: 2px solid var(--sc-color-hairline-strong)');
    }
  });

  it('T62-01 反超 §1.5：控件面（多选数据卡 / 侧栏重命名输入框）的框轮廓已统一吃 ink-edge', () => {
    // 老板 09-22「整个程序的所有框的线条都做成像素风黑线」→ 卡片与输入框的框线升为 2px ink-edge。
    expect(ruleBody(pickerCss, '.layout-picker__card')).toContain('border: 2px solid var(--sc-color-ink-edge)');
    expect(ruleBody(appCss, '.app-nav-input')).toContain('border: 2px solid var(--sc-color-ink-edge)');
  });
});
