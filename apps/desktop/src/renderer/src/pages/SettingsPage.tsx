/**
 * SettingsPage.tsx —— 设置页（TASK-T10-01 §3，视觉基准 = mockup 06）。
 *
 * 三区块（fieldset/legend + aria）：
 *  - 外观：主题三选（RadioGroup）→ 立即 setGlobalThemeMode + patch；
 *  - 数据与隐私：同步路径只读 + 隐私开关两项（遥测恒 off 占位、外链预览开关）；
 *  - 诊断：导出诊断包（预览 → 确认落盘）+ 关于块（版本/猫标/技术栈）。
 * 无异步加载需求 → 控件变更即时 patch（busy 态禁交互）；zod 拒绝 → ErrorPanel 内联。
 * T12-01B：关于块加「检查更新」行（四态文案 + 重启更新 confirm 弹窗，M10-B §0.6）。
 * T17-01 D5：「同步密钥」区块三件套（导出恢复码 / 导入恢复码 / 轮换密钥，
 * 各带确认弹窗；恢复码一次性明文，只在弹窗内存中存在，关窗即清）。
 * T18-02：「同步密钥」之后插入「AI 助手」区块（fieldset 壳；内容/弹窗/i18n/busy
 * 由 AiSection 自管，见 settings/AiSection.tsx）。区块列表：
 *  - 外观 / 数据与隐私 / 同步密钥 / AI 助手（T18-02）/ 诊断 / 关于。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Dialog, ErrorPanel, RadioGroup, Switch, setGlobalThemeMode } from '@septcats/ui';
import type { AppSettings, AppSettingsPatch, ThemeMode } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/updater';
import type { SeptcatsAppMeta } from '../../../types/window';
import { t } from '../i18n';
import { AiSection } from '../settings/AiSection';
import { TemplatesSection } from '../templates/TemplatesSection';
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

  // T17-01 D5：同步密钥三件套（一次性明文不落任何持久态；关窗即清）
  const [recExportOpen, setRecExportOpen] = useState(false);
  const [recCode, setRecCode] = useState<string | null>(null);
  const [recExportBusy, setRecExportBusy] = useState(false);
  const [recExportError, setRecExportError] = useState<string | null>(null);
  const [recSaved, setRecSaved] = useState(false);
  const [recImportOpen, setRecImportOpen] = useState(false);
  const [recImportText, setRecImportText] = useState('');
  const [recImportBusy, setRecImportBusy] = useState(false);
  const [recImportError, setRecImportError] = useState<string | null>(null);
  const [recImportOk, setRecImportOk] = useState<string | null>(null);
  const [recRotateOpen, setRecRotateOpen] = useState(false);
  const [recRotateBusy, setRecRotateBusy] = useState(false);
  const [recRotateError, setRecRotateError] = useState<string | null>(null);
  const [recRotateMsg, setRecRotateMsg] = useState<string | null>(null);

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

  const closeRecExport = (): void => {
    setRecExportOpen(false);
    setRecCode(null);
    setRecSaved(false);
    setRecExportError(null);
  };

  const openRecExport = (): void => {
    setRecExportOpen(true);
    setRecCode(null);
    setRecSaved(false);
    setRecExportError(null);
    setRecExportBusy(true);
    void (async () => {
      try {
        const result = await window.septcats.sync.exportRecovery();
        setRecCode(result.code);
      } catch (cause) {
        setRecExportError(describeError(cause));
      } finally {
        setRecExportBusy(false);
      }
    })();
  };

  const closeRecImport = (): void => {
    setRecImportOpen(false);
    setRecImportText('');
    setRecImportBusy(false);
    setRecImportError(null);
    setRecImportOk(null);
  };

  const submitRecImport = async (): Promise<void> => {
    setRecImportBusy(true);
    setRecImportError(null);
    setRecImportOk(null);
    try {
      const result = await window.septcats.sync.importRecovery({ code: recImportText });
      setRecImportOk(result.keyId);
    } catch (cause) {
      setRecImportError(describeError(cause));
    } finally {
      setRecImportBusy(false);
    }
  };

  const closeRecRotate = (): void => {
    setRecRotateOpen(false);
    setRecRotateError(null);
  };

  const confirmRecRotate = async (): Promise<void> => {
    setRecRotateBusy(true);
    setRecRotateError(null);
    try {
      await window.septcats.sync.rotateKey();
      setRecRotateMsg(t('settings.recovery.rotateStarted'));
      setRecRotateOpen(false);
    } catch (cause) {
      setRecRotateError(describeError(cause));
    } finally {
      setRecRotateBusy(false);
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
            <legend className="settings-legend">{t('settings.recovery.title')}</legend>
            <SettingsRow
              title={t('settings.recovery.export')}
              desc={t('settings.recovery.exportDesc')}
              control={
                <Button variant="secondary" size="sm" disabled={saving} onClick={openRecExport}>
                  {t('settings.recovery.export')}
                </Button>
              }
            />
            <SettingsRow
              title={t('settings.recovery.import')}
              desc={t('settings.recovery.importDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setRecImportOpen(true);
                  }}
                >
                  {t('settings.recovery.import')}
                </Button>
              }
            />
            <SettingsRow
              title={t('settings.recovery.rotate')}
              desc={t('settings.recovery.rotateDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setRecRotateOpen(true);
                  }}
                >
                  {t('settings.recovery.rotate')}
                </Button>
              }
            />
            {recRotateMsg === null ? null : (
              <div className="settings-saved" data-testid="settings-rotate-note">
                {recRotateMsg}
              </div>
            )}
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.ai.title')}</legend>
            <AiSection />
          </fieldset>

          {/* T23-02 §D：模板管理（区块壳在 SettingsPage；列表/弹窗自管，照 AiSection 范式） */}
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.templates.title')}</legend>
            <TemplatesSection />
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

      <Dialog
        open={recExportOpen}
        onClose={closeRecExport}
        title={t('settings.recovery.exportDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecExport}>
              {t('settings.recovery.cancel')}
            </Button>
            <Button size="sm" disabled={!recSaved || recCode === null} onClick={closeRecExport}>
              {t('settings.recovery.exportDialogDone')}
            </Button>
          </div>
        }
      >
        {recExportBusy ? <p className="settings-recovery-muted">{t('settings.recovery.busy')}</p> : null}
        {recExportError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recExportError}
          </p>
        )}
        {recCode === null ? null : (
          <>
            <code className="settings-recovery-code" data-testid="recovery-code">
              {recCode}
            </code>
            <p className="settings-recovery-warn">{t('settings.recovery.exportDialogBody')}</p>
            <div className="settings-recovery-saved-row">
              <Checkbox
                checked={recSaved}
                onChange={(event) => {
                  setRecSaved(event.target.checked);
                }}
                label={t('settings.recovery.exportDialogSaved')}
              />
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={recImportOpen}
        onClose={closeRecImport}
        title={t('settings.recovery.importDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecImport}>
              {t('settings.recovery.cancel')}
            </Button>
            {recImportOk === null ? (
              <Button
                size="sm"
                loading={recImportBusy}
                disabled={recImportText.trim().length === 0}
                onClick={() => {
                  void submitRecImport();
                }}
              >
                {t('settings.recovery.importDialogSubmit')}
              </Button>
            ) : (
              <Button size="sm" onClick={closeRecImport}>
                {t('settings.recovery.exportDialogDone')}
              </Button>
            )}
          </div>
        }
      >
        <p className="settings-recovery-warn">{t('settings.recovery.importDialogBody')}</p>
        <textarea
          className="settings-recovery-input"
          rows={3}
          value={recImportText}
          placeholder={t('settings.recovery.importDialogPlaceholder')}
          aria-label={t('settings.recovery.importDialogTitle')}
          disabled={recImportOk !== null}
          onChange={(event) => {
            setRecImportText(event.target.value);
          }}
        />
        {recImportError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recImportError}
          </p>
        )}
        {recImportOk === null ? null : (
          <p className="settings-recovery-ok" data-testid="recovery-import-ok">
            {fillTemplate(t('settings.recovery.importDialogSuccess'), { keyId: recImportOk })}
          </p>
        )}
      </Dialog>

      <Dialog
        open={recRotateOpen}
        onClose={closeRecRotate}
        title={t('settings.recovery.rotateDialogTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button variant="secondary" size="sm" onClick={closeRecRotate}>
              {t('settings.recovery.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={recRotateBusy}
              onClick={() => {
                void confirmRecRotate();
              }}
            >
              {t('settings.recovery.rotateDialogConfirm')}
            </Button>
          </div>
        }
      >
        <p className="settings-recovery-warn">{t('settings.recovery.rotateDialogBody')}</p>
        {recRotateError === null ? null : (
          <p className="settings-recovery-error" role="alert">
            {recRotateError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
