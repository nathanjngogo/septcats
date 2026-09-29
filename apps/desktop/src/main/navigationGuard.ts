/*
 * navigationGuard.ts —— 外链与导航兜底（TASK-T96-01；0.6.9 安装包审核 A8 发现）
 *
 * 症状（静态包审取证）：构建产物的主进程里既没有 `setWindowOpenHandler` 也没有
 * `will-navigate` 拦截 —— renderer 侧任何 `window.open` / `<a target="_blank">` /
 * 未被应用拦下的 `<a href>` 都走 Electron 默认行为：**新开一个真窗口**，或**把主窗直接
 * 导航到远端页面**。两条路都绕过 `shell:openExternal` 的「协议白名单唯一出口」（T73-01）：
 *   · 新窗口不受应用 chrome 约束（用户看到一个不是 Septcats 的窗口）；
 *   · 主窗被导航走 = 应用外壳被远端页占用（Electron 安全清单「限制导航」一条）。
 *
 * 收口规则（本模块是纯函数 + 薄接线，注入 isInternal / routeExternal，便于单测）：
 *   · 站内（`file://`、dev server，以及导航场景下的 `asset:`/`attachment:` 内部协议）
 *     → 放行（应用自身重载/路由/内联附件视图不被打断）；
 *   · **新窗口一律只许应用页**：`window.open('asset://…')` 这种「给内部协议开新窗」没有意义，
 *     一律 deny（实测后果：放行后 Chromium 找不到处理者 → 留下一个空白窗）；
 *   · 站外 `http`/`https` → 拒绝，并交给**同一条白名单链路**
 *     （`resolveExternalUrl` → `shell.openExternal`）；
 *   · 其他协议（`javascript:` / `data:` / `jar:` …）→ 拒绝且**不外发**
 *     （不把可疑协议甩给系统；`resolveExternalUrl` 也会再拒一次，这里是显式第二道）。
 *
 * 审计只记 host / protocol，不落 URL 原文（与 shell.ts 同口径）。
 */
import { resolveExternalUrl } from './shell';

/** 站外链接的放行出口（默认实现住 index.ts：shell.openExternal）。 */
export type RouteExternal = (url: string) => void;

export interface NavigationGuardDeps {
  /** 站内判定（应用自身页面 / 内部协议 / dev server）。 */
  isInternal: (url: string) => boolean;
  /** 允许给该 URL 开新窗口吗（默认允许；内部协议实现者应返回 false）。 */
  isWindowOpenAllowed?: (url: string) => boolean;
  /** 站外放行出口。 */
  routeExternal: RouteExternal;
  /** 审计回调（只记 host/protocol）。 */
  audit?: (event: 'window-open' | 'navigate', decision: NavigationDecision['reason'], host: string, protocol: string) => void;
}

/** 触发场景：window-open（新窗口）与 navigate（主窗导航）**权限不同**。 */
export type NavigationKind = 'window-open' | 'navigate';

export interface NavigationDecision {
  /** 交给 Electron 的结果：allow = 放行（站内）；deny = 拦下。 */
  action: 'allow' | 'deny';
  /** 是否已把链接转交系统浏览器。 */
  routed: boolean;
  reason: 'internal' | 'external-routed' | 'protocol-blocked';
}

/** 从 URL 里安全取 host / protocol（畸形 → 空串；审计用，不含原文）。 */
function auditParts(url: string): { host: string; protocol: string } {
  const resolved = resolveExternalUrl(url);
  if (resolved.ok) {
    return { host: resolved.url.host, protocol: resolved.url.protocol };
  }
  return { host: '', protocol: resolved.protocol };
}

/**
 * 纯函数：给定目标 URL 与站内判定，算出该怎么处理（不触碰 Electron）。
 * 站内 → allow；站外可放行协议 → deny + 转交；其余 → deny + 不转交。
 */
export function decideNavigation(url: string, deps: NavigationGuardDeps, kind: NavigationKind = 'navigate'): NavigationDecision {
  const parts = auditParts(url);
  const report = (reason: NavigationDecision['reason']): void => {
    deps.audit?.('navigate', reason, parts.host, parts.protocol);
  };
  // 新窗口只放行「应用页」：内部协议给 window.open 开新窗没有意义（会留空白窗），
  // 站内判定把这一层压给调用方（isInternal 只描述「应用页」语义）。
  if (deps.isInternal(url) && (kind === 'navigate' || deps.isWindowOpenAllowed?.(url) !== false)) {
    report('internal');
    return { action: 'allow', routed: false, reason: 'internal' };
  }
  const resolved = resolveExternalUrl(url);
  if (!resolved.ok) {
    report('protocol-blocked');
    return { action: 'deny', routed: false, reason: 'protocol-blocked' };
  }
  deps.routeExternal(resolved.url.href);
  report('external-routed');
  return { action: 'deny', routed: true, reason: 'external-routed' };
}

/** 只描述本模块真正用到的两个 Electron 面（避免把 Electron 类型拖进单测）。 */
export interface GuardableContents {
  setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'allow' | 'deny' }) => void;
  on: (event: 'will-navigate', listener: (event: { preventDefault: () => void }, url: string) => void) => void;
}

/**
 * 把守卫挂到 webContents 上：`window.open` / `<a target="_blank">`（window-open）
 * 与主窗导航（navigate）两条路一起收。
 */
export function attachNavigationGuard(contents: GuardableContents, deps: NavigationGuardDeps): void {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(
      url,
      {
        ...deps,
        audit: (event, reason, host, protocol) => {
          deps.audit?.(event === 'navigate' ? 'window-open' : event, reason, host, protocol);
        },
      },
      'window-open',
    );
    return { action: decision.action };
  });
  contents.on('will-navigate', (event, url) => {
    const decision = decideNavigation(url, deps);
    if (decision.action === 'deny') {
      event.preventDefault();
    }
  });
}