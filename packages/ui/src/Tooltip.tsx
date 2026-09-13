import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import './Tooltip.css';

/** hover 400ms 才出现：避免划过即弹（§16.7 动效只服务反馈）。 */
export const TOOLTIP_DELAY_MS = 400;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
}

/**
 * Tooltip —— hover/focus 400ms 后出现，Esc 立即关闭；role="tooltip" + aria-describedby。
 * 文案规则：不卖萌、不堆破折号；同步状态类提示必须引用真实时间。
 */
export function Tooltip({ content, children, placement = 'top', className }: TooltipProps) {
  const id = `sc-tooltip-${useId()}`;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      setOpen(true);
    }, TOOLTIP_DELAY_MS);
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <span
      className={clsx('sc-tooltip', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          hide();
        }
      }}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={clsx('sc-tooltip__bubble', `sc-tooltip__bubble--${placement}`)}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
