/**
 * SettingsPage.tsx —— 设置页（TASK-T10-01 §3，视觉基准 = mockup 06）。
 *
 * 三区块（fieldset/legend + aria）：
 *  - 外观：主题三选（RadioGroup）→ 立即 setGlobalThemeMode + patch；
 *  - 数据与隐私：同步路径只读 + 隐私开关两项（遥测恒 off 占位、外链预览开关）；
 *  - 诊断：导出诊断包（预览 → 确认落盘）+ 关于块（版本/猫标/技术栈）。
 * 无异步加载需求 → 控件变更即时 patch（busy 态禁交互）；zod 拒绝 → ErrorPanel 内联。
 * T12-01B：关于块加「检查更新」行（四态文案 + 重启更新 confirm 弹窗，M10-B §0.6）。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, ErrorPanel, RadioGroup, Switch, setGlobalThemeMode } from '@septcats/ui';
import type { AppSettings, AppSettingsPatch, ThemeMode } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/updater';
import type { SeptcatsAppMeta } from '../../../types/window';
import { t } from '../i18n';
import './SettingsPage.css';

/** i18n 模板替换：'{version}' / '{percent}' 槽位（t() 本身不做插值）。 */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/** 状态 → 文案（四态：检查中/已是最新/下载中 N%/重启更新，外加 idle 与 error）。 */
function describeUpdateState(state: UpdateState | null, currentVersion: string): string {
  if (state === null || state.status === 'idle') {
    return fillTemplate(t('settings.about.statusIdle'), { version: currentVersion });
  }
  switch (state.status) {
    case 'checking':
      return t('settings.about.statusChecking');
    case 'not-available':
      return fillTemplate(t('settings.about.statusNotAvailable'), { version: currentVersion });
    case 'available':
      return fillTemplate(t('settings.about.statusAvailable'), { version: state.version ?? '' });
    case 'downloading':
      return fillTemplate(t('settings.about.statusDownloading'), {
        version: state.version ?? '',
        percent: String(Math.round(state.progress ?? 0)),
      });
    case 'downloaded':
      return fillTemplate(t('settings.about.statusDownloaded'), { version: state.version ?? '' });
    case 'error':
      return `${t('settings.about.statusError')}（${state.errorCode ?? 'E_UPDATE_FAILED'}）`;
  }
}

function themeOptions(): Array<{ value: ThemeMode; label: string }> {
  return [
    { value: 'light', label: t('settings.appearance.themeLight') },
    { value: 'dark', label: t('settings.appearance.themeDark') },
    { value: 'system', label: t('settings.appearance.themeSystem') },
  ];
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('E_SETTINGS_INVALID')) {
    return t('settings.error.saveFailed');
  }
  return message;
}

interface SettingsRowProps {
  title: string;
  desc?: string | undefined;
  control: ReactNode;
}

function SettingsRow({ title, desc, control }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-lab">
        <span className="settings-lab-b">{title}</span>
        {desc === undefined ? null : <span className="settings-lab-d">{desc}</span>}
      </div>
      <div className="settings-ctl">{control}</div>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [meta, setMeta] = useState<SeptcatsAppMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [diagPreview, setDiagPreview] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagSavedPath, setDiagSavedPath] = useState<string | null>(null);

  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [next, appMeta] = await Promise.all([
          window.septcats.settings.get(),
          window.septcats.appMeta(),
        ]);
        if (!cancelled) {
          setSettings(next);
          setMeta(appMeta);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(describeError(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 更新状态推送（M10-B）：订阅主→渲染 update:state
  useEffect(() => {
    const unsubscribe = window.septcats.update.onState((state) => {
      setUpdateState(state);
      if (state.status !== 'downloaded') {
        setUpdateConfirmOpen(false);
      }
    });
    return unsubscribe;
  }, []);

  const patch = async (patchInput: AppSettingsPatch): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.septcats.settings.patch(patchInput);
      setSettings(next);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleTheme = (mode: ThemeMode): void => {
    setGlobalThemeMode(mode);
    void patch({ theme: mode });
  };

  const handleLinkPreview = (on: boolean): void => {
    void patch({ privacy: { linkPreviewOnType: on } });
  };

  const handleExport = async (): Promise<void> => {
    setDiagBusy(true);
    setError(null);
    setDiagSavedPath(null);
    try {
      const result = await window.septcats.diag.export();
      setDiagPreview(result.preview);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setDiagBusy(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    setDiagBusy(true);
    setError(null);
    try {
      const result = await window.septcats.diag.confirm();
      setDiagSavedPath(result.path);
      setDiagPreview(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setDiagBusy(false);
    }
  };

  const handleCheckUpdate = async (): Promise<void> => {
    setUpdateBusy(true);
    setError(null);
    try {
      setUpdateState(await window.septcats.update.check());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleInstall = async (): Promise<void> => {
    setUpdateBusy(true);
    setError(null);
    try {
      await window.septcats.update.install({ confirm: true });
    } catch (cause) {
      setError(describeError(cause));
      setUpdateConfirmOpen(false);
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <div className="settings-page" data-testid="settings-page">
      <h2 className="settings-title">{t('settings.title')}</h2>

      {error !== null ? (
        <ErrorPanel
          className="settings-error"
          title={t('settings.error.saveFailed')}
          description={error}
        />
      ) : null}

      {settings === null ? null : (
        <>
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.appearance.title')}</legend>
            <SettingsRow
              title={t('settings.appearance.theme')}
              desc={t('settings.appearance.themeDesc')}
              control={
                <RadioGroup<ThemeMode>
                  label={t('settings.appearance.theme')}
                  name="settings-theme"
                  options={themeOptions()}
                  value={settings.theme}
                  onChange={handleTheme}
                  disabled={saving}
                />
              }
            />
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.privacy.title')}</legend>
            <SettingsRow
              title={t('settings.privacy.syncPath')}
              desc={t('settings.privacy.syncPathDesc')}
              control={
                <span className="settings-path" title={settings.data.note}>
                  {settings.data.note}
                </span>
              }
            />
            <SettingsRow
              title={t('settings.privacy.telemetry')}
              desc={t('settings.privacy.telemetryDesc')}
              control={<Switch checked={false} disabled label={t('settings.privacy.telemetry')} />}
            />
            <SettingsRow
              title={t('settings.privacy.linkPreviewOnType')}
              desc={t('settings.privacy.linkPreviewOnTypeDesc')}
              control={
                <Switch
                  checked={settings.privacy.linkPreviewOnType}
                  onCheckedChange={handleLinkPreview}
                  disabled={saving}
                  label={t('settings.privacy.linkPreviewOnType')}
                />
              }
            />
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.diagnostic.title')}</legend>
            <SettingsRow
              title={t('settings.diagnostic.export')}
              desc={t('settings.diagnostic.exportDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={diagBusy}
                  onClick={() => {
                    void handleExport();
                  }}
                >
                  {t('settings.diagnostic.export')}
                </Button>
              }
            />

            {diagPreview !== null ? (
              <div className="settings-preview-wrap">
                <div className="settings-preview-title">{t('settings.diagnostic.previewTitle')}</div>
                <pre className="settings-preview" aria-label={t('settings.diagnostic.previewTitle')}>
                  {diagPreview}
                </pre>
                <div className="settings-preview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDiagPreview(null);
                    }}
                  >
                    {t('settings.diagnostic.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={diagBusy}
                    onClick={() => {
                      void handleConfirm();
                    }}
                  >
                    {t('settings.diagnostic.confirmSave')}
                  </Button>
                </div>
              </div>
            ) : null}

            {diagSavedPath !== null ? (
              <div className="settings-saved" data-testid="settings-diag-saved">
                {t('settings.diagnostic.savedTo')} {diagSavedPath}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.about.title')}</legend>
            <SettingsRow
              title={t('settings.about.logo')}
              desc={meta === null ? undefined : `${t('settings.about.version')} ${meta.version}`}
              control={<span className="settings-cat" aria-hidden="true">🐱</span>}
            />
            <SettingsRow
              title={t('settings.about.stack')}
              control={<span className="settings-lab-d">Electron · React · TypeScript · SQLite</span>}
            />
            <SettingsRow
              title={t('settings.about.checkUpdate')}
              desc={describeUpdateState(updateState, meta?.version ?? '')}
              control={
                updateState !== null && updateState.status === 'downloaded' ? (
                  <Button
                    size="sm"
                    loading={updateBusy}
                    onClick={() => {
                      setUpdateConfirmOpen(true);
                    }}
                  >
                    {t('settings.about.restartToUpdate')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={updateBusy || updateState?.status === 'checking' || updateState?.status === 'downloading'}
                    onClick={() => {
                      void handleCheckUpdate();
                    }}
                  >
                    {t('settings.about.checkUpdate')}
                  </Button>
                )
              }
            />
          </fieldset>
        </>
      )}

      <Dialog
        open={updateConfirmOpen}
        onClose={() => {
          setUpdateConfirmOpen(false);
        }}
        title={t('settings.about.confirmTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setUpdateConfirmOpen(false);
              }}
            >
              {t('settings.about.cancel')}
            </Button>
            <Button
              size="sm"
              loading={updateBusy}
              onClick={() => {
                void handleInstall();
              }}
            >
              {t('settings.about.confirmInstall')}
            </Button>
          </div>
        }
      >
        <p className="settings-update-confirm-body">
          {fillTemplate(t('settings.about.confirmBody'), {
            version: updateState?.version ?? '',
          })}
        </p>
        <p className="settings-update-rollback">{t('settings.about.rollback')}</p>
      </Dialog>
    </div>
  );
}
