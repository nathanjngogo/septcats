/**
 * TourOverlay.tsx —— 首次启动导览·浮层组件（0.6.10 创意清单第②项 step C）。
 *
 * 形态：renderer 自绘模态（同 CloseAskDialog 范式，禁系统弹框）：
 * 面板 = `var(--sc-border-edge)` 轮廓 + `--sc-shadow-modal` 抬升，按钮复用
 * `@septcats/ui` Button 家族。消费 tourState 的 `useTour()`（open/stepIndex/stepId），
 * 本组件零业务逻辑——步进/回退/落戳全走 `tourActions`。
 *
 * 交互契约：
 * - 文案一律 i18n `tour.*`（零 CJK 字面量，守 i18n 门禁）；
 * - 最后一步「下一步」位换成「开始使用」（finish），不存在空白第 6 页；
 * - 第 0 步「上一步」disabled（不回卷、不误关）；
 * - Esc / 点遮罩 = 跳过（finish 同口径落 '1'）；Tab 焦点圈闭，关闭归还焦点；
 * - 进度行 aria-live=polite（第 {n} / {total} 步，插值走 replace 先例 aiChat）。
 *
 * 挂载（下一步 D）：App 末尾 <TourOverlay /> + tourActions.init()；本文件只建组件。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@septcats/ui';
import { TOUR_TOTAL, tourActions, useTour } from './tourState';
import { t } from '../i18n';
import './TourOverlay.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

export function TourOverlay() {
  const { open, stepIndex, stepId } = useTour();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // open 翻转时触发焦点效果（组件本体由 open 决定挂载与否，用本地态复刻时序）。
  const [mounted, setMounted] = useState(open);

  const isLast = stepIndex >= TOUR_TOTAL - 1;
  const isFirst = stepIndex <= 0;

  useEffect(() => {
    setMounted(open);
  }, [open]);

  // 焦点：开时聚焦「下一步/开始使用」主钮；关时归还焦点。
  useEffect(() => {
    if (!mounted) {
      return;
    }
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const primary = panelRef.current?.querySelector<HTMLElement>('[data-testid="tour-primary"]') ?? null;
    const initial = primary ?? focusables(panelRef.current)[0] ?? panelRef.current;
    initial?.focus();
    return () => {
      restoreRef.current?.focus();
    };
  }, [mounted]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      tourActions.finish();
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
  }, []);

  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      tourActions.finish();
    }
  };

  if (!open || stepId === null) {
    return null;
  }

  return (
    <div
      className="sc-tour__overlay"
      data-testid="tour-overlay"
      onMouseDown={onOverlayMouseDown}
    >
      <div
        className="sc-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-tour-title"
        data-testid="tour"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <p className="sc-tour__progress" data-testid="tour-progress" aria-live="polite">
          {t('tour.progress')
            .replace('{n}', String(stepIndex + 1))
            .replace('{total}', String(TOUR_TOTAL))}
        </p>
        <h2 className="sc-tour__title" id="sc-tour-title" data-testid="tour-title">
          {t(`tour.${stepId}.title`)}
        </h2>
        <p className="sc-tour__body" data-testid="tour-body">
          {t(`tour.${stepId}.body`)}
        </p>
        <div className="sc-tour__footer">
          <Button
            variant="ghost"
            data-testid="tour-skip"
            onClick={() => {
              tourActions.finish();
            }}
          >
            {t('tour.skip')}
          </Button>
          <div className="sc-tour__nav">
            <Button
              variant="secondary"
              data-testid="tour-back"
              disabled={isFirst}
              onClick={() => {
                tourActions.back();
              }}
            >
              {t('tour.back')}
            </Button>
            {isLast ? (
              <Button variant="primary" data-testid="tour-primary" onClick={() => tourActions.finish()}>
                {t('tour.finish')}
              </Button>
            ) : (
              <Button variant="primary" data-testid="tour-primary" onClick={() => tourActions.next()}>
                {t('tour.next')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
