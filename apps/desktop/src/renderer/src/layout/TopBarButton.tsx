/**
 * TopBarButton.tsx —— 顶栏中文文字按键（09-29 老板令：「同步状态的那一行按键，
 * 全部换成中文按键」——顶栏 actions 整排从纯图标钮改为中文文字钮）。
 *
 * 契约：
 * - 与 IconButton 同可访问面（aria-label / aria-pressed / aria-expanded / title 语义
 *   原样保留），旧测试按 aria-label 与 [data-testid] 取钮的路径零破坏；
 * - 可见文案 = 短中文（topbar.* 双语键）；tooltip 用完整 label（快捷键提示等长
 *   文案沉到悬浮层）；
 * - 样式 .sc-topbtn（TopBarButton.css，全 var(--sc-*) token，三轴随主题；
 *   pressed 态带强调，hover/focus 沿用 IconButton 语言）。
 */
import type { ReactNode } from 'react';
import { Icon, type IconGlyph } from '@septcats/ui';
import './TopBarButton.css';

export interface TopBarButtonProps {
  /** 可访问名 + tooltip（完整文案，含快捷键提示）。 */
  label: string;
  /** 可见短文案（按键文字，中文面）。 */
  text: string;
  /**
   * 像素 glyph（T58/T74 像素族契约：顶栏钮 svg 必须 16×16 + crispEdges）。
   * 本钮 = 图标 + 中文文字：老板要的「中文按键」是可见文字，不是把图标换成
   * 别的东西；像素 glyph 保留，故 t58-01/t74-01 的像素族断言零破坏。
   */
  icon: IconGlyph;
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
  icon,
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
      /* 保留 .sc-iconbtn：本钮与图标钮共用同一套 hover/active/focus token 与
         「顶栏控件」结构契约（既有测试/探针按 .sc-shell__actions .sc-iconbtn
         取钮，含 svg 像素族断言）；.sc-topbtn 只负责把它展宽容纳文字。 */
      className={['sc-iconbtn', 'sc-topbtn', pressed ? 'sc-topbtn--active' : '', className ?? '']
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
      <Icon icon={icon} size="sm" />
      <span className="sc-topbtn__text">{text}</span>
    </button>
  );
}
