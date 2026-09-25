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
 *  - 外观 / 布局（T39-01 布局设计器，LayoutSection 自管）/ 关闭行为（T54-01）/ 数据与隐私 /
 *    同步密钥 / AI 助手（T18-02）/ 诊断 / 关于。
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Dialog, ErrorPanel, RadioGroup, Switch, setGlobalThemeMode } from '@septcats/ui';
import type { AppSettings, AppSettingsPatch, ThemeMode, TrayCloseMode } from '../../../shared/settings';
import type {
  PortableExportPreview,
  PortableImportPlan,
  PortableImportResult,
} from '../../../shared/portable';
import type { DbGcPreview, DbGcRunResult } from '../../../shared/dbgc';
import type { UpdateState } from '../../../shared/updater';
import type { SeptcatsAppMeta } from '../../../types/window';
import { errorText, getLocalePref, setLocalePref, systemLocale, t } from '../i18n';
import { AiSection } from '../settings/AiSection';
import { LayoutSection } from '../layout/LayoutSection';
import { TemplatesSection } from '../templates/TemplatesSection';
import { ThemeSection } from '../theme/ThemeSection';
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
      return fillTemplate(t('settings.about.statusErrorFmt'), {
        code: state.errorCode ?? 'E_UPDATE_FAILED',
      });
  }
}

function themeOptions(): Array<{ value: ThemeMode; label: string }> {
  return [
    { value: 'light', label: t('settings.appearance.themeLight') },
    { value: 'dark', label: t('settings.appearance.themeDark') },
    { value: 'system', label: t('settings.appearance.themeSystem') },
  ];
}

/** 语言三选（T25-01 §0.A）：跟随系统 / 简体中文 / English。 */
type LocalePref = 'system' | 'zh-CN' | 'en-US';

function languageOptions(): Array<{ value: LocalePref; label: string }> {
  return [
    { value: 'system', label: t('settings.appearance.langSystem') },
    { value: 'zh-CN', label: t('settings.appearance.langZh') },
    { value: 'en-US', label: t('settings.appearance.langEn') },
  ];
}

/** 关闭行为三选（T54-01 §1②）：每次询问 / 最小化到托盘 / 退出应用。 */
function trayCloseOptions(): Array<{ value: TrayCloseMode; label: string }> {
  return [
    { value: 'ask', label: t('settings.close.modeAsk') },
    { value: 'tray', label: t('settings.close.modeTray') },
    { value: 'quit', label: t('settings.close.modeQuit') },
  ];
}

function describeError(error: unknown): string {
  return errorText(error);
}

/** 字节数 → 人话（KB/MB 两位以内；阈值与进制都是命名常量）。 */
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  }
  if (bytes >= BYTES_PER_KB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  }
  return `${String(bytes)} B`;
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

  // R28（T80-01）：便携包导出（预览清单 → 确认 → main 侧弹目录选择；取消 = 零落盘）
  const [portablePreview, setPortablePreview] = useState<PortableExportPreview | null>(null);
  const [portableBusy, setPortableBusy] = useState(false);
  const [portableSavedPath, setPortableSavedPath] = useState<string | null>(null);

  // R28（T80-02）：便携包导入（plan 预检零落盘 → execute 三段式换库 → 可撤销）
  const [importPlan, setImportPlan] = useState<PortableImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<PortableImportResult | null>(null);
  const [importUndoOpen, setImportUndoOpen] = useState(false);
  const [importUndoBusy, setImportUndoBusy] = useState(false);

  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  // T81-01：DB 面墓碑物理清除（dry-run 预览 → 确认执行；op_ledger 不动）
  const [dbGcPreview, setDbGcPreview] = useState<DbGcPreview | null>(null);
  const [dbGcResult, setDbGcResult] = useState<DbGcRunResult | null>(null);
  const [dbGcBusy, setDbGcBusy] = useState(false);

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

  // T81-01：同步区「自动清理」开关（settings.sync.gc；同时驱动段 GC 与 DB 面墓碑 GC）
  const handleAutoCleanup = (on: boolean): void => {
    void patch({ sync: { gc: on } });
  };

  /** dry-run 预览：只读条数/预估字节（零写；取消 = 零写）。 */
  const handleDbGcPreview = async (): Promise<void> => {
    setDbGcBusy(true);
    setError(null);
    setDbGcResult(null);
    try {
      setDbGcPreview(await window.septcats.dbgc.preview());
    } catch (cause) {
      setError(fillTemplate(t('settings.sync.cleanupFailed'), { msg: describeError(cause) }));
    } finally {
      setDbGcBusy(false);
    }
  };

  /** 确认执行：真删计划内页面（main 侧同事务分批；被删页不可恢复）。 */
  const handleDbGcRun = async (): Promise<void> => {
    setDbGcBusy(true);
    setError(null);
    try {
      setDbGcResult(await window.septcats.dbgc.run());
      setDbGcPreview(null);
    } catch (cause) {
      setError(fillTemplate(t('settings.sync.cleanupFailed'), { msg: describeError(cause) }));
    } finally {
      setDbGcBusy(false);
    }
  };

  // T25-01 §0.A：语言三选。「跟随系统」无法以 'system' 落 settings（platform schema
  // 的 locale enum 只收 zh-CN/en-US）——标记存 renderer localStorage（setLocalePref），
  // settings.locale 写入最近一次解析值；显式选择则把标记写成所选 locale 并 patch
  // settings.locale（T43-01-1：重启后 initLocale 靠标记区分「显式 system」与「无标记」）。
  const handleLanguage = (pref: LocalePref): void => {
    setLocalePref(pref);
    if (pref !== 'system') {
      void patch({ locale: pref });
      return;
    }
    // 跟随系统：settings.locale 写入最近一次解析值（真相源在 localStorage 标记）
    void patch({ locale: systemLocale() });
  };

  const handleLinkPreview = (on: boolean): void => {
    void patch({ privacy: { linkPreviewOnType: on } });
  };

  // T54-01：关闭行为三选（询问框「记住我的选择」写的就是这一项，从这里可改回）
  const handleTrayClose = (mode: TrayCloseMode): void => {
    void patch({ trayClose: mode });
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

  // R28（T80-01）①：只读预览——列条目 + 总字节，main 侧零落盘
  const handlePortablePreview = async (): Promise<void> => {
    setPortableBusy(true);
    setError(null);
    setPortableSavedPath(null);
    try {
      setPortablePreview(await window.septcats.portable.preview());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPortableBusy(false);
    }
  };

  // R28（T80-01）②：确认 → 落单个 zip（main 侧原子写；目录选择取消 = 零落盘）
  const handlePortableConfirm = async (): Promise<void> => {
    setPortableBusy(true);
    setError(null);
    try {
      const result = await window.septcats.portable.confirm({});
      if (result.canceled) {
        setPortablePreview(null);
        return;
      }
      setPortableSavedPath(result.path);
      setPortablePreview(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPortableBusy(false);
    }
  };

  // R28（T80-02）①：选包 → 只读预检（清点 + 校验和 + 目标库覆盖度，零落盘）
  const handleImportPlan = async (): Promise<void> => {
    setImportBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const planned = await window.septcats.portable.importPlan({});
      if ('canceled' in planned) {
        setImportPlan(null);
        return;
      }
      setImportPlan(planned);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setImportBusy(false);
    }
  };

  // R28（T80-02）②：确认 → 三段式换库（备份 → 重放 → 失败自动逐字节还原）
  const handleImportExecute = async (): Promise<void> => {
    const planned = importPlan;
    if (planned === null) {
      return;
    }
    setImportBusy(true);
    setError(null);
    try {
      const executed = await window.septcats.portable.importExecute({
        zipPath: planned.zipPath,
        confirm: true,
      });
      if ('canceled' in executed) {
        setImportPlan(null);
        return;
      }
      setImportResult(executed);
      setImportPlan(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setImportBusy(false);
    }
  };

  // R28（T80-02）③：撤销入口（同恢复码的「显式确认」对话框骨架）
  const handleImportUndo = async (): Promise<void> => {
    const done = importResult;
    if (done === null) {
      return;
    }
    setImportUndoBusy(true);
    setError(null);
    try {
      await window.septcats.portable.importRevert({ backupPath: done.backupPath, confirm: true });
      setImportResult(null);
      setImportUndoOpen(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setImportUndoBusy(false);
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
            <SettingsRow
              title={t('settings.appearance.language')}
              desc={t('settings.appearance.languageDesc')}
              control={
                <RadioGroup<LocalePref>
                  label={t('settings.appearance.language')}
                  name="settings-locale"
                  options={languageOptions()}
                  value={getLocalePref() === 'system' ? 'system' : settings.locale}
                  onChange={handleLanguage}
                  disabled={saving}
                />
              }
            />
            {/* T65-01 §1.2：配色派系入口（画廊）；「跟随明暗三态」主题开关已在上方 RadioGroup */}
            <ThemeSection />
          </fieldset>

          {/* T39-01 §0.5：布局设计器区块（预设卡片 + 参数微调 + 导出/导入，LayoutSection 自管） */}
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.layout.title')}</legend>
            <LayoutSection />
          </fieldset>

          {/* T81-01：同步区——自动清理开关（段 GC + DB 面墓碑 GC 共用）+ 清理已删除内容
              （dry-run 预览条数/预估字节 → 确认执行；取消 = 零写） */}
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.sync.title')}</legend>
            <SettingsRow
              title={t('settings.sync.gc')}
              desc={t('settings.sync.gcDesc')}
              control={
                <Switch
                  checked={settings.sync.gc}
                  label={t('settings.sync.gc')}
                  disabled={saving}
                  onCheckedChange={handleAutoCleanup}
                />
              }
            />
            <SettingsRow
              title={t('settings.sync.cleanup')}
              desc={t('settings.sync.cleanupDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={dbGcBusy}
                  data-testid="settings-dbgc-preview"
                  onClick={() => {
                    void handleDbGcPreview();
                  }}
                >
                  {t('settings.sync.cleanup')}
                </Button>
              }
            />
            {dbGcPreview === null ? null : (
              <div className="settings-preview-wrap" data-testid="settings-dbgc-preview-panel">
                <div className="settings-preview-title">{t('settings.sync.previewTitle')}</div>
                <div className="settings-preview-title" data-testid="settings-dbgc-meta">
                  {dbGcPreview.deletable === 0
                    ? t('settings.sync.previewEmpty')
                    : fillTemplate(t('settings.sync.previewMeta'), {
                        pages: String(dbGcPreview.deletable),
                        blocks: String(dbGcPreview.estimatedBlocks),
                        bytes: formatBytes(dbGcPreview.estimatedBytes),
                      })}
                </div>
                {dbGcPreview.held === 0 ? null : (
                  <div className="settings-lab-d" data-testid="settings-dbgc-held">
                    {fillTemplate(t('settings.sync.heldMeta'), { n: String(dbGcPreview.held) })}
                  </div>
                )}
                <div className="settings-lab-d" data-testid="settings-dbgc-retention">
                  {fillTemplate(t('settings.sync.retentionNote'), {
                    days: String(dbGcPreview.retentionDays),
                  })}
                </div>
                <div className="settings-preview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="settings-dbgc-cancel"
                    onClick={() => {
                      setDbGcPreview(null);
                    }}
                  >
                    {t('settings.sync.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={dbGcBusy}
                    disabled={dbGcPreview.deletable === 0}
                    data-testid="settings-dbgc-confirm"
                    onClick={() => {
                      void handleDbGcRun();
                    }}
                  >
                    {t('settings.sync.confirmCleanup')}
                  </Button>
                </div>
              </div>
            )}
            {dbGcResult === null ? null : (
              <div className="settings-saved" data-testid="settings-dbgc-done">
                {fillTemplate(t('settings.sync.cleanupDone'), {
                  pages: String(dbGcResult.deletedPages),
                  blocks: String(dbGcResult.deletedBlocks),
                  bytes: formatBytes(dbGcResult.bytesFreed),
                })}
              </div>
            )}
          </fieldset>

          {/* T54-01 §1②③：关闭行为（关窗询问框「记住我的选择」的落点，可改回「每次询问」） */}
          <fieldset className="settings-section">
            <legend className="settings-legend">{t('settings.close.title')}</legend>
            <SettingsRow
              title={t('settings.close.mode')}
              desc={t('settings.close.modeDesc')}
              control={
                <RadioGroup<TrayCloseMode>
                  label={t('settings.close.mode')}
                  name="settings-tray-close"
                  options={trayCloseOptions()}
                  value={settings.trayClose}
                  onChange={handleTrayClose}
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
            {/* R28（T80-01）：便携包导出——预览（零落盘）→ 确认（main 侧选目录原子写） */}
            <SettingsRow
              title={t('settings.privacy.portable.export')}
              desc={t('settings.privacy.portable.exportDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={portableBusy}
                  data-testid="settings-portable-export"
                  onClick={() => {
                    void handlePortablePreview();
                  }}
                >
                  {t('settings.privacy.portable.export')}
                </Button>
              }
            />
            {portablePreview === null ? null : (
              <div className="settings-preview-wrap" data-testid="settings-portable-preview">
                <div className="settings-preview-title">{t('settings.privacy.portable.previewTitle')}</div>
                <div className="settings-preview-title" data-testid="settings-portable-meta">
                  {fillTemplate(t('settings.privacy.portable.entries'), {
                    n: String(portablePreview.counts.entries),
                    bytes: formatBytes(portablePreview.totalBytes),
                  })}
                </div>
                <pre className="settings-preview" aria-label={t('settings.privacy.portable.previewTitle')}>
                  {portablePreview.files.map((file) => file.relPath).join('\n')}
                </pre>
                {portablePreview.warnings.length === 0 ? null : (
                  <div className="settings-recovery-warn" data-testid="settings-portable-warn">
                    {`${t('settings.privacy.portable.warningTitle')}: ${portablePreview.warnings.join(' / ')}`}
                  </div>
                )}
                <div className="settings-preview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="settings-portable-cancel"
                    onClick={() => {
                      setPortablePreview(null);
                    }}
                  >
                    {t('settings.privacy.portable.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={portableBusy}
                    data-testid="settings-portable-confirm"
                    onClick={() => {
                      void handlePortableConfirm();
                    }}
                  >
                    {t('settings.privacy.portable.confirmSave')}
                  </Button>
                </div>
              </div>
            )}
            {portableSavedPath === null ? null : (
              <div className="settings-saved" data-testid="settings-portable-saved">
                {t('settings.privacy.portable.savedTo')} {portableSavedPath}
              </div>
            )}
            {/* R28（T80-02）：便携包导入——选包预检（零落盘）→ 确认换库 → 可撤销 */}
            <SettingsRow
              title={t('settings.privacy.portable.import')}
              desc={t('settings.privacy.portable.importDesc')}
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={importBusy}
                  data-testid="settings-portable-import"
                  onClick={() => {
                    void handleImportPlan();
                  }}
                >
                  {t('settings.privacy.portable.import')}
                </Button>
              }
            />
            {importPlan === null ? null : (
              <div className="settings-preview-wrap" data-testid="settings-import-preview">
                <div className="settings-preview-title">{t('settings.privacy.portable.importTitle')}</div>
                <div className="settings-preview-title" data-testid="settings-import-meta">
                  {fillTemplate(t('settings.privacy.portable.importMeta'), {
                    n: String(importPlan.counts.entries),
                    segments: String(importPlan.counts.segments),
                    bytes: formatBytes(importPlan.bytes),
                  })}
                </div>
                <div className="settings-preview-title" data-testid="settings-import-from">
                  {fillTemplate(t('settings.privacy.portable.importFrom'), {
                    library: importPlan.manifest.library,
                    version: importPlan.manifest.appVersion,
                  })}
                </div>
                {importPlan.blocked === null ? null : (
                  <div className="settings-recovery-warn" data-testid="settings-import-blocked" role="alert">
                    {fillTemplate(t('settings.privacy.portable.importBlocked'), {
                      message: importPlan.blocked.message,
                    })}
                  </div>
                )}
                {importPlan.target.uncovered === 0 ? null : (
                  <div className="settings-recovery-warn" data-testid="settings-import-target">
                    {fillTemplate(t('settings.privacy.portable.importTarget'), {
                      uncovered: String(importPlan.target.uncovered),
                    })}
                  </div>
                )}
                {importPlan.warnings.length === 0 ? null : (
                  <div className="settings-recovery-warn" data-testid="settings-import-warn">
                    {`${t('settings.privacy.portable.warningTitle')}: ${importPlan.warnings.join(' / ')}`}
                  </div>
                )}
                <div className="settings-preview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="settings-import-cancel"
                    onClick={() => {
                      setImportPlan(null);
                    }}
                  >
                    {t('settings.privacy.portable.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    loading={importBusy}
                    disabled={importPlan.blocked !== null}
                    data-testid="settings-import-confirm"
                    onClick={() => {
                      void handleImportExecute();
                    }}
                  >
                    {t('settings.privacy.portable.confirmImport')}
                  </Button>
                </div>
              </div>
            )}
            {importResult === null ? null : (
              <div className="settings-preview-wrap" data-testid="settings-import-done">
                <div className="settings-preview-title">{t('settings.privacy.portable.importDone')}</div>
                <div className="settings-saved" data-testid="settings-import-backup">
                  {`${t('settings.privacy.portable.backupTo')} ${importResult.backupPath}`}
                </div>
                <div className="settings-preview-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="settings-import-undo"
                    onClick={() => {
                      setImportUndoOpen(true);
                    }}
                  >
                    {t('settings.privacy.portable.undo')}
                  </Button>
                </div>
              </div>
            )}
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
              title={t('settings.about.thirdPartyLicense')}
              control={
                <span className="settings-lab-d">{t('settings.about.thirdPartyLicenseFile')}</span>
              }
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

      {/* R28（T80-02）：撤销导入的显式确认（骨架同恢复码三件套：取消 / 确认还原） */}
      <Dialog
        open={importUndoOpen}
        onClose={() => {
          setImportUndoOpen(false);
        }}
        title={t('settings.privacy.portable.undoTitle')}
        footer={
          <div className="settings-preview-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setImportUndoOpen(false);
              }}
            >
              {t('settings.privacy.portable.cancel')}
            </Button>
            <Button
              size="sm"
              loading={importUndoBusy}
              data-testid="settings-import-undo-confirm"
              onClick={() => {
                void handleImportUndo();
              }}
            >
              {t('settings.privacy.portable.undo')}
            </Button>
          </div>
        }
      >
        <p className="settings-update-confirm-body">{t('settings.privacy.portable.undoDesc')}</p>
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
