import type { ReactNode } from 'react';
import clsx from 'clsx';
import './Kbd.css';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** Kbd —— 快捷键位（数字/字母走 mono）。 */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={clsx('sc-kbd', className)}>{children}</kbd>;
}
