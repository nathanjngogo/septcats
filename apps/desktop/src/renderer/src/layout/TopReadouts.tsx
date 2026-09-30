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

/** 同步态 → 短标签（i18n；缺值时按「未启用」）。 */
function syncLabel(status: SyncStatusSnapshot | null): string {
  if (status === null) {
    return t('readouts.syncUnknown');
  }
  const state = String((status as { state?: string }).state ?? '');
  if (state === 'syncing') {
    return t('readouts.syncBusy');
  }
  if (state === 'error') {
    return t('readouts.syncError');
  }
  if (state === 'disabled') {
    return t('readouts.syncOff');
  }
  return t('readouts.syncOk');
}

/** 同步态 → 灯色档（instrument 档用：ok=accent / busy=amber / error=danger / off=灰）。 */
function syncTone(status: SyncStatusSnapshot | null): string {
  const state = status === null ? '' : String((status as { state?: string }).state ?? '');
  if (state === 'syncing') {
    return 'busy';
  }
  if (state === 'error') {
    return 'error';
  }
  if (state === 'disabled') {
    return 'off';
  }
  return status === null ? 'off' : 'ok';
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
      <div className="sc-readouts__cell" data-tone={syncTone(sync)} data-testid="readout-sync">
        <span className="sc-readouts__lab">{t('readouts.sync')}</span>
        <span className="sc-readouts__val">
          <i className="sc-readouts__lamp" aria-hidden="true" />
          {syncLabel(sync)}
        </span>
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