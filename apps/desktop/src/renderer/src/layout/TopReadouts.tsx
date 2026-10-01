/**
 * TopReadouts.tsx —— 顶栏「读数」区（方向 B「夜航仪表」结构层，老板 2026-10-01）。
 *
 * 立场（B 的头一条）：顶栏是**状态条**，不是装饰——每个格子只放**可核对的事实**，
 * 不放「感觉良好」类指标。三格：
 *   ① 同步 —— window.septcats.sync.status() + onState 推送（状态 + 最近同步时刻）
 *   ② 待办 —— window.septcats.todo.list 的未完成数（订阅 TODO_CHANGED_EVENT 即时刷新）
 *   ③ 页面 —— pages store 的活页数（nodes 过滤 deletedAt===0）
 *
 * 纪律：数据全走既有桥/store，**零新增 IPC**；样式走 var(--sc-*)，数字走等宽
 * （font-variant-numeric: tabular-nums，look 层已全局声明）；任一数据源不可用
 * （无 window.septcats / reject）都只显示占位，不崩、不阻断顶栏。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { usePages } from '../state/pages';
import { TODO_CHANGED_EVENT } from '../todo/TodoSidePanel';
import type { PageNodeView } from '../../../types/window';
import type { SyncStatusSnapshot } from '../../../shared/sync';
import './TopReadouts.css';

/**
 * 第①格取值 = **最近同步时刻**（不是同步状态）。
 *
 * ⚠ 这里曾经写的是「同步态 → 短标签 + 灯色」，两个真问题（T101-01 截图复核抓到）：
 *   1) `SyncRuntimeState` 里**根本没有 `disabled`**（只有 idle/syncing/ok/degraded/error/key_mismatch），
 *      同步关闭时运行时报 `idle` ⇒ 落到 fallback「已同步」+ 绿灯，与顶上那粒药丸「同步未开启」
 *      **互相矛盾**（谎报）；
 *   2) 顶栏同一行已有状态药丸（`SyncStatusButton`），再放一粒状态灯就是**同一信号两处**——
 *      既冗余又会各自漂移。
 * 定策：**状态只由药丸表达**（它的权威判据是 `enabled === false → 「同步未开启」`），
 * 读数区只补一条**事实型**信息（什么时候同步过），与药丸互补、不可能互相矛盾。
 */
function lastSyncValue(status: SyncStatusSnapshot | null): string {
  if (status === null) {
    return t('readouts.unknown');
  }
  const at = Number((status as { lastSyncAt?: unknown }).lastSyncAt ?? 0);
  if (!Number.isFinite(at) || at <= 0) {
    return t('readouts.never');
  }
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TopReadouts(): ReactNode {
  const [sync, setSync] = useState<SyncStatusSnapshot | null>(null);
  const [todoOpen, setTodoOpen] = useState<number | null>(null);
  const nodes = usePages((state) => state.nodes);

  // ① 同步：初拉 + 订阅状态跃迁（与 SyncStatusButton 同通道，互不干扰）
  useEffect(() => {
    let mounted = true;
    const api = window.septcats?.sync;
    if (api === undefined) {
      return undefined;
    }
    void api.status().then((snapshot) => {
      if (mounted) {
        setSync(snapshot);
      }
    }).catch(() => { /* 读失败：保持占位，不崩 */ });
    const off = api.onState((snapshot) => {
      if (mounted) {
        setSync(snapshot);
      }
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  // ② 待办未完成数：初拉 + TODO_CHANGED_EVENT 即时刷新
  useEffect(() => {
    let mounted = true;
    const api = window.septcats?.todo;
    if (api === undefined) {
      return undefined;
    }
    const load = (): void => {
      void api.list({}).then((result) => {
        if (mounted) {
          setTodoOpen(result.items.filter((item) => !item.done).length);
        }
      }).catch(() => { /* 保持上次值 */ });
    };
    load();
    const onChanged = (): void => { load(); };
    window.addEventListener(TODO_CHANGED_EVENT, onChanged);
    return () => {
      mounted = false;
      window.removeEventListener(TODO_CHANGED_EVENT, onChanged);
    };
  }, []);

  // ③ 页面数：活页（deletedAt===0；视图层口径，与侧栏树一致）
  const pageCount = nodes.filter((node: PageNodeView) => (node.deletedAt ?? 0) === 0).length;

  return (
    <div className="sc-readouts" role="group" aria-label={t('readouts.label')}>
      <div className="sc-readouts__cell" data-testid="readout-sync">
        <span className="sc-readouts__lab">{t('readouts.lastSync')}</span>
        <span className="sc-readouts__val">{lastSyncValue(sync)}</span>
      </div>
      <div className="sc-readouts__cell" data-testid="readout-todo">
        <span className="sc-readouts__lab">{t('readouts.todo')}</span>
        <span className="sc-readouts__val">{todoOpen === null ? '—' : String(todoOpen)}</span>
      </div>
      <div className="sc-readouts__cell" data-testid="readout-pages">
        <span className="sc-readouts__lab">{t('readouts.pages')}</span>
        <span className="sc-readouts__val">{String(pageCount)}</span>
      </div>
    </div>
  );
}