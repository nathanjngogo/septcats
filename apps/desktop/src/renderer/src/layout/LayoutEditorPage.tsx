/**
 * LayoutEditorPage.tsx —— 独立布局编辑器页（TASK-T57-01 §1.3）。
 *
 * 由设置页原 `LayoutSection` 迁移/重排为整页编辑器（旧 section 只留一枚入口按钮，
 * 避免两套编辑 UI 行为分叉）：
 *  - 左列：预设卡片列（三张，CSS 抽象微缩图）+ 当前布局的大预览图（同 LayoutPreview，
 *    `lg` 档）；
 *  - 右列：细项表单——侧栏位置、侧栏宽度滑杆、正文宽度滑杆、AI 面板位置、AI 默认展开、
 *    标签条、密度、主题；外加迁移保留的布局 JSON 导出/导入；
 *  - 顶栏：「恢复默认」+「完成」。
 *
 * 口径：
 *  - 全部写经 `layoutActions`（layoutState.ts）→ CSS 变量注入根节点 + localStorage
 *    持久化，主窗口（弹框/编辑器背后的真实排布）实时跟随；数值控件直接以滑杆回写
 *    夹紧后的实际值（滑杆 min/max 即夹紧区间，天然不越界）；
 *  - 主题复用既有机制（setGlobalThemeMode + settings.patch），与设置页「外观」同一真相源；
 *  - 控件全部复用 @septcats/ui（Button/RadioGroup/Switch/Input），滑杆为本页薄封装
 *    （原生 `input[type=range]` 吃 T53 token；packages/ui 无滑杆组件，红线禁改 packages/**）。
 */
import { useState } from 'react';
import { Button, Dialog, RadioGroup, Switch, setGlobalThemeMode } from '@septcats/ui';
import type { ThemeMode } from '../../../shared/settings';
import { t } from '../i18n';
import { pushToast } from '../state/pages';
import { LayoutPreviewDiagram } from './LayoutPreview';
import {
  AI_WIDTH_MIN,
  MEASURE_MAX,
  MEASURE_MIN,
  SIDEBAR_WIDTH_MIN,
  layoutActions,
  layoutPreviewForPreset,
  layoutPreviewOf,
  maxPanelWidth,
  useLayout,
  useViewportWidth,
  type AiPanelPosition,
  type LayoutDensity,
  type LayoutPresetId,
  type LayoutTheme,
  type SidebarPosition,
} from './layoutState';
import './LayoutEditorPage.css';

const PRESET_IDS: readonly LayoutPresetId[] = ['notion', 'focus', 'workbench'];
/** 滑杆步长（宽度 10px 档 / measure 20px 档：够细又不抖）。 */
const SIDEBAR_WIDTH_STEP = 10;
const MEASURE_STEP = 20;

function sidebarOptions(): Array<{ value: SidebarPosition; label: string }> {
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

interface LayoutSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  onChange: (value: number) => void;
}

/** 数值滑杆：显示夹紧后实际值（滑杆区间 = 夹紧区间，二者同源常量）。 */
function LayoutSlider({ label, value, min, max, step, testId, onChange }: LayoutSliderProps) {
  return (
    <div className="layout-editor__slider">
      <input
        type="range"
        className="layout-editor__range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
        }}
      />
      <span className="layout-editor__slider-value" data-testid={`${testId}-value`}>
        {value}
        <span className="layout-editor__unit">{t('settings.layout.unitPx')}</span>
      </span>
    </div>
  );
}

export interface LayoutEditorPageProps {
  /** 「完成」出口：回编辑器视图（不额外写状态——改动已即时生效）。 */
  onDone: () => void;
}

export function LayoutEditorPage({ onDone }: LayoutEditorPageProps) {
  const layout = useLayout((state) => state.layout);
  // T61-01 §2：宽度滑杆上限 = min(480, 视口 30%)——随窗口实时变化（useViewportWidth 订阅 resize）。
  // 下限优先：极窄视口时保证滑杆区间非空（与 clampSidebarWidth/clampAiWidth 同口径）。
  const viewportWidth = useViewportWidth();
  const panelMax = maxPanelWidth(viewportWidth);
  const sidebarMaxWidth = Math.max(SIDEBAR_WIDTH_MIN, panelMax);
  const aiMaxWidth = Math.max(AI_WIDTH_MIN, panelMax);
  const preview = layoutPreviewOf(layout, viewportWidth);

  // 导出/导入反馈（剪贴板双向；导出复制失败 → 弹窗内给 JSON 供手动复制）
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<string | null>(null);

  const applyPreset = (id: LayoutPresetId): void => {
    layoutActions.applyPreset(id);
    setExportNote(null);
    setExportJson(null);
    setImportOk(null);
    pushToast(t('settings.layout.presetSwitched').replace('{name}', t(`settings.layout.presetName.${id}`)), 'info');
  };

  const handleReset = (): void => {
    layoutActions.resetLayout();
    setExportNote(null);
    setExportJson(null);
    setImportOk(null);
    pushToast(t('settings.layout.resetDone'), 'info');
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
    <div className="layout-editor" data-testid="layout-editor">
      <header className="layout-editor__bar">
        <h2 className="layout-editor__title">{t('settings.layout.editorTitle')}</h2>
        <div className="layout-editor__bar-actions">
          <Button
            variant="secondary"
            size="sm"
            data-testid="layout-editor-reset"
            onClick={handleReset}
          >
            {t('settings.layout.editorReset')}
          </Button>
          <Button size="sm" data-testid="layout-editor-done" onClick={onDone}>
            {t('settings.layout.editorDone')}
          </Button>
        </div>
      </header>

      <div className="layout-editor__body">
        <section className="layout-editor__left" aria-label={t('settings.layout.editorPreview')}>
          <div className="layout-editor__preview" data-testid="layout-editor-preview">
            <LayoutPreviewDiagram preview={preview} size="lg" />
          </div>

          <div className="layout-editor__presets" role="group" aria-label={t('settings.layout.preset')}>
            {PRESET_IDS.map((id) => {
              const active = layout.preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`layout-editor__card${active ? ' layout-editor__card--active' : ''}`}
                  aria-pressed={active}
                  data-testid={`layout-preset-${id}`}
                  onClick={() => {
                    applyPreset(id);
                  }}
                >
                  <LayoutPreviewDiagram preview={layoutPreviewForPreset(id)} />
                  <span className="layout-editor__card-text">
                    <span className="layout-editor__card-name">{t(`settings.layout.presetName.${id}`)}</span>
                    <span className="layout-editor__card-desc">{t(`settings.layout.presetDesc.${id}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="layout-editor__right" aria-label={t('settings.layout.editorDetails')}>
          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.sidebar')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <RadioGroup<SidebarPosition>
                label={t('settings.layout.sidebar')}
                name="layout-editor-sidebar-position"
                options={sidebarOptions()}
                value={layout.sidebar.position}
                onChange={(position) => {
                  layoutActions.setSidebarPosition(position);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.sidebarWidth')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.sidebarWidthDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <LayoutSlider
                label={t('settings.layout.sidebarWidth')}
                value={layout.sidebar.width}
                min={SIDEBAR_WIDTH_MIN}
                max={sidebarMaxWidth}
                step={SIDEBAR_WIDTH_STEP}
                testId="layout-sidebar-width"
                onChange={(width) => {
                  layoutActions.setSidebarWidth(width);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.measure')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.measureDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <LayoutSlider
                label={t('settings.layout.measure')}
                value={layout.content.measure}
                min={MEASURE_MIN}
                max={MEASURE_MAX}
                step={MEASURE_STEP}
                testId="layout-measure"
                onChange={(measure) => {
                  layoutActions.setMeasure(measure);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.ai')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <RadioGroup<AiPanelPosition>
                label={t('settings.layout.ai')}
                name="layout-editor-ai-position"
                options={aiPositionOptions()}
                value={layout.ai.position}
                onChange={(position) => {
                  layoutActions.setAiPosition(position);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.aiWidth')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.aiWidthDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <LayoutSlider
                label={t('settings.layout.aiWidth')}
                value={layout.ai.width}
                min={AI_WIDTH_MIN}
                max={aiMaxWidth}
                step={SIDEBAR_WIDTH_STEP}
                testId="layout-ai-width"
                onChange={(width) => {
                  layoutActions.setAiWidth(width);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.aiExpanded')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.aiExpandedDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <Switch
                checked={layout.ai.expanded}
                onCheckedChange={(on) => {
                  layoutActions.setAiExpanded(on);
                }}
                label={t('settings.layout.aiExpanded')}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.tabs')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.tabsDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <Switch
                checked={layout.tabsVisible}
                onCheckedChange={(on) => {
                  layoutActions.setTabsVisible(on);
                }}
                label={t('settings.layout.tabs')}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.density')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.densityDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <RadioGroup<LayoutDensity>
                label={t('settings.layout.density')}
                name="layout-editor-density"
                options={densityOptions()}
                value={layout.density}
                onChange={(density) => {
                  layoutActions.setDensity(density);
                }}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.theme')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.themeDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <RadioGroup<LayoutTheme>
                label={t('settings.layout.theme')}
                name="layout-editor-theme"
                options={themeOptions()}
                value={layout.theme}
                onChange={handleTheme}
              />
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.export')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.exportDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <Button variant="secondary" size="sm" onClick={() => void handleExport()}>
                {t('settings.layout.export')}
              </Button>
            </div>
          </div>

          <div className="layout-editor__row">
            <div className="layout-editor__row-label">
              <span className="layout-editor__row-title">{t('settings.layout.import')}</span>
              <span className="layout-editor__row-desc">{t('settings.layout.importDesc')}</span>
            </div>
            <div className="layout-editor__row-ctl">
              <Button variant="secondary" size="sm" onClick={openImport}>
                {t('settings.layout.import')}
              </Button>
            </div>
          </div>

          {exportNote === null ? null : (
            <div className="layout-editor__note" data-testid="layout-export-note">
              {exportNote}
            </div>
          )}
          {exportJson === null ? null : (
            <textarea
              className="layout-editor__json"
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
            <div className="layout-editor__note" data-testid="layout-import-ok">
              {importOk}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        title={t('settings.layout.importDialogTitle')}
        footer={
          <div className="layout-editor__dialog-actions">
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
        <p className="layout-editor__dialog-body">{t('settings.layout.importDialogBody')}</p>
        <textarea
          className="layout-editor__json"
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
          <p className="layout-editor__import-error" role="alert" data-testid="layout-import-error">
            {importError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
