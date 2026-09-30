/** 
 * BitablePage.tsx —— 多维表格一级工作区（TASK-T99-01，飞书多维表格对标）。
 * ⚠ 骨架（PM 接线用最小实现）；完整实现由子 Agent B 接手。契约见 docs/PRD-多维表格.md。
 */
import type { ReactNode } from 'react';
import { t } from '../i18n';
import './Bitable.css';

export function BitablePage(): ReactNode {
  return (
    <div className="bitable-page" data-testid="bitable-page">
      <header className="bitable-head">
        <h1 className="bitable-title">{t('bitable.title')}</h1>
      </header>
      <div className="bitable-viewbar" data-testid="bitable-viewbar">
        <button type="button" className="bitable-chip" data-testid="bitable-view-new">
          {t('bitable.viewNew')}
        </button>
      </div>
      <div className="bitable-toolbar" data-testid="bitable-toolbar">
        <button type="button" data-testid="bitable-filter">{t('bitable.filter')}</button>
        <button type="button" data-testid="bitable-sort">{t('bitable.sort')}</button>
        <button type="button" data-testid="bitable-fields">{t('bitable.fields')}</button>
        <button type="button" data-testid="bitable-export">{t('bitable.export')}</button>
      </div>
      <div className="bitable-grid" data-testid="bitable-grid" />
      <p className="bitable-empty" data-testid="bitable-empty">
        {t('bitable.empty')} · {t('bitable.emptyHint')}
      </p>
    </div>
  );
}

export default BitablePage;
