import clsx from 'clsx';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** 0–100，越界自动夹取 */
  value: number;
  /** 可访问名（无 label 的进度条必须给） */
  label?: string;
  className?: string;
}

/** ProgressBar —— 进度用 transform: scaleX 表达（禁 animate width/top/left）。 */
export function ProgressBar({ value, label = '进度', className }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={clsx('sc-progress', className)}
    >
      <span className="sc-progress__fill" style={{ transform: `scaleX(${String(clamped / 100)})` }} />
    </div>
  );
}
