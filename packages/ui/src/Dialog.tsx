import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import clsx from 'clsx';
import './Dialog.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Dialog —— 焦点圈闭（Tab 在弹层内循环，开时聚焦首个可聚焦元素、关时归还焦点）。
 * Esc 关闭；遮罩用 var(--sc-color-overlay)（浅深主题各自成立）。
 */
export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const titleId = `sc-dialog-title-${useId()}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = containerRef.current;
    const initial = focusables(node)[0] ?? node;
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || node === null) {
        return;
      }
      const list = focusables(node);
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
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const onOverlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="sc-dialog__overlay" onMouseDown={onOverlayMouseDown}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx('sc-dialog', className)}
      >
        <h2 className="sc-dialog__title" id={titleId}>
          {title}
        </h2>
        <div className="sc-dialog__body">{children}</div>
        {footer === undefined ? null : <div className="sc-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}
