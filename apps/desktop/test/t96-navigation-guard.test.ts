/**
 * t96-navigation-guard.test.ts —— 主进程外链/导航兜底单测（TASK-T96-01）
 *
 * 背景（0.6.9 静态包审 A8）：构建产物里既无 setWindowOpenHandler 也无 will-navigate 拦截面，
 * renderer 的 window.open / target=_blank / 未拦下的 <a href> 会新开真窗口或把主窗导航到远端，
 * 绕过 shell:openExternal 的协议白名单唯一出口（T73-01）。
 *
 * 本测钉住纯函数的决策表 + 两条接线（window-open / navigate）的拦截行为：
 *   站内 file:// → allow 且不外发；dev server 前缀 → allow；
 *   站外 https → deny + 恰好转交一次；javascript:/data: → deny 且不转交；
 *   导航拦截：站外 preventDefault，站内不 preventDefault。
 */
import { describe, expect, it } from 'vitest';
import { attachNavigationGuard, decideNavigation } from '../src/main/navigationGuard';
import type { NavigationDecision } from '../src/main/navigationGuard';

interface Harness {
  routed: string[];
  audits: string[];
  deps: Parameters<typeof decideNavigation>[1];
}

function harness(isInternal: (url: string) => boolean): Harness {
  const routed: string[] = [];
  const audits: string[] = [];
  return {
    routed,
    audits,
    deps: {
      isInternal,
      routeExternal: (url) => { routed.push(url); },
      audit: (event, reason, host) => { audits.push(`${event}:${reason}:${host}`); },
    },
  };
}

/** 假 webContents：抓住注册进来的两个回调，便于手动触发。 */
function fakeContents() {
  const handlers = { windowOpen: null, navigate: null } as {
    windowOpen: ((d: { url: string }) => { action: 'allow' | 'deny' }) | null;
    navigate: ((e: { preventDefault: () => void }, url: string) => void) | null;
  };
  return {
    handlers,
    contents: {
      setWindowOpenHandler: (h: (d: { url: string }) => { action: 'allow' | 'deny' }) => { handlers.windowOpen = h; },
      on: (_event: 'will-navigate', l: (e: { preventDefault: () => void }, url: string) => void) => { handlers.navigate = l; },
    },
  };
}

const isInternalFile = (url: string): boolean => url.startsWith('file://');

describe('T96-01 决策表（decideNavigation）', () => {
  const cases: Array<[string, NavigationDecision['reason'], 'allow' | 'deny', boolean]> = [
    ['file:///app/out/renderer/index.html', 'internal', 'allow', false],
    ['https://example.com/a', 'external-routed', 'deny', true],
    ['http://localhost:5173/', 'external-routed', 'deny', true],
    ['javascript:alert(1)', 'protocol-blocked', 'deny', false],
    ['data:text/html,<h1>x</h1>', 'protocol-blocked', 'deny', false],
    ['septcats://nope', 'protocol-blocked', 'deny', false],
    ['   ', 'protocol-blocked', 'deny', false],
  ];
  for (const [url, reason, action, routed] of cases) {
    it(`${url} → ${action} / ${reason}`, () => {
      const h = harness(isInternalFile);
      const d = decideNavigation(url, h.deps);
      expect(d).toEqual({ action, routed, reason });
      expect(h.routed.length).toBe(routed ? 1 : 0);
      expect(h.audits.length, '每次决策都要留审计（只记 host/protocol，不含原文）').toBe(1);
      expect(h.audits[0], '审计不得包含 URL 原文').not.toContain('example.com/a');
    });
  }

  it('站内判定优先：dev server 前缀放行，且不外发也不当成站外', () => {
    const h = harness((url) => url.startsWith('file://') || url.startsWith('http://localhost:5173'));
    const d = decideNavigation('http://localhost:5173/index.html', h.deps);
    expect(d.action).toBe('allow');
    expect(h.routed).toEqual([]);
  });

  it('审计只记 host/protocol：https://user:pw@example.com/x 不把凭据带进日志', () => {
    const h = harness(isInternalFile);
    decideNavigation('https://user:pw@example.com/x', h.deps);
    expect(h.audits[0]).toContain('example.com');
    expect(h.audits[0]).not.toContain('pw');
  });
});

describe('T96-01 接线（attachNavigationGuard）', () => {
  it('window.open 站外 → deny 且转交系统浏览器一次', () => {
    const h = harness(isInternalFile);
    const f = fakeContents();
    attachNavigationGuard(f.contents, h.deps);
    expect(f.handlers.windowOpen, '缺 window-open 拦截').not.toBeNull();
    const r = f.handlers.windowOpen?.({ url: 'https://example.com/x' });
    expect(r).toEqual({ action: 'deny' });
    expect(h.routed).toEqual(['https://example.com/x']);
  });

  it('window.open 站内 → allow 且不外发', () => {
    const h = harness(isInternalFile);
    const f = fakeContents();
    attachNavigationGuard(f.contents, h.deps);
    const r = f.handlers.windowOpen?.({ url: 'file:///app/out/renderer/index.html#/x' });
    expect(r).toEqual({ action: 'allow' });
    expect(h.routed).toEqual([]);
  });

  it('will-navigate 站外 → preventDefault + 转交；站内 → 不拦（reload 不被断）', () => {
    const h = harness(isInternalFile);
    const f = fakeContents();
    attachNavigationGuard(f.contents, h.deps);
    expect(f.handlers.navigate, '缺导航拦截').not.toBeNull();
    let prevented = 0;
    const ev = { preventDefault: () => { prevented += 1; } };
    f.handlers.navigate?.(ev, 'https://example.com/y');
    expect(prevented, '站外导航必须被拦下').toBe(1);
    expect(h.routed).toEqual(['https://example.com/y']);
    f.handlers.navigate?.(ev, 'file:///app/out/renderer/index.html');
    expect(prevented, '站内导航不得被拦（否则 location.reload 会把应用卡死）').toBe(1);
  });

  it('内部协议（asset:/attachment:）：可导航、但**不可开新窗**（实测放行会留空白窗）', () => {
    const isAppPage = (url: string): boolean => url.startsWith('file://');
    const isInternal = (url: string): boolean => isAppPage(url) || url.startsWith('asset:') || url.startsWith('attachment:');
    const h = harness(isInternal);
    const deps = { ...h.deps, isWindowOpenAllowed: isAppPage };
    const f = fakeContents();
    attachNavigationGuard(f.contents, deps);
    expect(f.handlers.windowOpen?.({ url: 'asset://note/1.png' })).toEqual({ action: 'deny' });
    expect(h.routed, '内部协议不该被甩给系统浏览器').toEqual([]);
    let prevented = 0;
    f.handlers.navigate?.({ preventDefault: () => { prevented += 1; } }, 'asset://note/1.png');
    expect(prevented, '内部协议导航要放行（应用自己的图床/附件视图）').toBe(0);
  });

  it('window-open 的审计事件名记为 window-open（与导航区分）', () => {
    const h = harness(isInternalFile);
    const f = fakeContents();
    attachNavigationGuard(f.contents, h.deps);
    f.handlers.windowOpen?.({ url: 'https://example.com/z' });
    expect(h.audits[0]?.startsWith('window-open:')).toBe(true);
  });
});