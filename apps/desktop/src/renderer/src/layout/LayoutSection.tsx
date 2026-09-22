/**
 * LayoutSection.tsx —— 设置页「布局」区块（TASK-T39-01 §0.5 → TASK-T57-01 §1.3 收口）。
 *
 * T57-01 起本区块**只保留一枚入口按钮**：布局的预设卡与全部细项参数已迁到独立布局
 * 编辑器页（layout/LayoutEditorPage.tsx，经事件通道 `septcats:open-layout-editor`
 * 由 App 切 `view:'layout'`）。两套编辑 UI 会造成行为分叉，故原字段表单/导出导入
 * 整份迁走、此处不再重复渲染控件（**不丢任何参数**：编辑器页承载全部既有字段）。
 */
import { Button } from '@septcats/ui';
import { t } from '../i18n';
import './LayoutSection.css';

/** 打开布局编辑器页（App 监听；与 T18-03 `septcats:open-settings` 同范式解耦）。 */
export const OPEN_LAYOUT_EDITOR_EVENT = 'septcats:open-layout-editor';

export function LayoutSection() {
  return (
    <div className="layout-section" data-testid="layout-section">
      <div className="layout-section__row">
        <div className="layout-section__lab">
          <span className="layout-section__title">{t('settings.layout.editorEntry')}</span>
          <span className="layout-section__desc">{t('settings.layout.editorEntryDesc')}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          data-testid="layout-editor-entry"
          onClick={() => {
            window.dispatchEvent(new CustomEvent(OPEN_LAYOUT_EDITOR_EVENT));
          }}
        >
          {t('settings.layout.editorEntry')}
        </Button>
      </div>
    </div>
  );
}
