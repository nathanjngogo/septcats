/**
 * flushRegistry.ts —— 「关窗前冲刷一切未提交编辑」的注册表（TASK-T54-01 §1①）。
 *
 * 数据安全链路：main 拦主窗 close → `editor:flush` → 本模块按注册顺序跑完**全部**
 * 冲刷任务（PageView 的 EditSession 防抖缓冲、侧栏行内重命名待结算态、协作层
 * Y.Doc 防抖尾）→ 回 `editor:flushAck`。ack 之后 main 才弹询问框 / 放行退出，
 * 因此询问框出现时「键入正文 → 立刻关窗」的正文一定已在库。
 *
 * 纪律：
 * - 任务**不吞错**：单个任务抛错只记 console.error 并计入 failures，其余任务照跑
 *   （一个坏任务不该阻断其它数据的落库），最后仍回 ack（main 侧按原始值记录）；
 * - 注册/注销成对（组件 useEffect 返回注销函数），未挂载的组件不贡献任务。
 */
import type { EditorFlushAckInput } from '../../../shared/ipc';

export type FlushTask = () => void | Promise<void>;

const tasks = new Set<FlushTask>();

/** 注册一个冲刷任务，返回注销函数（组件卸载时调用）。 */
export function registerFlushTask(task: FlushTask): () => void {
  tasks.add(task);
  return () => {
    tasks.delete(task);
  };
}

export interface FlushReport {
  /** 跑过的任务数（快照长度，供 main 日志/探针引用原始值）。 */
  tasks: number;
  /** 抛错的任务数。 */
  failures: number;
}

/** 顺序跑完快照内的全部任务（注册表在跑动期间变动不打乱本次快照）。 */
export async function flushAll(): Promise<FlushReport> {
  const snapshot = [...tasks];
  let failures = 0;
  for (const task of snapshot) {
    try {
      await task();
    } catch (error) {
      failures += 1;
      console.error('[flush] 冲刷任务失败（不吞，继续跑其余任务）', error);
    }
  }
  return { tasks: snapshot.length, failures };
}

/** 当前注册任务数（探针/诊断用）。 */
export function flushTaskCount(): number {
  return tasks.size;
}

/**
 * 装 main → renderer 的冲刷桥（renderer 入口调一次）：收到 editor:flush 就冲刷并回 ack。
 * 无论成败都回 ack —— 不 ack 会让 main 走 2s 超时兜底（用户可感知的关窗延迟）。
 */
export function installFlushBridge(): () => void {
  return window.septcats.close.onFlushRequest(({ requestId }) => {
    void flushAll()
      .then((report) => {
        const ack: EditorFlushAckInput = {
          requestId,
          tasks: report.tasks,
          failures: report.failures,
        };
        return window.septcats.close.flushAck(ack);
      })
      .catch((error: unknown) => {
        console.error('[flush] ack 回执失败（main 侧由 2s 超时兜底）', error);
      });
  });
}
