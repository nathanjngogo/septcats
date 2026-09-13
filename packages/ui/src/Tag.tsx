import type { ReactNode } from 'react';
import clsx from 'clsx';
import './Tag.css';

export type TagTone = 'neutral' | 'amber' | 'red';

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  className?: string;
}

/** Tag —— 只承载状态语义色；amber=选中/强调，red=danger/冲突。 */
export function Tag({ children, tone = 'neutral', className }: TagProps) {
  return <span className={clsx('sc-tag', `sc-tag--${tone}`, className)}>{children}</span>;
}
