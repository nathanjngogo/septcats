/**
 * closeGuard.ts —— 关窗拦截器（TASK-T54-01 §1①②）。
 *
 * 纯 Node（不 import electron / ipcMain）：把「拦 close → 冲刷未提交编辑 → 按
 * settings.trayClose 路由（ask/tray/quit）」的状态机与全部可注入副作用放在这里，
 * 供 main/index.ts 接线，也供 test/close-guard.test.ts 在 Node 环境直测
 * （flush ack / 超时兜底 / quittingFlag 语义 / trayClose 三态路由）。
 *
 * 状态机（`state`）：
 *   idle      空闲；下一个 close 请求会启动一条流程
 *   flushing  已发 editor:flush，等 renderer ack（或 2s 超时兜底）
 *   asking    已推 close:ask，等用户选择
 *   exiting   已完成冲刷、确认真退；此后 close 请求**放行**（不重复拦）
 *
 * 红线（不丢数据）：
 * - 用户关窗（quitting=false）：**先冲刷再弹框**——询问框出现时未提交编辑已在库；
 * - 真退出（quitting=true，托盘菜单退出 / OS 关停 / app.quit）：同样先冲刷再放行，
 *   **不再弹框**（不重复询问）；
 * - ack 超时（renderer 卡死/未注册）：2s 后记 WARNING 并继续（用户明确要关窗时
 *   不能无限挂住窗口；已尽力冲刷）。
 */

import type { CloseAction, CloseDecisionInput } from '../shared/ipc';
import { CLOSE_ACTIONS } from '../shared/ipc';
import type { TrayCloseMode } from '../shared/settings';

/** 冲刷 ack 兜底窗口（ms）：超时记 WARNING 后继续，不无限挂住关窗。 */
export const FLUSH_TIMEOUT_MS = 2000;

/** 未知/非法的 trayClose → 'ask'（询问是安全默认：绝不静默退出或静默最小化）。 */
export function parseTrayClose(value: unknown): TrayCloseMode {
  return value === 'tray' || value === 'quit' || value === 'ask' ? value : 'ask';
}

/** 真退出（quittingFlag=true）不拦；用户关窗才拦。 */
export function shouldInterceptClose(quitting: boolean): boolean {
  return !quitting;
}

/** trayClose 三态路由（当前就是恒等映射；单独成函数以便单测钉「无隐式分支」）。 */
export function routeTrayClose(mode: TrayCloseMode): TrayCloseMode {
  return mode;
}

/**
 * 询问框选择 → 要持久化的 trayClose；不勾选「记住我的选择」→ null（不写设置）。
 * cancel 勾选时记回 'ask'（= 恢复「每次询问」，与默认态一致，不留悬空值）。
 */
export function persistModeFor(action: CloseAction, remember: boolean): TrayCloseMode | null {
  if (!remember) {
    return null;
  }
  if (action === 'tray') {
    return 'tray';
  }
  if (action === 'quit') {
    return 'quit';
  }
  return 'ask';
}

/** 询问框决议载荷校验：非法 action 抛错（IPC 入参不信任），remember 缺省 false。 */
export function parseCloseDecision(raw: unknown): CloseDecisionInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('E_MALFORMED: close:decide 参数必须是对象');
  }
  const record = raw as Record<string, unknown>;
  const action = record['action'];
  if (typeof action !== 'string' || !(CLOSE_ACTIONS as readonly string[]).includes(action)) {
    throw new Error('E_MALFORMED: close:decide.action 必须是 tray|quit|cancel');
  }
  return { action: action as CloseAction, remember: record['remember'] === true };
}

export interface CloseGuardLog {
  info(message: string): void;
  warn(message: string): void;
}

/** 关窗状态机可注入面（真实实现见 main/index.ts；测试用假实现驱动各分支）。 */
export interface CloseGuardDeps {
  /** 真退出意图（quittingFlag）。 */
  isQuitting(): boolean;
  setQuitting(value: boolean): void;
  /** settings.trayClose（原始值；经 parseTrayClose 收口）。 */
  readTrayClose(): unknown;
  /** 向 renderer 推 editor:flush。 */
  sendFlush(requestId: string): void;
  /** 主进程 → renderer：弹自绘询问框（close:ask）。 */
  sendAsk(): void;
  /** 隐藏主窗口到托盘。 */
  hideToTray(): void;
  /** app.quit()。 */
  quitApp(): void;
  /** 写 settings.trayClose（调用方已保证值合法）。 */
  persistTrayClose(mode: TrayCloseMode): void;
  newRequestId(): string;
  log: CloseGuardLog;
  timeoutMs?: number;
}

export type CloseGuardState = 'idle' | 'flushing' | 'asking' | 'exiting';

/** 单次关窗流程的可观测结果（单测/日志用）。 */
export interface CloseGuardTrace {
  requestId: string;
  /** 冲刷是否在超时前收到 ack。 */
  acked: boolean;
  waitedMs: number;
  mode: TrayCloseMode;
  decision: CloseAction | null;
  persisted: TrayCloseMode | null;
}

export class CloseGuard {
  private readonly deps: CloseGuardDeps;
  private readonly timeoutMs: number;
  private state: CloseGuardState = 'idle';
  private pendingRequestId: string | null = null;
  private ackWaiter: ((acked: boolean) => void) | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private askWaiter: ((decision: CloseDecisionInput) => void) | null = null;
  private lastTrace: CloseGuardTrace | null = null;

  constructor(deps: CloseGuardDeps) {
    this.deps = deps;
    this.timeoutMs = deps.timeoutMs ?? FLUSH_TIMEOUT_MS;
  }

  get currentState(): CloseGuardState {
    return this.state;
  }

  get trace(): CloseGuardTrace | null {
    return this.lastTrace;
  }

  /**
   * `close` 事件同步入口：返回 true = **拦截**（调用方必须 preventDefault）。
   * 已在流程中（flushing/asking）→ 拦；已确认退出（exiting）→ 放行；
   * 空闲 + 真退出 → 拦一次走「冲刷后放行」；空闲 + 用户关窗 → 拦一次走完整流程。
   */
  requestClose(): boolean {
    if (this.state === 'exiting') {
      return false;
    }
    if (this.state !== 'idle') {
      return true;
    }
    const quitting = this.deps.isQuitting();
    this.deps.log.info(
      `close 请求：quitting=${String(quitting)} → ${quitting ? '冲刷后退出' : '冲刷后按 trayClose 路由'}`,
    );
    if (quitting) {
      this.state = 'flushing';
      void this.runQuitFlow();
    } else {
      this.state = 'flushing';
      void this.runAskFlow();
    }
    return true;
  }

  /** renderer 的 editor:flushAck（IPC handler 调用）。返回是否与在途请求匹配。 */
  ackFlush(requestId: string): boolean {
    const pending = this.pendingRequestId;
    if (pending === null || requestId !== pending) {
      this.deps.log.warn(
        `editor:flushAck 与在途请求不匹配（收到 ${requestId || '(空)'}，在途 ${pending ?? '(无)'}）`,
      );
      return false;
    }
    const waiter = this.ackWaiter;
    this.clearAckTimer();
    this.ackWaiter = null;
    this.pendingRequestId = null;
    waiter?.(true);
    return true;
  }

  /** 询问框决议（IPC handler 调用）。无在途询问时只记日志（幂等）。 */
  resolveAsk(decision: CloseDecisionInput): void {
    const waiter = this.askWaiter;
    if (waiter === null) {
      this.deps.log.warn(`close:decide 无在途询问（action=${decision.action}），已忽略`);
      return;
    }
    this.askWaiter = null;
    waiter(decision);
  }

  /** 窗口销毁/渲染进程消失时收尾：把在途询问当作「取消」，不留悬挂 Promise。 */
  abortAsk(reason: string): void {
    const waiter = this.askWaiter;
    this.askWaiter = null;
    if (waiter !== null) {
      this.deps.log.warn(`询问框在途但窗口已销毁（${reason}）→ 按取消收尾`);
      waiter({ action: 'cancel', remember: false });
    }
  }

  /**
   * 窗口销毁时的整体收尾：在途询问按取消、在途冲刷按「未 ack」结算，
   * 状态回 idle（此后新的 close 请求重新走完整流程）。
   */
  onWindowDestroyed(reason: string): void {
    const flushWaiter = this.ackWaiter;
    this.clearAckTimer();
    this.ackWaiter = null;
    this.pendingRequestId = null;
    flushWaiter?.(false);
    this.abortAsk(reason);
    if (this.state !== 'exiting') {
      this.state = 'idle';
    }
  }

  /**
   * 冲刷握手：发 editor:flush → 等 ack（超时 2s 记 WARNING 继续）。
   * 返回是否在超时前 ack（原始值进 trace，供报告/探针引用）。
   */
  async flushEditor(): Promise<{ acked: boolean; waitedMs: number; requestId: string }> {
    const requestId = this.deps.newRequestId();
    this.pendingRequestId = requestId;
    const startedAt = Date.now();
    const acked = await new Promise<boolean>((resolve) => {
      this.ackWaiter = (value) => {
        this.clearAckTimer();
        resolve(value);
      };
      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        const waiter = this.ackWaiter;
        this.ackWaiter = null;
        waiter?.(false);
      }, this.timeoutMs);
      try {
        this.deps.sendFlush(requestId);
      } catch (error) {
        this.deps.log.warn(`editor:flush 推送失败：${String(error)}`);
        this.ackWaiter = null;
        this.clearAckTimer();
        resolve(false);
      }
    });
    if (this.pendingRequestId === requestId) {
      this.pendingRequestId = null;
    }
    const waitedMs = Date.now() - startedAt;
    if (!acked) {
      this.deps.log.warn(
        `editor:flush 未在 ${String(this.timeoutMs)}ms 内收到 ack（requestId=${requestId}，waited=${String(waitedMs)}ms）→ 继续关窗流程`,
      );
    } else {
      this.deps.log.info(`editor:flush ack 到齐（requestId=${requestId}，waited=${String(waitedMs)}ms）`);
    }
    return { acked, waitedMs, requestId };
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  /** 真退出路径：冲刷 → 放行（不弹框）。 */
  private async runQuitFlow(): Promise<void> {
    const flush = await this.flushEditor();
    this.state = 'exiting';
    this.lastTrace = {
      requestId: flush.requestId,
      acked: flush.acked,
      waitedMs: flush.waitedMs,
      mode: 'quit',
      decision: 'quit',
      persisted: null,
    };
    this.deps.log.info('真退出：冲刷完成 → app.quit（不弹询问框）');
    this.deps.quitApp();
  }

  /** 用户关窗路径：冲刷 → trayClose 三态路由 / 弹框。 */
  private async runAskFlow(): Promise<void> {
    const flush = await this.flushEditor();
    const mode = routeTrayClose(parseTrayClose(this.deps.readTrayClose()));
    if (mode === 'tray') {
      this.state = 'idle';
      this.lastTrace = {
        requestId: flush.requestId,
        acked: flush.acked,
        waitedMs: flush.waitedMs,
        mode,
        decision: 'tray',
        persisted: null,
      };
      this.deps.log.info('trayClose=tray：冲刷完成 → 最小化到托盘');
      this.deps.hideToTray();
      return;
    }
    if (mode === 'quit') {
      this.state = 'exiting';
      this.lastTrace = {
        requestId: flush.requestId,
        acked: flush.acked,
        waitedMs: flush.waitedMs,
        mode,
        decision: 'quit',
        persisted: null,
      };
      this.deps.log.info('trayClose=quit：冲刷完成 → 退出（不弹询问框）');
      this.deps.setQuitting(true);
      this.deps.quitApp();
      return;
    }
    this.state = 'asking';
    const decision = await new Promise<CloseDecisionInput>((resolve) => {
      // 先挂 waiter 再推 close:ask：sendAsk 失败（窗口已销毁等）时就地按取消收尾，
      // 不留悬挂 Promise。
      this.askWaiter = resolve;
      try {
        this.deps.sendAsk();
      } catch (error) {
        this.askWaiter = null;
        this.deps.log.warn(`close:ask 推送失败（按取消收尾）：${String(error)}`);
        resolve({ action: 'cancel', remember: false });
      }
    });
    this.state = 'idle';
    this.applyDecision(flush, decision);
  }

  /** 询问框选择落地：先持久化（勾选时）再执行动作。 */
  private applyDecision(
    flush: { acked: boolean; waitedMs: number; requestId: string },
    decision: CloseDecisionInput,
  ): void {
    const persisted = persistModeFor(decision.action, decision.remember);
    if (persisted !== null) {
      this.deps.persistTrayClose(persisted);
      this.deps.log.info(`记住选择：settings.trayClose=${persisted}`);
    }
    this.lastTrace = {
      requestId: flush.requestId,
      acked: flush.acked,
      waitedMs: flush.waitedMs,
      mode: 'ask',
      decision: decision.action,
      persisted,
    };
    if (decision.action === 'tray') {
      this.deps.log.info('询问框选择：最小化到托盘');
      this.deps.hideToTray();
      return;
    }
    if (decision.action === 'quit') {
      this.deps.log.info('询问框选择：退出');
      this.state = 'exiting';
      this.deps.setQuitting(true);
      this.deps.quitApp();
      return;
    }
    this.deps.log.info('询问框选择：取消');
  }
}

/** 组装默认实现（main/index.ts 用；测试可直接注入假 deps）。 */
export function createCloseGuard(deps: CloseGuardDeps): CloseGuard {
  return new CloseGuard(deps);
}
