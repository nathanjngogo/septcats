/**
 * SyncStatus.tsx —— 顶栏同步状态钮 + 同步面板（TASK-T13-01 §3，视觉基准 = mockup 07）。
 *
 * 五态（07 屏顶栏状态钮逐态对应）：
 *   idle     灰点「同步未开启」（setEnabled(false)）
 *   syncing  琥珀呼吸点「同步中」（转圈由呼吸动画承担）
 *   ok       绿点「已同步 · <相对时间>」
 *   degraded 橙点「同步文件夹不可访问」（S7：本地写入不受影响的红条入口）
 *   error    红点「同步错误」（含 E_SYNC_KEY_MISMATCH 换钥匙/丢钥场景）
 * 点击弹面板：设备列表（actorId+水位）、待发段数、最近错误、手动「立即同步」、
 * 加密开关与同步开关（进 settings）。文案全 i18n；样式全 var(--sc-*)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch } from '@septcats/ui';
import type { SyncStatusSnapshot, SyncRuntimeState } from '../../../shared/sync';
import type { AppSettings } from '../../../shared/settings';
import { t } from '../i18n';
import './SyncStatus.css';

/** 五态 → 视觉键（ok 含相对时间文案）。 */
interface PillView {
  key: 'idle' | 'syncing' | 'ok' | 'degraded' | 'error';
  label: string;
}

/** 相对时间（分钟内/小时内/今天之外回退本地时间）。 */
export function relativeTime(atMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - atMs);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return t('sync.justNow');
  }
  if (minutes < 60) {
    return t('sync.minutesAgo').replace('{n}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('sync.hoursAgo').replace('{n}', String(hours));
  }
  return new Date(atMs).toLocaleTimeString(t('sync.locale'), { hour: '2-digit', minute: '2-digit' });
}

function pillView(status: SyncStatusSnapshot | null, nowMs: number): PillView {
  if (status === null) {
    return { key: 'syncing', label: t('sync.stateLoading') };
  }
  if (!status.enabled) {
    return { key: 'idle', label: t('sync.stateIdle') };
  }
  switch (status.state as SyncRuntimeState) {
    case 'syncing':
      return { key: 'syncing', label: t('sync.stateSyncing') };
    case 'degraded':
      return { key: 'degraded', label: t('sync.stateDegraded') };
    case 'error':
      return { key: 'error', label: t('sync.stateError') };
    case 'ok': {
      const rel =
        status.lastSyncAt === null ? t('sync.never') : relativeTime(status.lastSyncAt, nowMs);
      return { key: 'ok', label: `${t('sync.stateOk')} · ${rel}` };
    }
    default:
      return { key: 'idle', label: t('sync.stateIdle') };
  }
}

export function SyncStatusButton() {
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 初始拉取 + 订阅状态跃迁推送 + 每 30s 刷新相对时间
  useEffect(() => {
    let mounted = true;
    const api = window.septcats.sync;
    void api.status().then((s) => {
      if (mounted) {
        setStatus(s);
      }
    });
    const off = api.onState((s) => {
      if (mounted) {
        setStatus(s);
      }
    });
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    const openOnEvent = (): void => {
      setOpen(true);
    };
    window.addEventListener('septcats:sync-open', openOnEvent);
    return () => {
      mounted = false;
      off();
      clearInterval(tick);
      window.removeEventListener('septcats:sync-open', openOnEvent);
    };
  }, []);

  // 打开面板时取加密开关现状（settings.sync.encrypt）
  useEffect(() => {
    if (!open) {
      return;
    }
    let mounted = true;
    void window.septcats.settings.get().then((s: AppSettings) => {
      if (mounted) {
        setEncrypt(s.sync.encrypt);
      }
    });
    return () => {
      mounted = false;
    };
  }, [open]);

  // 点击面板外关闭 + Esc 关闭
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await window.septcats.sync.now());
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleEnabled = useCallback(async (on: boolean): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await window.septcats.sync.setEnabled({ on }));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleEncrypt = useCallback(async (on: boolean): Promise<void> => {
    setEncrypt(on);
    setBusy(true);
    try {
      await window.septcats.settings.patch({ sync: { encrypt: on } });
    } finally {
      setBusy(false);
    }
  }, []);

  const view = pillView(status, nowMs);
  const ariaLabel = t('sync.openPanel');

  return (
    <div className="sc-sync-status" ref={rootRef}>
      <button
        type="button"
        className={`sc-sync-status__pill sc-sync-status__pill--${view.key}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={`${ariaLabel}（${view.label}）`}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span className="sc-sync-status__dot" aria-hidden="true" />
        <span className="sc-sync-status__label">{view.label}</span>
      </button>

      {open ? (
        <div className="sc-sync-status__panel" role="dialog" aria-label={t('sync.panelTitle')}>
          <div className="sc-sync-status__row">
            <span className="sc-sync-status__k">{t('sync.stateLabel')}</span>
            <span className="sc-sync-status__v">{view.label}</span>
          </div>
          <div className="sc-sync-status__row">
            <span className="sc-sync-status__k">{t('sync.lastSync')}</span>
            <span className="sc-sync-status__v">
              {status?.lastSyncAt === undefined || status?.lastSyncAt === null
                ? t('sync.never')
                : relativeTime(status.lastSyncAt, nowMs)}
            </span>
          </div>
          <div className="sc-sync-status__row">
            <span className="sc-sync-status__k">{t('sync.pending')}</span>
            <span className="sc-sync-status__v sc-sync-status__mono">
              {String((status?.pendingOps ?? 0) + (status?.pendingSegs ?? 0))}
            </span>
          </div>

          <div className="sc-sync-status__section">{t('sync.devices')}</div>
          {status === null || status.devices.length === 0 ? (
            <div className="sc-sync-status__empty">{t('sync.noDevices')}</div>
          ) : (
            status.devices.map((device) => (
              <div className="sc-sync-status__row" key={device.actorId}>
                <span className="sc-sync-status__k sc-sync-status__mono">{device.actorId}</span>
                <span className="sc-sync-status__v sc-sync-status__mono">
                  {t('sync.watermark').replace('{n}', String(device.lastLamport))}
                </span>
              </div>
            ))
          )}

          <div className="sc-sync-status__section">{t('sync.recentErrors')}</div>
          {status === null || status.errors.length === 0 ? (
            <div className="sc-sync-status__empty">{t('sync.noErrors')}</div>
          ) : (
            [...status.errors]
              .reverse()
              .slice(0, 3)
              .map((error) => (
                <div className="sc-sync-status__error" key={`${String(error.at)}-${error.code}`}>
                  <span className="sc-sync-status__mono">{error.code}</span>
                  <span>{error.message}</span>
                </div>
              ))
          )}

          <div className="sc-sync-status__actions">
            <button
              type="button"
              className="sc-sync-status__button"
              disabled={busy || (status?.enabled ?? false) === false}
              onClick={() => {
                void syncNow();
              }}
            >
              {t('sync.syncNow')}
            </button>
            <label className="sc-sync-status__switch">
              <Switch
                checked={status?.enabled ?? false}
                label={t('sync.enabled')}
                disabled={busy}
                onCheckedChange={(on) => {
                  void toggleEnabled(on);
                }}
              />
              <span>{t('sync.enabled')}</span>
            </label>
            <label className="sc-sync-status__switch">
              <Switch
                checked={encrypt}
                label={t('sync.encrypt')}
                disabled={busy}
                onCheckedChange={(on) => {
                  void toggleEncrypt(on);
                }}
              />
              <span>{t('sync.encrypt')}</span>
            </label>
          </div>
          <p className="sc-sync-status__hint">{t('sync.hint')}</p>
        </div>
      ) : null}
    </div>
  );
}
