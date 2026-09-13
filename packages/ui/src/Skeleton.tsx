import clsx from 'clsx';
import './Skeleton.css';

export interface SkeletonProps {
  /** >1 时按文本段渲染（末行收窄 60%，形似真实段落而不是通用转圈） */
  lines?: number;
  width?: string | number;
  height?: string | number;
  className?: string;
}

/**
 * Skeleton —— 加载态唯一允许的形式（§16.4：形似最终布局，禁通用转圈）。
 * 纯装饰，故 aria-hidden；可访问的等待语义由外层区域或 Spinner 承担。
 */
export function Skeleton({ lines = 1, width, height, className }: SkeletonProps) {
  const count = Math.max(lines, 1);
  const indexes = Array.from({ length: count }, (_, index) => index);

  return (
    <div className={clsx('sc-skeleton', count > 1 && 'sc-skeleton--stack', className)} aria-hidden="true">
      {indexes.map((index) => (
        <span
          key={index}
          className="sc-skeleton__bar"
          style={{
            width: count > 1 && index === count - 1 ? '60%' : width,
            height,
          }}
        />
      ))}
    </div>
  );
}
