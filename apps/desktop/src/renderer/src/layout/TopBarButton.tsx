/**
 * TopBarButton.tsx —— 顶栏中文文字按键（09-29 老板令：「同步状态的那一行按键，
 * 全部换成中文按键」→「图标去掉」——顶栏 actions 整排 = 纯中文文字钮）。
 *
 * 契约：
 * - 与 IconButton 同可访问面（aria-label / aria-pressed / aria-expanded / title
 *   语义保留），既有按 aria-label / [data-testid] 取钮的测试与探针路径不破；
 * - 可见文案 = 短中文（topbar.* 双语键）；tooltip 用完整 label（快捷键提示）；
 * - 无图标（老板令）：像素 glyph 全部撤出顶栏——顶层图标族本体仍在
 *   （AI 面板标题用 AiRobot、模板市场页用 PixelShopGlyph 等，见 T58/T74 资产），
 *   只是不再挂在这排钮上；
 * - 样式 .sc-topbtn（TopBarButton.css，全 var(--sc-*) token，三轴随主题）。
 */
import type { ReactNode } from 'react';
import './TopBarButton.css';

export interface TopBarButtonProps {
  /** 可访问名 + tooltip（完整文案，含快捷键提示）。 */
  label: string;
  /** 可见短文案（按键文字，中文面）。 */
  text: string;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
  onClick: () => void;
}

export function TopBarButton({
  label,
  text,
  pressed = false,
  expanded,
  disabled = false,
  testId,
  className,
  onClick,
}: TopBarButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={['sc-topbtn', pressed ? 'sc-topbtn--active' : '', className ?? '']
        .filter((name) => name !== '')
        .join(' ')}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={label}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      {text}
    </button>
  );
}
