/**
 * LayoutPicker.tsx —— 布局快选弹框（TASK-T57-01 §1.2）。
 *
 * **renderer 自绘像素模态**（禁系统 dialog）：面板 = 2px 描边 + `--sc-shadow-modal`
 * + `--sc-pixel-out` 抬升（同 close/CloseAskDialog.css 的像素语法），钮复用
 * `@septcats/ui` Button 家族（自带 T53 立体与按压对调）。
 *
 * 契约：
 * - 内容 = 布局样式预览卡选择器（notion/focus/workbench，每卡是 CSS 画的抽象微缩窗口
 *   —— 见 LayoutPreview.tsx，禁位图）+ 当前项高亮 + 底部「自定义编辑…」；
 * - 点卡 = 即时应用（layoutActions.applyPreset → 主窗口实时重排）+ toast；**弹框不关闭**
 *   （可连续试三张卡；关闭由 Esc / 遮罩 / 编辑入口承担）；
 * - Esc / 点遮罩 = 关闭且**不改动**当前布局（applyPreset 只发生在点卡时）；
 * - Tab 在框内循环（焦点圈闭），关闭时归还焦点；打开时聚焦当前预设卡。
 *
 * 文案全走 i18n（`settings.layout.*` / `app.layoutLabel`），无硬编码。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@septcats/ui';
import { t } from '../i18n';
import { pushToast } from '../state/pages';
import { LayoutPreviewDiagram } from './LayoutPreview';
import {
  layoutActions,
  layoutPreviewForPreset,
  layoutStore,
  useLayout,
  type LayoutPresetId,
} from './layoutState';
import './LayoutPicker.css';

const PRESET_IDS: readonly LayoutPresetId[] = ['notion', 'focus', 'workbench'];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

export interface LayoutPickerProps {
  open: boolean;
  /** 关闭弹框（Esc / 遮罩 / 编辑入口都经此出口；不改动布局）。 */
  onClose: () => void;
  /** 「自定义编辑…」= 关弹框 + 进独立布局编辑器页。 */
  onEdit: () => void;
}

export function LayoutPicker({ open, onClose, onEdit }: LayoutPickerProps) {
  const layout = useLayout((state) => state.layout);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // 打开：记住来处焦点 + 聚焦当前预设卡（键盘用户一步就能改）；关闭：归还焦点。
  // 当前项经 store 现读（不进依赖）——弹框开着时切卡不重设焦点，键盘连续试卡不被打断。
  useEffect(() => {
    if (!open) {
      return;
    }
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const currentId = layoutStore.getState().layout.preset;
    const current = panel?.querySelector<HTMLElement>(`[data-testid="layout-picker-card-${currentId}"]`);
    const initial = current ?? focusables(panel)[0] ?? panel;
    initial?.focus();
    return () => {
      restoreRef.current?.focus();
    };
  }, [open]);

  const applyPreset = useCallback((id: LayoutPresetId): void => {
    layoutActions.applyPreset(id);
    pushToast(t('settings.layout.presetSwitched').replace('{name}', t(`settings.layout.presetName.${id}`)), 'info');
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const list = focusables(panelRef.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="layout-picker__overlay"
      data-testid="layout-picker-overlay"
      onMouseDown={onOverlayMouseDown}
    >
      <div
        className="layout-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layout-picker-title"
        data-testid="layout-picker"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <h2 className="layout-picker__title" id="layout-picker-title">
          {t('settings.layout.pickerTitle')}
        </h2>
        <p className="layout-picker__hint">{t('settings.layout.pickerHint')}</p>

        <div className="layout-picker__cards" role="group" aria-label={t('settings.layout.pickerTitle')}>
          {PRESET_IDS.map((id) => {
            const active = layout.preset === id;
            return (
              <button
                key={id}
                type="button"
                className={`layout-picker__card${active ? ' layout-picker__card--active' : ''}`}
                aria-pressed={active}
                data-testid={`layout-picker-card-${id}`}
                onClick={() => {
                  applyPreset(id);
                }}
              >
                <LayoutPreviewDiagram preview={layoutPreviewForPreset(id)} />
                <span className="layout-picker__card-name">{t(`settings.layout.presetName.${id}`)}</span>
                <span className="layout-picker__card-desc">{t(`settings.layout.presetDesc.${id}`)}</span>
              </button>
            );
          })}
        </div>

        <div className="layout-picker__footer">
          <Button variant="secondary" size="sm" data-testid="layout-picker-edit" onClick={onEdit}>
            {t('settings.layout.pickerEdit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
