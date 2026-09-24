/**
 * TemplateMarketPage.tsx —— 工作台模板市场（TASK-T72-01 §范围2）。
 *
 * 全屏 region 页（学 LayoutEditorPage 壳 + WorkbenchPage 的 role/Esc）：两 Tab
 * 「模板 / 卡片」。模板 Tab = 内置模板 + 我的模板，卡带预览缩略 + 「应用于当前库」
 * （先弹确认框 wb-apply-confirm，确认前一键备份当前布局到 septcats.wbcard.layoutBackup，
 * 并提供「还原备份」入口 wb-restore-layout）；卡片 Tab = 注册表全卡列表 + 状态位 + 开关
 * （开关同源 = workbenchActions.setCardHidden，与自定义模式共用同一真相源）。
 *
 * 导入 / 导出：导出 = 单 JSON 下载（文件名 <id>.json）；导入 = 文件选择或粘贴 JSON →
 * 校验形状 → 存为「我的模板」，坏 JSON 给 toast 且不落库。
 *
 * 红线：框轮廓一律 var(--sc-color-ink-edge)；CSS 走 token；禁词「数据库」→「多维数据」；
 * 零外联（模板 JSON 不内嵌 URL 请求，未新增 openExternal 通道）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Icon, PixelShopGlyph, Switch, X } from '@septcats/ui';
import { t } from '../i18n';
import { pushToast } from '../state/pages';
import { templatesActions, useTemplates } from '../state/templates';
import type { SeptcatsApi } from '../../../types/window';
import {
  ALL_CARD_IDS,
  useWorkbench,
} from './state';
import { CARD_DEFS } from './cards';
import {
  applyTemplateSeeds,
  applyTemplateToWorkbench,
  backupCurrentLayout,
  parseWorkbenchTemplateText,
  readLayoutBackup,
  restoreLayoutBackup,
  toggleWorkbenchCard,
  writeLayoutBackup,
  type SeedPage,
  type WorkbenchTemplate,
  type WorkbenchTemplateLayout,
} from './market';
import './TemplateMarketPage.css';

function typedApi(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload did not inject window.septcats');
  }
  return value;
}

/** 把主进程「我的模板」payload（{title,layout,seedPages}）映射到市场统一形状。 */
function minePayloadToTemplate(id: string, title: string, payload: unknown): WorkbenchTemplate | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const layoutRaw = record.layout;
  if (typeof layoutRaw !== 'object' || layoutRaw === null) {
    return null;
  }
  const lr = layoutRaw as Record<string, unknown>;
  if (lr.v !== 2 || !Array.isArray(lr.order) || !Array.isArray(lr.hidden)) {
    return null;
  }
  const seedPagesRaw = Array.isArray(record.seedPages) ? record.seedPages : [];
  const seedPages: SeedPage[] = seedPagesRaw.map((entry) => {
    const row = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return { title: typeof row.title === 'string' ? row.title : '', body: typeof row.body === 'string' ? row.body : '' };
  });
  return {
    id,
    title,
    desc: '',
    layout: { v: 2, order: lr.order as string[], hidden: lr.hidden as string[] },
    seedPages,
  };
}

export interface TemplateMarketPageProps {
  onClose(): void;
  /** 「我的工作台」行内钮（保留的 workbench-open）：切回工作台 home 视图。 */
  onOpenWorkbench(): void;
}

type Tab = 'templates' | 'cards';

export function TemplateMarketPage({ onClose, onOpenWorkbench }: TemplateMarketPageProps) {
  const [tab, setTab] = useState<Tab>('templates');
  const [builtins, setBuiltins] = useState<WorkbenchTemplate[]>([]);
  const [applyTarget, setApplyTarget] = useState<WorkbenchTemplate | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState<string | null>(null);

  const hiddenCards = useWorkbench((state) => state.hiddenCards);
  // 选择器必须返回稳定引用（避免 useSyncExternalStore 每次返回新数组导致无限重渲染）：
  // 先取 state.templates 原引用，再在渲染期用 useMemo 过滤。
  const allTemplates = useTemplates((state) => state.templates);
  const mineTemplates = useMemo(
    () => allTemplates.filter((tpl) => tpl.kind === 'workbench'),
    [allTemplates],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 挂载即拉内置模板 + 我的模板
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const { templates } = await typedApi().workbenchTemplates.list();
        setBuiltins(
          templates.map((entry) => ({
            id: entry.id,
            title: entry.title,
            desc: entry.desc,
            layout: { v: 2, order: entry.layout.order, hidden: entry.layout.hidden },
            seedPages: entry.seedPages,
          })),
        );
      } catch {
        setBuiltins([]);
      }
    })();
    void templatesActions.loadTemplates();
  }, []);

  // Esc 关闭回工作台（§范围2 红线：市场不得成为死角）
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleApplyConfirm = async (): Promise<void> => {
    if (applyTarget === null) {
      return;
    }
    const target = applyTarget;
    const backup = backupCurrentLayout();
    writeLayoutBackup(backup);
    applyTemplateToWorkbench(target);
    pushToast(t('workbench.market.appliedToast'), 'success');
    setApplyTarget(null);
    try {
      await applyTemplateSeeds(target.seedPages);
    } catch {
      // 种子页落盘失败已是逐条降级，不阻断（DEVIATION 由 seed 降级口径覆盖）
    }
  };

  const handleRestore = (): void => {
    const json = readLayoutBackup();
    if (json !== null && restoreLayoutBackup(json)) {
      pushToast(t('workbench.market.restoreToast'), 'success');
    } else {
      pushToast(t('workbench.market.importBadJson'), 'info');
    }
  };

  const handleExport = (template: WorkbenchTemplate): void => {
    const payload = {
      id: template.id,
      title: template.title,
      desc: template.desc,
      layout: template.layout,
      seedPages: template.seedPages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${template.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const fetchMineFull = async (id: string): Promise<WorkbenchTemplate | null> => {
    try {
      const { template } = await typedApi().templates.get({ id });
      return minePayloadToTemplate(id, template.title, template.payload);
    } catch {
      return null;
    }
  };

  const handleApplyMine = async (id: string): Promise<void> => {
    const full = await fetchMineFull(id);
    if (full !== null) {
      setApplyTarget(full);
    }
  };

  const handleExportMine = async (id: string): Promise<void> => {
    const full = await fetchMineFull(id);
    if (full !== null) {
      handleExport(full);
    }
  };

  const handleDeleteMine = async (id: string): Promise<void> => {
    await templatesActions.deleteTemplate(id);
  };

  const handleImportConfirm = async (): Promise<void> => {
    const text = importText.trim();
    if (text.length === 0) {
      pushToast(t('workbench.market.importBadJson'), 'danger');
      return;
    }
    const result = parseWorkbenchTemplateText(text, importFileName ?? 'imported');
    if (!result.ok || result.template === undefined) {
      pushToast(result.error !== undefined ? t(result.error) : t('workbench.market.importBadJson'), 'danger');
      return;
    }
    const layout: WorkbenchTemplateLayout = result.template.layout;
    const ok = await templatesActions.saveWorkbench({
      title: result.template.title,
      layout,
      seedPages: result.template.seedPages,
    });
    if (ok) {
      setImportOpen(false);
      setImportText('');
      setImportFileName(null);
    }
  };

  const handleImportFile = (file: File | undefined): void => {
    if (file === undefined) {
      return;
    }
    setImportFileName(file.name.replace(/\.json$/i, ''));
    const reader = new FileReader();
    reader.onload = (): void => {
      if (typeof reader.result === 'string') {
        setImportText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      className="wbm-root"
      role="region"
      aria-label={t('workbench.market.title')}
      data-testid="wb-market"
      tabIndex={-1}
    >
      <div className="wbm-head">
        <h1 className="wbm-title">
          <PixelShopGlyph size={20} className="wbm-title__glyph" aria-hidden="true" />
          {t('workbench.market.title')}
        </h1>
        <div className="wbm-head__actions">
          {/* T72 §范围1：保留 workbench-open 作为市场内「我的工作台」行内钮 */}
          <button
            type="button"
            className="wbm-workbench"
            aria-label={t('app.workbenchLabel')}
            data-testid="workbench-open"
            onClick={onOpenWorkbench}
          >
            <Icon icon={X} size="sm" className="wbm-workbench__x" aria-hidden="true" />
            {t('app.workbenchLabel')}
          </button>
          <button
            type="button"
            className="wbm-import"
            data-testid="wb-market-import"
            onClick={() => setImportOpen(true)}
          >
            {t('workbench.market.importTitle')}
          </button>
          <button
            type="button"
            className="wbm-close"
            aria-label={t('workbench.market.close')}
            title={t('workbench.market.close')}
            data-testid="wb-market-close"
            onClick={onClose}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      </div>

      <div className="wbm-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'templates'}
          className={tab === 'templates' ? 'wbm-tab wbm-tab--active' : 'wbm-tab'}
          data-testid="wb-market-tab-templates"
          onClick={() => setTab('templates')}
        >
          {t('workbench.market.tabTemplates')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cards'}
          className={tab === 'cards' ? 'wbm-tab wbm-tab--active' : 'wbm-tab'}
          data-testid="wb-market-tab-cards"
          onClick={() => setTab('cards')}
        >
          {t('workbench.market.tabCards')}
        </button>
      </div>

      <div className="wbm-body">
        {tab === 'templates' ? (
          <div className="wbm-templates">
            <section className="wbm-section">
              <h2 className="wbm-section__title">{t('workbench.market.builtinSection')}</h2>
              <div className="wbm-cards">
                {builtins.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onApply={() => setApplyTarget(template)}
                    onExport={() => handleExport(template)}
                  />
                ))}
              </div>
            </section>
            <section className="wbm-section">
              <h2 className="wbm-section__title">
                {t('workbench.market.mineSection')}
                <button
                  type="button"
                  className="wbm-restore"
                  data-testid="wb-restore-layout"
                  onClick={handleRestore}
                >
                  {t('workbench.market.restore')}
                </button>
              </h2>
              {mineTemplates.length === 0 ? (
                <p className="wbm-empty">{t('workbench.market.emptyMine')}</p>
              ) : (
                <div className="wbm-cards">
                  {mineTemplates.map((meta) => (
                    <MineTemplateCard
                      key={meta.id}
                      id={meta.id}
                      title={meta.title}
                      onApply={() => void handleApplyMine(meta.id)}
                      onExport={() => void handleExportMine(meta.id)}
                      onDelete={() => void handleDeleteMine(meta.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="wbm-cards-tab">
            {ALL_CARD_IDS.map((id) => {
              const def = CARD_DEFS[id];
              const enabled = !hiddenCards.includes(id);
              return (
                <div key={id} className="wbm-cardrow" data-testid={`wb-market-card-${id}`}>
                  <div className="wbm-cardrow__info">
                    <span className="wbm-cardrow__name">{t(def.labelKey)}</span>
                    <span
                      className="wbm-cardrow__status"
                      data-testid={`wb-market-card-status-${id}`}
                    >
                      {enabled ? t('workbench.market.cardEnabled') : t('workbench.market.cardDisabled')}
                    </span>
                  </div>
                  <Switch
                    checked={enabled}
                    label={t(def.labelKey)}
                    onCheckedChange={(checked: boolean): void => toggleWorkbenchCard(id, !checked)}
                    data-testid={`wb-market-card-toggle-${id}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={applyTarget !== null}
        onClose={() => setApplyTarget(null)}
        title={t('workbench.market.applyConfirmTitle')}
      >
        <p className="wbm-apply__body" data-testid="wb-apply-confirm">
          {applyTarget !== null ? applyTarget.title : ''}
          {t('workbench.market.applyConfirmSep')}
          {t('workbench.market.applyConfirmBody')}
        </p>
        <div className="sc-dialog__footer">
          <Button variant="ghost" onClick={() => setApplyTarget(null)}>
            {t('workbench.market.applyConfirmNo')}
          </Button>
          <Button variant="primary" onClick={() => void handleApplyConfirm()}>
            {t('workbench.market.applyConfirmYes')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} title={t('workbench.market.importTitle')}>
        <div className="wbm-import-dialog">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="wbm-import-dialog__file"
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
              handleImportFile(event.target.files?.[0])
            }
          />
          <label className="wbm-import-dialog__label">{t('workbench.market.importTextLabel')}</label>
          <textarea
            className="wbm-import-dialog__textarea"
            data-testid="wb-market-import-text"
            value={importText}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void =>
              setImportText(event.target.value)
            }
            rows={8}
          />
        </div>
        <div className="sc-dialog__footer">
          <Button variant="ghost" onClick={() => setImportOpen(false)}>
            {t('workbench.market.applyConfirmNo')}
          </Button>
          <Button
            variant="primary"
            data-testid="wb-market-import-confirm"
            onClick={() => void handleImportConfirm()}
          >
            {t('workbench.market.importConfirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function TemplateCard({
  template,
  onApply,
  onExport,
}: {
  template: WorkbenchTemplate;
  onApply(): void;
  onExport(): void;
}) {
  return (
    <div className="wbm-card" data-testid={`wb-market-template-${template.id}`}>
      <PreviewGlyph order={template.layout.order} hidden={template.layout.hidden} />
      <div className="wbm-card__body">
        <h3 className="wbm-card__title">{template.title}</h3>
        {template.desc.length > 0 ? (
          <p className="wbm-card__desc">{template.desc}</p>
        ) : null}
      </div>
      <div className="wbm-card__actions">
        <Button
          variant="secondary"
          size="sm"
          data-testid={`wb-market-template-apply-${template.id}`}
          onClick={onApply}
        >
          {t('workbench.market.apply')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`wb-market-template-export-${template.id}`}
          onClick={onExport}
        >
          {t('workbench.market.export')}
        </Button>
      </div>
    </div>
  );
}

function MineTemplateCard({
  id,
  title,
  onApply,
  onExport,
  onDelete,
}: {
  id: string;
  title: string;
  onApply(): void;
  onExport(): void;
  onDelete(): void;
}) {
  return (
    <div className="wbm-card" data-testid={`wb-market-template-${id}`}>
      <div className="wbm-card__body">
        <h3 className="wbm-card__title">{title}</h3>
      </div>
      <div className="wbm-card__actions">
        <Button variant="secondary" size="sm" data-testid={`wb-market-template-apply-${id}`} onClick={onApply}>
          {t('workbench.market.apply')}
        </Button>
        <Button variant="ghost" size="sm" data-testid={`wb-market-template-export-${id}`} onClick={onExport}>
          {t('workbench.market.export')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`wb-market-template-delete-${id}`}
          onClick={onDelete}
        >
          {t('workbench.market.delete')}
        </Button>
      </div>
    </div>
  );
}

/** 像素风预览缩略：竖排条 = 卡片序；启用=实墨，未启用=浅。 */
function PreviewGlyph({ order, hidden }: { order: string[]; hidden: string[] }) {
  const hiddenSet = new Set(hidden);
  return (
    <div className="wbm-preview" data-testid="wb-market-preview" aria-hidden="true">
      {order.map((id, index) => (
        <span
          key={`${id}-${index}`}
          className={hiddenSet.has(id) ? 'wbm-preview__bar wbm-preview__bar--off' : 'wbm-preview__bar'}
        />
      ))}
    </div>
  );
}
