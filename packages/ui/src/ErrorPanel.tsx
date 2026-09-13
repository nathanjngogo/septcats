import clsx from 'clsx';
import { Button } from './Button';
import { Icon, WarningOctagon } from './Icon';
import './ErrorPanel.css';

export interface ErrorPanelProps {
  title?: string;
  /** 说人话的说明（可内联、可重试） */
  description: string;
  retryLabel?: string;
  onRetry?: (() => void) | undefined;
  className?: string;
}

/** ErrorPanel —— §16.4 错误态：说明 + 重试；只出现在状态语义位，不做大面积铺色。 */
export function ErrorPanel({ title = '加载失败', description, retryLabel = '重试', onRetry, className }: ErrorPanelProps) {
  return (
    <div role="alert" className={clsx('sc-error', className)}>
      <Icon icon={WarningOctagon} size="md" className="sc-error__icon" />
      <div className="sc-error__text">
        <p className="sc-error__title">{title}</p>
        <p className="sc-error__desc">{description}</p>
      </div>
      {onRetry === undefined ? null : (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
