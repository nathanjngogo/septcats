import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button';
import { FolderSimple, Icon } from './Icon';
import './EmptyState.css';

export interface EmptyStateProps {
  /** 一句动作导向的文案（不卖萌、不堆破折号） */
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** 插画位；缺省用虚线占位框（有构图，不是空白） */
  illustration?: ReactNode;
  className?: string;
}

/** EmptyState —— §16.4 空态：插画位 + 一句 + 主按钮（且同屏唯一 primary）。 */
export function EmptyState({ title, description, actionLabel, onAction, illustration, className }: EmptyStateProps) {
  return (
    <div className={clsx('sc-empty', className)}>
      <div className="sc-empty__art" aria-hidden="true">
        {illustration ?? <Icon icon={FolderSimple} size="lg" />}
      </div>
      <h3 className="sc-empty__title">{title}</h3>
      {description === undefined ? null : <p className="sc-empty__desc">{description}</p>}
      {actionLabel === undefined ? null : (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
