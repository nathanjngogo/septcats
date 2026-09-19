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

  // TASK-T30-01 §①：折叠 = 完全收起（宽度 0），不再是窄轨占位。
  // jsdom 不做布局，这里按 css-discipline 同范式对 AppShell.css 源面做静态契约断言；
  // 真机数值断言（getBoundingClientRect().width === 0）由 docs/mockups/cdp-audit-t30-after.mjs 覆盖。
  it('折叠态 CSS 契约：侧栏 display:none、body 单列 1fr（主区占满）', () => {
    const css = readFileSync(resolvePkgFile('src/AppShell.css'), 'utf8');
    const collapsedSidebar = /\.sc-shell--collapsed\s+\.sc-shell__sidebar\s*\{([^}]*)\}/.exec(css);
    expect(collapsedSidebar, '缺折叠态侧栏规则').not.toBeNull();
    expect(collapsedSidebar?.[1] ?? '').toContain('display: none');
    const collapsedBody = /\.sc-shell--collapsed\s+\.sc-shell__body\s*\{([^}]*)\}/.exec(css);
    expect(collapsedBody, '缺折叠态 body 列规则').not.toBeNull();
    // 单列 1fr：窄轨列（--sc-layout-sidebar-collapsed）不再占位
    expect(collapsedBody?.[1] ?? '').toMatch(/grid-template-columns:\s*1fr/);
    expect(collapsedBody?.[1] ?? '').not.toContain('--sc-layout-sidebar-collapsed');
  });
});
