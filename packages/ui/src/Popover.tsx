import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import './Popover.css';

export interface PopoverTriggerProps {
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
}

export interface PopoverProps {
  /** render-prop：把展开语义交给调用方放在自己的触发控件上，避免 cloneElement 的类型逃逸。 */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  label?: string;
  align?: 'start' | 'end';
  className?: string;
}

/** Popover —— 点击开合、点外关闭、Esc 关闭；不用阴影以外的层级手段。 */
export function Popover({ trigger, children, label, align = 'start', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx('sc-popover', className)}>
      {trigger({
        onClick: () => {
          setOpen((current) => !current);
        },
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
      })}
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={clsx('sc-popover__panel', `sc-popover__panel--${align}`)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
