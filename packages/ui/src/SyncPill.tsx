import clsx from 'clsx';
import './SyncPill.css';

export type SyncState = 'idle' | 'busy' | 'alert';

export interface SyncPillProps {
  state: SyncState;
  /** alert 态的待处理计数角标 */
  pendingCount?: number;
  /** 形如 09:41；tooltip 文案必须含「上次同步」 */
  lastSyncedAt?: string;
  className?: string;
}

const STATE_LABEL: Record<SyncState, string> = {
  idle: '已同步',
  busy: '同步中',
  alert: '待处理',
};

/**
 * SyncPill —— 三态：静止灰点 / 琥珀呼吸点（进行中）/ danger 点 + 计数角标。
 * 兑现「异步可靠同步」叙事：tooltip 必须给出「上次同步 HH:mm」，而不是假装实时。
 */
export function SyncPill({ state, pendingCount = 0, lastSyncedAt, className }: SyncPillProps) {
  const title = lastSyncedAt === undefined ? '上次同步 未知' : `上次同步 ${lastSyncedAt}`;
  return (
    <span role="status" title={title} className={clsx('sc-sync', `sc-sync--${state}`, className)}>
      <span className="sc-sync__dot" aria-hidden="true" />
      <span className="sc-sync__label">{STATE_LABEL[state]}</span>
      {state === 'alert' && pendingCount > 0 ? (
        <span className="sc-sync__badge" aria-label={`${String(pendingCount)} 项待处理`}>
          {pendingCount}
        </span>
      ) : null}
    </span>
  );
}
