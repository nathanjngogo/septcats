/**
 * SaveTemplateDialog.tsx —— 工作台「另存为模板」弹框（TASK-T72-01 §范围4）。
 *
 * testid：`wb-save-template-title`（名称输入）/ `wb-save-template-page-<pageId>`（页勾选）/
 * `wb-save-template-confirm`（确认）。落库走 `templatesActions.saveWorkbench`（复用
 * 既有 templates slice，扩 kind='workbench'，零新表）；种子页正文经 blocks.list 抽取
 * 纯文本，抽取失败降级 body=''（不阻断另存）。
 */
import { useMemo, useState } from 'react';
import { Button, Checkbox, Dialog, Input } from '@septcats/ui';
import { t } from '../i18n';
import { usePages, pushToast } from '../state/pages';
import { templatesActions } from '../state/templates';
import type { SeptcatsApi } from '../../../types/window';
import { captureCurrentLayout, extractPlainText, type SeedPage } from './market';
import './SaveTemplateDialog.css';

function typedApi(): SeptcatsApi {
  const value = (globalThis as { septcats?: SeptcatsApi }).septcats;
  if (value === undefined) {
    throw new Error('preload did not inject window.septcats');
  }
  return value;
}

export interface SaveTemplateDialogProps {
  open: boolean;
  onClose(): void;
}

export function SaveTemplateDialog({ open, onClose }: SaveTemplateDialogProps) {
  const nodes = usePages((state) => state.nodes);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const topPages = useMemo(
    () => nodes.filter((node) => node.parentId === null && node.alive !== 0),
    [nodes],
  );

  const togglePage = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = async (): Promise<void> => {
    if (title.trim().length === 0) {
      pushToast(t('workbench.templateNameRequired'), 'info');
      return;
    }
    setSaving(true);
    const layout = captureCurrentLayout();
    const seedPages: SeedPage[] = [];
    for (const id of selected) {
      const node = nodes.find((candidate) => candidate.id === id);
      let body = '';
      try {
        const { blocks } = await typedApi().blocks.list({ pageId: id });
        body = extractPlainText(blocks);
      } catch {
        body = '';
      }
      seedPages.push({ title: node?.title ?? '', body });
    }
    const ok = await templatesActions.saveWorkbench({ title: title.trim(), layout, seedPages });
    setSaving(false);
    if (ok) {
      setTitle('');
      setSelected(new Set());
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('workbench.market.saveTemplateTitle')}>
      <div className="wbsave">
        <label className="wbsave__label" htmlFor="wbsave-title">
          {t('workbench.market.saveTemplateNameLabel')}
        </label>
        <Input
          id="wbsave-title"
          className="wbsave__input"
          data-testid="wb-save-template-title"
          value={title}
          placeholder={t('workbench.market.saveTemplateNameLabel')}
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => setTitle(event.target.value)}
        />
        <p className="wbsave__note">{t('workbench.market.seedNote')}</p>
        <div className="wbsave__pages-label">{t('workbench.market.saveTemplatePagesLabel')}</div>
        {topPages.length === 0 ? (
          <p className="wbsave__empty">{t('workbench.market.noPages')}</p>
        ) : (
          <ul className="wbsave__pages">
            {topPages.map((node) => (
              <li key={node.id} className="wbsave__page">
                <Checkbox
                  className="wbsave__check"
                  data-testid={`wb-save-template-page-${node.id}`}
                  checked={selected.has(node.id)}
                  onChange={() => togglePage(node.id)}
                />
                <span className="wbsave__page-title">{node.title || t('workbench.cardQuick')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sc-dialog__footer">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          {t('workbench.market.applyConfirmNo')}
        </Button>
        <Button
          variant="primary"
          data-testid="wb-save-template-confirm"
          onClick={() => void handleConfirm()}
          disabled={saving}
        >
          {t('workbench.market.saveConfirm')}
        </Button>
      </div>
    </Dialog>
  );
}
