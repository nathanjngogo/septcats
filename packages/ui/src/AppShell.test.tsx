import { expectTokenOnlyCssFile } from '../test/css-discipline';
import { resolvePkgFile } from '../test/pkg-root';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { Breadcrumb } from './Breadcrumb';
import { SyncPill } from './SyncPill';


describe('AppShell', () => {
  it('三段结构：topbar / sidebar / main，插槽内容就位', () => {
    const { container } = render(
      <AppShell
        breadcrumb={<Breadcrumb items={[{ label: '研究' }, { label: '暗物质探测实验笔记' }]} />}
        actions={<SyncPill state="busy" lastSyncedAt="09:41" />}
        sidebar={<nav>页面树</nav>}
      >
        <h1>暗物质探测实验笔记</h1>
      </AppShell>,
    );
    expect(container.querySelector('.sc-shell__topbar')).not.toBeNull();
    expect(container.querySelector('.sc-shell__sidebar nav')?.textContent).toBe('页面树');
    expect(container.querySelector('.sc-shell__main h1')?.textContent).toBe('暗物质探测实验笔记');
    expect(screen.getByRole('navigation', { name: '面包屑' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('同步中');
    expectTokenOnlyCssFile('src/AppShell.css');
  });

  it('侧栏折叠：切类名 + 切换按钮 label/aria-expanded 同步翻转', () => {
    const onToggleSidebar = vi.fn();
    const { container, rerender } = render(
      <AppShell sidebar={<span>树</span>} onToggleSidebar={onToggleSidebar}>
        <span>内容</span>
      </AppShell>,
    );
    const toggle = screen.getByRole('button', { name: '收起侧栏' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);

    rerender(
      <AppShell sidebar={<span>树</span>} sidebarCollapsed onToggleSidebar={onToggleSidebar}>
        <span>内容</span>
      </AppShell>,
    );
    expect(container.querySelector('.sc-shell--collapsed')).not.toBeNull();
    const expanded = screen.getByRole('button', { name: '展开侧栏' });
    expect(expanded.getAttribute('aria-expanded')).toBe('false');
  });

  it('未传 sidebar 时不渲染侧栏容器（内容区占满）', () => {
    const { container } = render(
      <AppShell>
        <span>只有内容</span>
      </AppShell>,
    );
    expect(container.querySelector('.sc-shell__sidebar')).toBeNull();
    expect(container.querySelector('.sc-shell__main')?.textContent).toBe('只有内容');
  });

  // T93-01 一级导航轨（Rail）：可选插槽 —— 不传时网格仍是两列（零影响），
  // 传了则最左多一列 rail，折叠态只收二级栏（一级导航保留）。
  it('rail 插槽：传了渲染 .sc-shell__rail + .sc-shell--rail，不传则两者都不在', () => {
    const bare = render(
      <AppShell sidebar={<span>树</span>}>
        <span>内容</span>
      </AppShell>,
    );
    expect(bare.container.querySelector('.sc-shell__rail')).toBeNull();
    expect(bare.container.querySelector('.sc-shell--rail')).toBeNull();
    bare.unmount();

    const withRail = render(
      <AppShell rail={<nav>笔记</nav>} sidebar={<span>树</span>}>
        <span>内容</span>
      </AppShell>,
    );
    expect(withRail.container.querySelector('.sc-shell--rail')).not.toBeNull();
    expect(withRail.container.querySelector('.sc-shell__rail nav')?.textContent).toBe('笔记');
    // 二级栏与主区不受影响（rail 是独立一列）
    expect(withRail.container.querySelector('.sc-shell__sidebar')?.textContent).toBe('树');
    expect(withRail.container.querySelector('.sc-shell__main')?.textContent).toBe('内容');
  });

  it('rail 的三列/折叠 CSS 契约：rail | sidebar | 1fr；折叠 = rail | 1fr', () => {
    const css = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');
    const railBody = /\.sc-shell--rail\s+\.sc-shell__body\s*\{([^}]*)\}/.exec(css);
    expect(railBody, '缺 rail 三列规则').not.toBeNull();
    expect(railBody?.[1] ?? '').toContain('--sc-layout-rail');
    // T95-01 起侧栏列宽是注册变量（弹簧驱动），不再是裸 token
    expect(railBody?.[1] ?? '').toContain('--sc-shell-sidebar-w');
    // 三列下侧栏必须落在第 2 列（与 rail 抢第 1 列 = 真机「rail 点不到」事故形态）
    const railSidebar = /\.sc-shell--rail\s+\.sc-shell__sidebar\s*\{([^}]*)\}/.exec(css);
    expect(railSidebar, '缺 rail 态侧栏列规则').not.toBeNull();
    expect(railSidebar?.[1] ?? '').toContain('grid-column: 2');
    // T95-01 起折叠不再另写列定义：侧栏列宽由 --sc-shell-sidebar-w 归零（rail 列恒在），
    // 故 rail 三列规则在折叠态同样成立（列宽 56|0|1fr），不该再出现「rail + 1fr」两列版本。
    const railCollapsed = /\.sc-shell--rail\.sc-shell--collapsed\s+\.sc-shell__body\s*\{([^}]*)\}/.exec(css);
    expect(railCollapsed, 'T95-01 后不应再有 rail 折叠专属列定义（列宽由变量驱动）').toBeNull();
    // rail 自身跨两行（通高），与侧栏同口径
    const railEl = /\.sc-shell__rail\s*\{([^}]*)\}/.exec(css);
    expect(railEl?.[1] ?? '').toContain('grid-row: 1 / 3');
  });

  // TASK-T30-01 §①：折叠 = 完全收起（宽度 0），不再是窄轨占位。
  // jsdom 不做布局，这里按 css-discipline 同范式对 AppShell.css 源面做静态契约断言；
  // 真机数值断言（getBoundingClientRect().width === 0）由 docs/mockups/cdp-audit-t30-after.mjs 覆盖。
  it('折叠态 CSS 契约：列宽归零 + visibility:hidden + 弹簧过渡（T95-01）', () => {
    const css = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');
    const collapsedSidebar = /\.sc-shell--collapsed\s+\.sc-shell__sidebar\s*\{([^}]*)\}/.exec(css);
    expect(collapsedSidebar, '缺折叠态侧栏规则').not.toBeNull();
    // T95-01：不再 display:none 硬切 —— 折叠靠「列宽归零 + visibility:hidden（延迟到动画结束）」
    expect(collapsedSidebar?.[1] ?? '').toContain('visibility: hidden');
    expect(collapsedSidebar?.[1] ?? '').toContain('--sc-motion-drawer');
    expect(collapsedSidebar?.[1] ?? '').not.toContain('display: none');
    const collapsedBody = /\.sc-shell--collapsed\s+\.sc-shell__body\s*\{([^}]*)\}/.exec(css);
    expect(collapsedBody, '缺折叠态 body 列规则').not.toBeNull();
    // 归零的是注册属性（<length> 才能过渡），窄轨 token 早已退役
    expect(collapsedBody?.[1] ?? '').toMatch(/--sc-shell-sidebar-w:\s*0px/);
    expect(collapsedBody?.[1] ?? '').not.toContain('--sc-layout-sidebar-collapsed');
    // 基态列宽吃变量 + 弹簧过渡装在 body（属性变化的那一层）
    const baseBody = /\.sc-shell__body\s*\{([^}]*)\}/.exec(css);
    expect(baseBody?.[1] ?? '').toContain('grid-template-columns: var(--sc-shell-sidebar-w) 1fr');
    expect(baseBody?.[1] ?? '').toMatch(/transition:\s*--sc-shell-sidebar-w\s+var\(--sc-motion-drawer\)/);
    // 注册属性：未注册的自定义属性是离散量、过渡不插值
    expect(css).toContain("syntax: '<length>'");
  });
});
