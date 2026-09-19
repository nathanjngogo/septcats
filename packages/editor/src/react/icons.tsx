/**
 * icons.tsx —— 编辑器包内的**自绘图标**（不引 @phosphor、不依赖 packages/ui）。
 *
 * 纪律（与 §16.6 同源）：strokeWidth 1.5、尺寸只走 14/16 档、装饰性图标 aria-hidden。
 * 手柄用 ⋮⋮（DotsHandle）占位，与 01-editor.html 的 .handle 同位。
 */
import type { SVGProps } from 'react';

const BASE: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: false,
  'aria-hidden': true,
};

export function DotsHandleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={14} height={14} {...props}>
      <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={2.5} />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={16} height={16} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={16} height={16} {...props}>
      <path d="M5 7h14M10 7V5.5h4V7M7 7l1 12h8l1-12M10.5 10.5v5M13.5 10.5v5" />
    </svg>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={16} height={16} {...props}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={16} height={16} {...props}>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  );
}

export function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE} width={16} height={16} {...props}>
      <path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
      <path d="M13.5 10a4 4 0 0 0-5.7-.3l-3 3a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </svg>
  );
}
