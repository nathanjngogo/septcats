/**
 * close-guard.test.ts —— 关窗拦截器单测（TASK-T54-01 §2）。
 *
 * 只测纯 Node 面（main/closeGuard.ts 与 main/trayTemplate.ts，均不 import electron 运行时）：
 * - trayClose 三态路由（ask / tray / quit）；
 * - quittingFlag 语义（真退出不弹框、用户关窗才弹框；exiting 后放行）；
 * - 冲刷握手：ack 到齐（无 WARNING）/ 超时兜底（2s 语义 + WARNING 日志 + 继续流程）；
 * - 重入保护与「记住我的选择」持久化（cancel 记回 ask）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings } from '@septcats/platform';
import {
  CloseGuard,
  FLUSH_TIMEOUT_MS,
  parseCloseDecision,
  parseTrayClose,
  persistModeFor,
  routeTrayClose,
  shouldInterceptClose,
  type CloseGuardDeps,
} from '../src/main/closeGuard';
import { buildTrayMenuTemplate, trayText } from '../src/main/trayTemplate';
import { enUS } from '../src/renderer/src/i18n/en-US';
import { zhCN } from '../src/renderer/src/i18n/zh-CN';

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询等待谓词成立（真实定时器；超时抛错带当前状态）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000, label = '条件'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await wait(5);
  }
  throw new Error(`waitFor 超时：${label}`);
}

interface Harness {
  guard: CloseGuard;
  deps: CloseGuardDeps;
  /** 主进程侧副作用轨迹（断言原始值用）。 */
  log: { info: string[]; warn: string[] };
  flushes: string[];
  asks: number;
  hides: number;
  quits: number;
  persists: string[];
  quitting: boolean;
  /** 手工 ack 在途冲刷（默认不自动 ack = 走超时分支）。 */
  ackLatest(): boolean;
}

function harness(options: { trayClose?: unknown; quitting?: boolean; timeoutMs?: number; autoAck?: boolean } = {}): Harness {
  const log = { info: [] as string[], warn: [] as string[] };
  const state = {
    flushes: [] as string[],
    asks: 0,
    hides: 0,
    quits: 0,
    persists: [] as string[],
    quitting: options.quitting ?? false,
    lastRequestId: '',
  };
  const deps: CloseGuardDeps = {
    isQuitting: () => state.quitting,
    setQuitting: (value) => {
      state.quitting = value;
    },
    readTrayClose: () => options.trayClose ?? 'ask',
    sendFlush: (requestId) => {
      state.flushes.push(requestId);
      state.lastRequestId = requestId;
      if (options.autoAck === true) {
        queueMicrotask(() => guard.ackFlush(requestId));
      }
    },
    sendAsk: () => {
      state.asks += 1;
    },
    hideToTray: () => {
      state.hides += 1;
    },
    quitApp: () => {
      state.quits += 1;
    },
    persistTrayClose: (mode) => {
      state.persists.push(mode);
    },
    newRequestId: () => `req-${String(state.flushes.length + 1)}`,
    log: {
      info: (message) => log.info.push(message),
      warn: (message) => log.warn.push(message),
    },
  };
  if (options.timeoutMs !== undefined) {
    deps.timeoutMs = options.timeoutMs;
  }
  const guard = new CloseGuard(deps);
  return {
    guard,
    deps,
    log,
    get flushes() {
      return state.flushes;
    },
    get asks() {
      return state.asks;
    },
    get hides() {
      return state.hides;
    },
    get quits() {
      return state.quits;
    },
    get persists() {
      return state.persists;
    },
    get quitting() {
      return state.quitting;
    },
    set quitting(value: boolean) {
      state.quitting = value;
    },
    ackLatest: () => guard.ackFlush(state.lastRequestId),
  };
}

describe('closeGuard 纯函数（T54-01 §2）', () => {
  it('parseTrayClose：tray/quit/ask 直通，未知值回落 ask（询问是安全默认）', () => {
    expect(parseTrayClose('tray')).toBe('tray');
    expect(parseTrayClose('quit')).toBe('quit');
    expect(parseTrayClose('ask')).toBe('ask');
    expect(parseTrayClose('minimize')).toBe('ask');
    expect(parseTrayClose(undefined)).toBe('ask');
    expect(parseTrayClose(0)).toBe('ask');
  });

  it('shouldInterceptClose：用户关窗拦、quittingFlag 真退不拦（由调用链做冲刷）', () => {
    expect(shouldInterceptClose(false)).toBe(true);
    expect(shouldInterceptClose(true)).toBe(false);
  });

  it('routeTrayClose：三态恒等（无隐式分支）', () => {
    expect([routeTrayClose('ask'), routeTrayClose('tray'), routeTrayClose('quit')]).toEqual([
      'ask',
      'tray',
      'quit',
    ]);
  });

  it('persistModeFor：勾选才持久化；cancel 勾选记回 ask；不勾选 → null', () => {
    expect(persistModeFor('tray', true)).toBe('tray');
    expect(persistModeFor('quit', true)).toBe('quit');
    expect(persistModeFor('cancel', true)).toBe('ask');
    expect(persistModeFor('tray', false)).toBeNull();
    expect(persistModeFor('quit', false)).toBeNull();
    expect(persistModeFor('cancel', false)).toBeNull();
  });

  it('parseCloseDecision：合法载荷收 remember 布尔；非法 action / 非对象抛 E_MALFORMED', () => {
    expect(parseCloseDecision({ action: 'tray', remember: true })).toEqual({ action: 'tray', remember: true });
    expect(parseCloseDecision({ action: 'quit' })).toEqual({ action: 'quit', remember: false });
    expect(parseCloseDecision({ action: 'cancel', remember: 'yes' })).toEqual({
      action: 'cancel',
      remember: false,
    });
    expect(() => parseCloseDecision({ action: 'minimize' })).toThrow(/E_MALFORMED/);
    expect(() => parseCloseDecision(null)).toThrow(/E_MALFORMED/);
    expect(() => parseCloseDecision(['tray'])).toThrow(/E_MALFORMED/);
  });

  it('FLUSH_TIMEOUT_MS = 2000（任务书 §1① 的 2s 兜底口径）', () => {
    expect(FLUSH_TIMEOUT_MS).toBe(2000);
  });
});

describe('closeGuard 状态机（T54-01 §2）', () => {
  it('用户关窗 + trayClose=ask：先冲刷（ack 到齐）再弹询问框；选「最小化到托盘」→ 只隐藏不退出', async () => {
    const h = harness({ trayClose: 'ask', autoAck: true });
    expect(h.guard.requestClose()).toBe(true); // 拦
    await waitFor(() => h.asks === 1, 1000, '询问框弹出');
    expect(h.flushes).toHaveLength(1);
    expect(h.quits).toBe(0);
    expect(h.hides).toBe(0);
    expect(h.guard.currentState).toBe('asking');
    expect(h.log.warn).toEqual([]); // ack 到齐 → 零 WARNING

    h.guard.resolveAsk({ action: 'tray', remember: false });
    await waitFor(() => h.hides === 1, 1000, '隐藏到托盘');
    expect(h.guard.currentState).toBe('idle');
    expect(h.quits).toBe(0);
    expect(h.persists).toEqual([]);
    expect(h.guard.trace).toMatchObject({ acked: true, mode: 'ask', decision: 'tray', persisted: null });
  });

  it('冲刷超时兜底：renderer 不 ack → 2s 口径记 WARNING 后继续走完流程（不挂住窗口）', async () => {
    const h = harness({ trayClose: 'ask', timeoutMs: 40, autoAck: false });
    expect(h.guard.requestClose()).toBe(true);
    await waitFor(() => h.asks === 1, 1000, '超时后仍弹询问框');
    expect(h.log.warn.some((line) => line.includes('未在 40ms 内收到 ack'))).toBe(true);
    // 迟到的 ack 不匹配在途请求（在途请求已清空）→ WARNING 但不改状态
    expect(h.guard.ackFlush('req-1')).toBe(false);
    expect(h.log.warn.some((line) => line.includes('flushAck 与在途请求不匹配'))).toBe(true);
    h.guard.resolveAsk({ action: 'cancel', remember: false });
    await waitFor(() => h.guard.trace !== null, 1000, '决议落地');
    expect(h.guard.trace?.acked).toBe(false);
    expect(h.guard.trace?.waitedMs).toBeGreaterThanOrEqual(40);
    expect(h.guard.trace?.decision).toBe('cancel');
  });

  it('flushEditor ack 到齐：waited 原始值 + 无 WARNING；ack 不匹配 requestId → false', async () => {
    const h = harness({ autoAck: true });
    const report = await h.guard.flushEditor();
    expect(report.acked).toBe(true);
    expect(report.requestId).toBe('req-1');
    expect(report.waitedMs).toBeGreaterThanOrEqual(0);
    expect(h.log.warn).toEqual([]);
    expect(h.guard.ackFlush('req-999')).toBe(false);
    expect(h.log.warn).toEqual([expect.stringContaining('不匹配')]);
  });

  it('quittingFlag=true（真退出）：冲刷后直接退出，**不弹询问框**；此后 close 放行', async () => {
    const h = harness({ quitting: true, autoAck: true });
    expect(h.guard.requestClose()).toBe(true); // 拦一次做冲刷
    await waitFor(() => h.quits === 1, 1000, 'app.quit');
    expect(h.asks).toBe(0);
    expect(h.flushes).toHaveLength(1);
    expect(h.guard.currentState).toBe('exiting');
    expect(h.guard.requestClose()).toBe(false); // exiting → 放行（不再拦）
  });

  it('trayClose=quit：用户关窗也不弹框，冲刷后退出', async () => {
    const h = harness({ trayClose: 'quit', autoAck: true });
    expect(h.guard.requestClose()).toBe(true);
    await waitFor(() => h.quits === 1, 1000, 'app.quit');
    expect(h.asks).toBe(0);
    expect(h.hides).toBe(0);
    expect(h.quitting).toBe(true); // 置了 quittingFlag（后续 close 不重复流程）
    expect(h.guard.trace).toMatchObject({ mode: 'quit', decision: 'quit', persisted: null });
  });

  it('trayClose=tray：用户关窗直接隐藏到托盘（不弹框、不退出、状态回 idle）', async () => {
    const h = harness({ trayClose: 'tray', autoAck: true });
    expect(h.guard.requestClose()).toBe(true);
    await waitFor(() => h.hides === 1, 1000, '隐藏');
    expect(h.asks).toBe(0);
    expect(h.quits).toBe(0);
    expect(h.guard.currentState).toBe('idle');
    expect(h.guard.trace).toMatchObject({ acked: true, mode: 'tray', decision: 'tray' });
  });

  it('重入保护：流程在途时再次 close 仍拦（true）但不再发第二次 editor:flush', async () => {
    const h = harness({ trayClose: 'ask', timeoutMs: 30 });
    expect(h.guard.requestClose()).toBe(true);
    expect(h.guard.requestClose()).toBe(true);
    await waitFor(() => h.asks === 1, 1000, '询问框');
    expect(h.flushes).toHaveLength(1);
    expect(h.guard.currentState).toBe('asking');
    expect(h.guard.requestClose()).toBe(true); // 询问中也拦，防重复弹
  });

  it('「记住我的选择」：勾选 tray 写 tray；勾选 quit 写 quit；cancel 勾选记回 ask；不勾选不写', async () => {
    const cases: Array<{ action: 'tray' | 'quit' | 'cancel'; remember: boolean; expected: string[] }> = [
      { action: 'tray', remember: true, expected: ['tray'] },
      { action: 'quit', remember: true, expected: ['quit'] },
      { action: 'cancel', remember: true, expected: ['ask'] },
      { action: 'cancel', remember: false, expected: [] },
    ];
    for (const item of cases) {
      const h = harness({ trayClose: 'ask', autoAck: true });
      h.guard.requestClose();
      await waitFor(() => h.asks === 1, 1000, '询问框');
      h.guard.resolveAsk({ action: item.action, remember: item.remember });
      await waitFor(() => h.guard.trace?.decision === item.action, 1000, '决议落地');
      expect(h.persists, `action=${item.action} remember=${String(item.remember)}`).toEqual(item.expected);
      expect(h.guard.trace?.persisted).toBe(item.expected[0] ?? null);
    }
  });

  it('取消：窗口保持、进程不退、状态回 idle（下一个 close 重新走完整流程）', async () => {
    const h = harness({ trayClose: 'ask', autoAck: true });
    h.guard.requestClose();
    await waitFor(() => h.asks === 1, 1000, '询问框');
    h.guard.resolveAsk({ action: 'cancel', remember: false });
    await waitFor(() => h.guard.currentState === 'idle', 1000, '取消收尾');
    expect(h.hides).toBe(0);
    expect(h.quits).toBe(0);
    expect(h.guard.requestClose()).toBe(true); // 可再次触发
    await waitFor(() => h.asks === 2, 1000, '二次询问');
  });

  it('窗口销毁收尾：在途询问按取消结算、状态回 idle（不留悬挂 Promise）', async () => {
    const h = harness({ trayClose: 'ask', autoAck: true });
    h.guard.requestClose();
    await waitFor(() => h.asks === 1, 1000, '询问框');
    h.guard.onWindowDestroyed('测试销毁');
    await waitFor(() => h.guard.currentState === 'idle', 1000, '收尾');
    expect(h.guard.trace).toMatchObject({ decision: 'cancel' });
    expect(h.log.warn.some((line) => line.includes('窗口已销毁'))).toBe(true);
    expect(h.hides).toBe(0);
    expect(h.quits).toBe(0);
  });

  it('无在途询问时的 close:decide 幂等忽略（记 WARNING，不误触发动作）', () => {
    const h = harness({ trayClose: 'ask' });
    h.guard.resolveAsk({ action: 'quit', remember: false });
    expect(h.quits).toBe(0);
    expect(h.log.warn.some((line) => line.includes('无在途询问'))).toBe(true);
  });

  it('trayClose 非法值（写坏设置）→ 回落 ask 弹框（不静默退出/隐藏）', async () => {
    const h = harness({ trayClose: 'minimize-to-tray', autoAck: true });
    h.guard.requestClose();
    await waitFor(() => h.asks === 1, 1000, '询问框');
    expect(h.hides).toBe(0);
    expect(h.quits).toBe(0);
  });
});

describe('托盘菜单模板（T54-01 §1③）', () => {
  it('同步状态行（T84-01 新增）+ 两项动作：显示主窗口 / 退出；label 全取自 i18n menu 字典（zh 中 / en 英）', () => {
    const zh = buildTrayMenuTemplate('zh-CN', { show: () => undefined, quit: () => undefined });
    const en = buildTrayMenuTemplate('en-US', { show: () => undefined, quit: () => undefined });
    expect(zh.map((item) => item.label ?? item.type)).toEqual([
      `${zhCN.menu.traySync}：${zhCN.menu.traySyncOff}`,
      'separator',
      zhCN.menu.trayShow,
      'separator',
      zhCN.menu.trayQuit,
    ]);
    expect(en.map((item) => item.label ?? item.type)).toEqual([
      `${enUS.menu.traySync}: ${enUS.menu.traySyncOff}`, // en 用半角冒号（traySyncLabel 按 locale 分支）
      'separator',
      enUS.menu.trayShow,
      'separator',
      enUS.menu.trayQuit,
    ]);
    expect(trayText('zh-CN', 'trayShow')).toBe(zhCN.menu.trayShow);
    expect(trayText('en-US', 'trayQuit')).toBe(enUS.menu.trayQuit);
    // 状态行不可点（enabled:false），动作项可点
    expect(zh[0]?.enabled).toBe(false);
  });

  it('状态行随同步态变化：待传计数 / 同步中 / 出错 / 文件夹不可访问', () => {
    const label = (status: Parameters<typeof buildTrayMenuTemplate>[2]): string =>
      String(buildTrayMenuTemplate('zh-CN', { show: () => undefined, quit: () => undefined }, status)[0]?.label);
    expect(label({ enabled: true, state: 'idle', pendingSegs: 0 })).toBe(`同步：${zhCN.menu.traySyncIdleOk}`);
    expect(label({ enabled: true, state: 'ok', pendingSegs: 3 })).toBe(`同步：${zhCN.menu.traySyncPending} (3)`);
    expect(label({ enabled: true, state: 'syncing', pendingSegs: 2 })).toBe(`同步：${zhCN.menu.traySyncActive} (2)`);
    expect(label({ enabled: true, state: 'error', pendingSegs: 0 })).toBe(`同步：${zhCN.menu.traySyncError}`);
    expect(label({ enabled: true, state: 'key_mismatch', pendingSegs: 0 })).toBe(`同步：${zhCN.menu.traySyncError}`);
    expect(label({ enabled: true, state: 'degraded', pendingSegs: 0 })).toBe(`同步：${zhCN.menu.traySyncDegraded}`);
    expect(label({ enabled: false, state: 'ok', pendingSegs: 9 })).toBe(`同步：${zhCN.menu.traySyncOff}`);
  });

  it('点击派发到注入的动作（show / quit 各自独立）', () => {
    const calls: string[] = [];
    const template = buildTrayMenuTemplate('zh-CN', {
      show: () => calls.push('show'),
      quit: () => calls.push('quit'),
    });
    for (const item of template) {
      item.click?.({} as never, undefined, {} as never);
    }
    expect(calls).toEqual(['show', 'quit']);
  });
});

describe('settings.trayClose 落盘（platform 契约，T54-01 §1②）', () => {
  it('trayClose 默认 ask；写入后读回；非法值被 zod 拒绝', () => {
    const userData = tempDir('septcats-t54-settings-');
    expect(readSettings(userData).trayClose).toBe('ask');
    writeSettings(userData, { trayClose: 'tray' });
    expect(readSettings(userData).trayClose).toBe('tray');
    writeSettings(userData, { trayClose: 'quit' });
    expect(readSettings(userData).trayClose).toBe('quit');
    // 非法值：mergeSettingsPatch 的严格 schema 拒绝（E_SETTINGS_INVALID）
    expect(() => writeSettings(userData, { trayClose: 'minimize' as never })).toThrow(
      /E_SETTINGS_INVALID/,
    );
    expect(readSettings(userData).trayClose).toBe('quit'); // 拒绝后原值不动
  });
});
