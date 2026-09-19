/**
 * LayoutSection.tsx —— 设置页「布局」区块（TASK-T39-01 §0.5）。
 *
 * 组成：预设卡片三选（notion/focus/workbench，点卡片即时生效并持久化）+
 * 参数微调（侧栏位置/宽度、内容 measure、AI 面板位置/默认展开、标签条、主题、密度）+
 * 导出/导入（剪贴板双向；导入非法 JSON 给可读错误且不改当前布局）。
 *
 * 口径：
 * - 参数经 layoutActions（layoutState.ts）→ CSS 变量注入根节点 + localStorage 持久化；
 *   宽度/measure 输入在提交（失焦/回车）时夹紧到区间，输入框回显夹紧后实际值。
 * - 主题复用既有机制：setGlobalThemeMode（ThemeProvider 管道）+ settings.patch（照
 *   SettingsPage.handleTheme），布局快照只同步记录字段（layoutState.setTheme）。
 * - 密度走 token 档位（App.css :root[data-sc-density] 派生变量），不写死数值。
 * - 照 AiSection 范式：内容/弹窗/i18n 自管，SettingsPage 只给 fieldset 壳。
 */
import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, Dialog, Input, RadioGroup, Switch, setGlobalThemeMode } from '@septcats/ui';
import type { ThemeMode } from '../../../shared/settings';
import { t } from '../i18n';
import {
  layoutActions,
  useLayout,
  type AiPanelPosition,
  type LayoutDensity,
  type LayoutPresetId,
  type LayoutTheme,
  type SidebarPosition,
} from './layoutState';
import './LayoutSection.css';

const PRESET_IDS: readonly LayoutPresetId[] = ['notion', 'focus', 'workbench'];

function presetOptions(): Array<{ value: SidebarPosition; label: string }> {
  return [
    { value: 'left', label: t('settings.layout.sidebarLeft') },
    { value: 'collapsed', label: t('settings.layout.sidebarCollapsed') },
  ];
}

function aiPositionOptions(): Array<{ value: AiPanelPosition; label: string }> {
  return [
    { value: 'right', label: t('settings.layout.aiRight') },
    { value: 'bottom', label: t('settings.layout.aiBottom') },
    { value: 'hidden', label: t('settings.layout.aiHidden') },
  ];
}

function themeOptions(): Array<{ value: LayoutTheme; label: string }> {
  return [
    { value: 'light', label: t('settings.appearance.themeLight') },
    { value: 'dark', label: t('settings.appearance.themeDark') },
    { value: 'system', label: t('settings.appearance.themeSystem') },
  ];
}

function densityOptions(): Array<{ value: LayoutDensity; label: string }> {
  return [
    { value: 'comfortable', label: t('settings.layout.densityComfortable') },
    { value: 'compact', label: t('settings.layout.densityCompact') },
  ];
}

interface DraftNumberProps {
  label: string;
  desc: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onCommit: () => void;
  testId: string;
}

/** 数值输入行：失焦/回车提交（提交时夹紧，输入框回显夹紧后实际值）。 */
function DraftNumberRow({ label, desc, draft, onDraftChange, onCommit, testId }: DraftNumberProps) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    }
  };
  return (
    <div className="settings-row">
      <div className="settings-lab">
        <span className="settings-lab-b">{label}</span>
        <span className="settings-lab-d">{desc}</span>
      </div>
      <div className="settings-ctl layout-number-ctl">
        <Input
          type="number"
          value={draft}
          aria-label={label}
          data-testid={testId}
          onChange={(event) => {
            onDraftChange(event.target.value);
          }}
          onBlur={onCommit}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}

export function LayoutSection() {
  const layout = useLayout((state) => state.layout);

  // 数值输入草稿：layout 变化（预设/导入/夹紧回写）时回显实际值
  const [widthDraft, setWidthDraft] = useState(String(layout.sidebar.width));
  const [measureDraft, setMeasureDraft] = useState(String(layout.content.measure));
  useEffect(() => {
    setWidthDraft(String(layout.sidebar.width));
  }, [layout.sidebar.width]);
  useEffect(() => {
    setMeasureDraft(String(layout.content.measure));
  }, [layout.content.measure]);

  // 导出/导入反馈（剪贴板双向；导出复制失败 → 弹窗内给 JSON 供手动复制）
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<string | null>(null);

  const commitWidth = (): void => {
    const parsed = Number(widthDraft);
    if (widthDraft.trim() === '' || !Number.isFinite(parsed)) {
      setWidthDraft(String(layout.sidebar.width));
      return;
    }
    layoutActions.setSidebarWidth(parsed);
  };

  const commitMeasure = (): void => {
    const parsed = Number(measureDraft);
    if (measureDraft.trim() === '' || !Number.isFinite(parsed)) {
      setMeasureDraft(String(layout.content.measure));
      return;
    }
    layoutActions.setMeasure(parsed);
  };

  const handleExport = async (): Promise<void> => {
    setExportNote(null);
    setExportJson(null);
    const json = layoutActions.exportJson();
    try {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) {
        throw new Error('clipboard unavailable');
      }
      await clipboard.writeText(json);
      setExportNote(t('settings.layout.exportOk'));
    } catch {
      setExportJson(json);
      setExportNote(t('settings.layout.exportFail'));
    }
  };

  const openImport = (): void => {
    setImportOpen(true);
    setImportText('');
    setImportError(null);
    setImportOk(null);
  };

  const submitImport = (): void => {
    setImportError(null);
    setImportOk(null);
    const result = layoutActions.importFromText(importText);
    if (!result.ok) {
      setImportError(t(result.reason === 'json' ? 'settings.layout.importBadJson' : 'settings.layout.importBadShape'));
      return;
    }
    setImportOk(t('settings.layout.importOk'));
    setImportOpen(false);
  };

  const handleTheme = (mode: LayoutTheme): void => {
    setGlobalThemeMode(mode as ThemeMode);
    layoutActions.setTheme(mode);
    void window.septcats.settings.patch({ theme: mode as ThemeMode }).catch(() => {
      // settings 落盘失败不阻断 UI：主题已即时生效，布局快照已记录
    });
  };

  return (
    <div className="layout-section" data-testid="layout-section">
      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.preset')}</span>
          <span className="settings-lab-d">{t('settings.layout.presetSectionDesc')}</span>
        </div>
        <div className="settings-ctl" />
      </div>
      <div className="layout-presets" role="group" aria-label={t('settings.layout.preset')}>
        {PRESET_IDS.map((id) => {
          const active = layout.preset === id;
          return (
            <button
              key={id}
              type="button"
              className={`layout-preset-card${active ? ' layout-preset-card--active' : ''}`}
              aria-pressed={active}
              data-testid={`layout-preset-${id}`}
              onClick={() => {
                layoutActions.applyPreset(id);
                setExportNote(null);
                setExportJson(null);
                setImportOk(null);
              }}
            >
              <span className="layout-preset-name">{t(`settings.layout.presetName.${id}`)}</span>
              <span className="layout-preset-desc">{t(`settings.layout.presetDesc.${id}`)}</span>
            </button>
          );
        })}
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.sidebar')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<SidebarPosition>
            label={t('settings.layout.sidebar')}
            name="layout-sidebar-position"
            options={presetOptions()}
            value={layout.sidebar.position}
            onChange={(position) => {
              layoutActions.setSidebarPosition(position);
            }}
          />
        </div>
      </div>

      <DraftNumberRow
        label={t('settings.layout.sidebarWidth')}
        desc={t('settings.layout.sidebarWidthDesc')}
        draft={widthDraft}
        onDraftChange={setWidthDraft}
        onCommit={commitWidth}
        testId="layout-sidebar-width"
      />

      <DraftNumberRow
        label={t('settings.layout.measure')}
        desc={t('settings.layout.measureDesc')}
        draft={measureDraft}
        onDraftChange={setMeasureDraft}
        onCommit={commitMeasure}
        testId="layout-measure"
      />

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.ai')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<AiPanelPosition>
            label={t('settings.layout.ai')}
            name="layout-ai-position"
            options={aiPositionOptions()}
            value={layout.ai.position}
            onChange={(position) => {
              layoutActions.setAiPosition(position);
            }}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.aiExpanded')}</span>
          <span className="settings-lab-d">{t('settings.layout.aiExpandedDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Switch
            checked={layout.ai.expanded}
            onCheckedChange={(on) => {
              layoutActions.setAiExpanded(on);
            }}
            label={t('settings.layout.aiExpanded')}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.tabs')}</span>
          <span className="settings-lab-d">{t('settings.layout.tabsDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Switch
            checked={layout.tabsVisible}
            onCheckedChange={(on) => {
              layoutActions.setTabsVisible(on);
            }}
            label={t('settings.layout.tabs')}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.theme')}</span>
          <span className="settings-lab-d">{t('settings.layout.themeDesc')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<LayoutTheme>
            label={t('settings.layout.theme')}
            name="layout-theme"
            options={themeOptions()}
            value={layout.theme}
            onChange={handleTheme}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.density')}</span>
          <span className="settings-lab-d">{t('settings.layout.densityDesc')}</span>
        </div>
        <div className="settings-ctl">
          <RadioGroup<LayoutDensity>
            label={t('settings.layout.density')}
            name="layout-density"
            options={densityOptions()}
            value={layout.density}
            onChange={(density) => {
              layoutActions.setDensity(density);
            }}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.export')}</span>
          <span className="settings-lab-d">{t('settings.layout.exportDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Button variant="secondary" size="sm" onClick={() => void handleExport()}>
            {t('settings.layout.export')}
          </Button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-lab">
          <span className="settings-lab-b">{t('settings.layout.import')}</span>
          <span className="settings-lab-d">{t('settings.layout.importDesc')}</span>
        </div>
        <div className="settings-ctl">
          <Button variant="secondary" size="sm" onClick={openImport}>
            {t('settings.layout.import')}
          </Button>
        </div>
      </div>

      {exportNote === null ? null : (
        <div className="layout-note" data-testid="layout-export-note">
          {exportNote}
        </div>
      )}
      {exportJson === null ? null : (
        <textarea
          className="layout-json"
          rows={4}
          readOnly
          value={exportJson}
          aria-label={t('settings.layout.exportFail')}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
      )}
      {importOk === null ? null : (
        <div className="layout-note" data-testid="layout-import-ok">
          {importOk}
        </div>
      )}

      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        title={t('settings.layout.importDialogTitle')}
        footer={
          <div className="layout-dialog-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setImportOpen(false);
              }}
            >
              {t('settings.layout.cancel')}
            </Button>
            <Button size="sm" disabled={importText.trim().length === 0} onClick={submitImport}>
              {t('settings.layout.importDialogSubmit')}
            </Button>
          </div>
        }
      >
        <p className="layout-dialog-body">{t('settings.layout.importDialogBody')}</p>
        <textarea
          className="layout-json"
          rows={4}
          value={importText}
          placeholder={t('settings.layout.importDialogPlaceholder')}
          aria-label={t('settings.layout.importDialogTitle')}
          data-testid="layout-import-input"
          onChange={(event) => {
            setImportText(event.target.value);
          }}
        />
        {importError === null ? null : (
          <p className="layout-import-error" role="alert" data-testid="layout-import-error">
            {importError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
