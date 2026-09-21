/**
 * CloseAskDialog.tsx —— 关窗询问框（TASK-T54-01 §1②）。
 *
 * **renderer 自绘像素模态**（禁 `dialog.showMessageBox`：系统弹框不吃 token）：
 * 面板 = `var(--sc-bevel-out)` 硬边亮暗面 + `var(--sc-shadow-modal)` 抬升，
 * 三钮直接复用 `@septcats/ui` Button 家族（自带 T53 的 pixel/bevel 立体与按压对调）。
 *
 * 契约（main 侧 closeGuard 驱动）：
 * - `close:ask` 到达 → 打开；三钮：最小化到托盘（默认聚焦）、退出、取消；
 * - 勾选「记住我的选择」→ 决议带 remember=true（main 写 settings.trayClose，设置页可改回）；
 * - Esc / 点遮罩 = 取消；Tab 在框内循环（焦点圈闭），关闭时归还焦点；
 * - 决议经 `close:decide` 回 main（main 执行动作；本组件只管关自己）。
 *
 * 文案全走 i18n `closeAsk.*`（cancel 复用 common.cancel），无硬编码。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Button, Checkbox } from '@septcats/ui';
import type { CloseAction } from '../../../shared/ipc';
import { t } from '../i18n';
import './CloseAskDialog.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

export function CloseAskDialog() {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  /** 决议只发一次（Esc 与按钮连点/卸载竞态的双保险）。 */
  const settledRef = useRef(false);

  const decide = useCallback((action: CloseAction): void => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    setOpen(false);
    void window.septcats.close.decide({ action, remember }).catch((error: unknown) => {
      console.error('[closeAsk] close:decide 失败', error);
    });
  }, [remember]);

  useEffect(() => {
    const unsubscribe = window.septcats.close.onAsk(() => {
      settledRef.current = false;
      setRemember(false);
      setOpen(true);
    });
    return unsubscribe;
  }, []);

  // 焦点：开时聚焦「最小化到托盘」（§1② 默认聚焦；DOM 序首位是复选框，故显式指定），
  // 关时归还焦点给关窗前的活动元素。
  useEffect(() => {
    if (!open) {
      return;
    }
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const primary = panel?.querySelector<HTMLElement>('[data-testid="close-ask-tray"]') ?? null;
    const initial = primary ?? focusables(panel)[0] ?? panel;
    initial?.focus();
    return () => {
      restoreRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        decide('cancel');
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
    [decide],
  );

  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      decide('cancel');
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="close-ask__overlay"
      data-testid="close-ask-overlay"
      onMouseDown={onOverlayMouseDown}
    >
      <div
        className="close-ask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-ask-title"
        data-testid="close-ask"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <h2 className="close-ask__title" id="close-ask-title">
          {t('closeAsk.title')}
        </h2>
        <p className="close-ask__body">{t('closeAsk.body')}</p>
        <div className="close-ask__remember">
          <Checkbox
            label={t('closeAsk.remember')}
            checked={remember}
            data-testid="close-ask-remember"
            onChange={(event) => {
              setRemember(event.currentTarget.checked);
            }}
          />
        </div>
        <div className="close-ask__footer">
          <Button
            variant="secondary"
            data-testid="close-ask-cancel"
            onClick={() => {
              decide('cancel');
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            data-testid="close-ask-quit"
            onClick={() => {
              decide('quit');
            }}
          >
            {t('closeAsk.quit')}
          </Button>
          {/* 默认聚焦项（§1②）：显式指定，DOM 序首位是复选框 */}
          <Button variant="primary" data-testid="close-ask-tray" onClick={() => decide('tray')}>
            {t('closeAsk.minimizeToTray')}
          </Button>
        </div>
      </div>
    </div>
  );
}
