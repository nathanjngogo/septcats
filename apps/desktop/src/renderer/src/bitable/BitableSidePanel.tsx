/** 
 * BitableSidePanel.tsx —— 多维表格二级栏（本库全部多维表）。骨架；子 Agent B 接手。
 */
import type { ReactNode } from 'react';
import { t } from '../i18n';
import './Bitable.css';

export function BitableSidePanel(): ReactNode {
  return (
    <div className="bitable-side" data-testid="bitable-side">
      <div className="bitable-side-head">
        <span className="bitable-side-title">{t('bitable.sideTitle')}</span>
        <button type="button" className="bitable-side-new" data-testid="bitable-side-new">
          {t('bitable.newTable')}
        </button>
      </div>
      <p className="bitable-side-empty" data-testid="bitable-side-empty">{t('bitable.empty')}</p>
    </div>
  );
}

export default BitableSidePanel;
