import clsx from 'clsx';
import { CheckCircle, Icon, Info, WarningCircle, X } from './Icon';
import { IconButton } from './IconButton';
import './Toast.css';

/** 堆叠上限：超过只显示最近 3 条，其余按队列淘汰（不静默积压）。 */
export const MAX_VISIBLE_TOASTS = 3;

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastItem {
  id: string;
  message: string;
  tone?: ToastTone;
}

export interface ToastViewportProps {
  toasts: readonly ToastItem[];
  onDismiss?: (id: string) => void;
  className?: string;
}

const TONE_ICON = {
  info: Info,
  success: CheckCircle,
  danger: WarningCircle,
} as const;

/**
 * Toast —— 底部居中堆叠（≤3 条），surface-raised + shadow-popover。
 * 纪律：成功态优先静默（只有不可自动恢复时才出 toast）；文案不卖萌。
 */
export function ToastViewport({ toasts, onDismiss, className }: ToastViewportProps) {
  const start = Math.max(toasts.length - MAX_VISIBLE_TOASTS, 0);
  const visible = toasts.slice(start);

  return (
    <div role="status" aria-live="polite" className={clsx('sc-toast', className)}>
      {visible.map((toast) => {
        const tone = toast.tone ?? 'info';
        return (
          <div key={toast.id} className={clsx('sc-toast__item', `sc-toast__item--${tone}`)} data-tone={tone}>
            <Icon icon={TONE_ICON[tone]} size="sm" className="sc-toast__icon" />
            <span className="sc-toast__message">{toast.message}</span>
            <IconButton
              icon={X}
              label={`关闭通知：${toast.message}`}
              onClick={() => {
                onDismiss?.(toast.id);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
